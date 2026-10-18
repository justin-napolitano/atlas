import React,{useEffect,useRef,useState} from 'react';
import SourceReader from './SourceReader.jsx';
import VerseMaterialList from './VerseMaterialList.jsx';
import {selectedPassage} from './passageSelection.js';
import {verifyReadingCapture} from './readingMarks.js';
import './quranReader.css';

const resources=[['english_saheeh','Noor International Center'],['english_rwwad','Rowwad Translation Center']];
const chapters=[[1,'Al-Fātiḥah',7],[4,'An-Nisāʾ',176]];
const safeReference=value=>chapters.some(([number,,count])=>number===value?.chapter && Number.isInteger(value?.ayah_start) && value.ayah_start>=1 && value.ayah_start<=count)
  ? {chapter:value.chapter,ayah:value.ayah_start}:{chapter:4,ayah:59};

/** Continuous reading stays in place while notes and inspected sources open beside it. */
export default function QuranReader({api,projectId,initialReference,drafts,changed,noteEditor,onOpenNotebook,onLocation}){
  const initial=safeReference(initialReference),[chapter,setChapter]=useState(initial.chapter),[ayah,setAyah]=useState(initial.ayah);
  const [translationKey,setTranslationKey]=useState('english_saheeh'),[resource,setResource]=useState(null),[loading,setLoading]=useState(false);
  const [message,setMessage]=useState(''),[showArabic,setShowArabic]=useState(true),[showEnglish,setShowEnglish]=useState(true);
  const [arabicSize,setArabicSize]=useState(30),[englishSize,setEnglishSize]=useState(18);
  const [sidebar,setSidebar]=useState(''),[note,setNote]=useState(null),[inspected,setInspected]=useState(null),[desk,setDesk]=useState(null);
  const [pending,setPending]=useState(null),generation=useRef(0),noteRequest=useRef(0),verseNodes=useRef(new Map());
  const count=chapters.find(row=>row[0]===chapter)?.[2] || 0;
  useEffect(()=>{const next=safeReference(initialReference);if(next.chapter!==chapter)setChapter(next.chapter);if(next.ayah!==ayah)setAyah(next.ayah);},[initialReference?.chapter,initialReference?.ayah_start]);
  useEffect(()=>{let active=true;const token=++generation.current;setLoading(true);setResource(null);setMessage('');
    api.request('quran/reader',{chapter,translation_key:translationKey}).then(value=>{
      if(!active||token!==generation.current)return;
      if(value.chapter!==chapter||value.ayah_count!==count||value.arabic?.verses?.length!==count)throw new Error('The reading resource did not cover this surah.');
      setResource(value);if(value.translation_availability!=='available')setMessage('The selected translation is unavailable. Arabic remains readable; retry or choose another translation.');
    }).catch(error=>{if(active&&token===generation.current)setMessage(error.message);}).finally(()=>{if(active&&token===generation.current)setLoading(false);});
    return()=>{active=false;};
  },[chapter,translationKey]);
  useEffect(()=>{let active=true;api.request('reading/desk',{project_id:projectId}).then(value=>{if(active)setDesk(value);}).catch(error=>{if(active&&error.status!==404)setMessage('Saved reading place could not be loaded.');});return()=>{active=false;};},[projectId]);
  useEffect(()=>{if(!resource)return;requestAnimationFrame(()=>verseNodes.current.get(ayah)?.scrollIntoView({block:'start'}));},[chapter,ayah,!!resource]);
  function move(nextChapter,nextAyah){noteRequest.current++;setSidebar('');setInspected(null);setNote(null);setPending(null);setChapter(nextChapter);setAyah(nextAyah);onLocation?.({chapter:nextChapter,ayah_start:nextAyah,ayah_end:nextAyah});}
  function next(direction){const target=ayah+direction;if(target>=1&&target<=count)move(chapter,target);}
  function selectedResource(kind){if(!resource)return null;return kind==='arabic'?resource.arabic:resource.translation;}
  async function association(targetAyah,kind,displayed=resource){
    const chosen=kind==='arabic'?displayed?.arabic:displayed?.translation;
    const verse=chosen?.verses?.[targetAyah-1];if(!chosen||!verse)throw new Error('This reading resource is unavailable.');
    const result=await api.post('quran/reader-association',{project_id:projectId,chapter,ayah:targetAyah,
      resource_id:chosen.resource_id,text_sha256:verse.text_sha256,translation_key:translationKey});
    if(result.project_id!==projectId||result.chapter!==chapter||result.ayah!==targetAyah||result.resource_id!==chosen.resource_id||result.text_sha256!==verse.text_sha256)
      throw new Error('The saved verse did not match the displayed resource.');
    const record=await api.request('record',{record_id:result.record_id});
    if(record.project_id!==projectId||record.id!==result.record_id)throw new Error('The saved source belongs to another project.');
    return {...result,record};
  }
  async function openNote(targetAyah,kind){const request=++noteRequest.current;setMessage('');setAyah(targetAyah);onLocation?.({chapter,ayah_start:targetAyah,ayah_end:targetAyah});setSidebar('notes');setInspected(null);setPending({ayah:targetAyah,kind});
    try{const value=await association(targetAyah,kind);if(request===noteRequest.current){setNote(value);setPending(null);}}
    catch(error){if(request===noteRequest.current){setMessage(error.message);setPending(null);}}}
  async function highlight(targetAyah,kind){
    const key=`quran-highlight:${JSON.stringify([projectId,chapter,targetAyah,kind,selectedResource(kind)?.resource_id])}`;
    if(drafts.current.has(key)){setMessage('Retry or discard the unconfirmed highlight before selecting another phrase.');setSidebar('notes');return;}
    const root=document.querySelector(`[data-quran-text="${kind}:${chapter}:${targetAyah}"]`);
    let selection;try{selection=selectedPassage(root,window.getSelection());}catch(error){setMessage(error.message);return;}
    if(!selection){setMessage('Select a phrase within one verse before highlighting.');return;}
    setMessage('');setAyah(targetAyah);onLocation?.({chapter,ayah_start:targetAyah,ayah_end:targetAyah});setSidebar('notes');setPending({ayah:targetAyah,kind});
    try{const value=await association(targetAyah,kind),chosen=selectedResource(kind),verse=chosen.verses[targetAyah-1];
      const payload={annotation_uuid:crypto.randomUUID(),project_id:projectId,
        document_id:value.document_id,text_sha256:verse.text_sha256,start:selection.start,end:selection.end,
        exact:selection.exact,capture_kind:'comment',mark_style:'highlight',body:''};
      drafts.current.set(key,{payload,value});changed();await submitHighlight(key);
    }catch(error){setMessage(error.message);setPending(null);}}
  async function submitHighlight(key){const savedDraft=drafts.current.get(key);if(!savedDraft)return;
    const {payload,value}=savedDraft;setPending({ayah:value.ayah,kind:'exact highlight'});
    try{const row=verifyReadingCapture(await api.post('reading/annotations',payload),payload);
      drafts.current.delete(key);changed();setNote({...value,annotation_id:row.id});setPending(null);window.getSelection()?.removeAllRanges();setMessage('Exact highlight saved to its original resource.');
    }catch(error){setPending(null);setMessage('The highlight save is unconfirmed. Retry the exact request or discard it; your selected wording is retained.');}}
  async function savePlace(){setMessage('');try{const value=await association(ayah,'arabic');
      const sent={project_id:projectId,record_id:value.record_id,document_id:value.document_id,annotation_id:null,expected_revision:desk?.revision||0};
      const saved=await api.request('reading/desk',{},sent);setDesk(saved);setMessage(`Saved Q ${chapter}:${ayah} as your private reading place.`);
    }catch(error){if(error.status===409){setMessage('Another session moved your bookmark. Reload its place before replacing it.');
      try{setDesk(await api.request('reading/desk',{project_id:projectId}));}catch{}}
      else setMessage(error.message);}}
  async function resume(){if(!desk)return;try{const document=await api.request('reading/document',{project_id:projectId,document_id:desk.document_id});
      const match=/^Q (1|4):(\d+)$/.exec(document.locator);if(!match||!chapters.some(([c,,n])=>c===Number(match[1])&&Number(match[2])<=n))throw new Error('The saved place is outside this reading pilot.');
      move(Number(match[1]),Number(match[2]));setMessage(`Resumed ${document.locator}.`);
    }catch(error){setMessage(error.message);}}
  async function inspect(recordId,selectedProject,annotationId,documentId){if(selectedProject!==projectId){setMessage('That source belongs to another project.');return;}
    try{const record=await api.request('record',{record_id:recordId});if(record.project_id!==projectId)throw new Error('The linked source belongs to another project.');
      setInspected({record,annotationId,documentId});setSidebar('source');}
    catch(error){setMessage(error.message);}}
  const active=sidebar==='source'?inspected:note;
  return <section className="quran-reader" aria-label="Continuous Qur’an reader">
    <header className="quran-toolbar"><div><h2>Qur’an reading</h2><p>Identified resources · private notes</p></div>
      <label>Surah<select value={chapter} onChange={e=>move(Number(e.target.value),1)}>{chapters.map(([number,name])=><option key={number} value={number}>{number} · {name}</option>)}</select></label>
      <form onSubmit={event=>{event.preventDefault();const value=Number(event.currentTarget.elements.ayah.value);if(Number.isInteger(value)&&value>=1&&value<=count)move(chapter,value);else setMessage(`Choose ayah 1–${count}.`);}}><label>Ayah<input name="ayah" type="number" min="1" max={count} defaultValue={ayah} key={chapter+':'+ayah}/></label><button>Go</button></form>
      <button onClick={()=>next(-1)} disabled={ayah<=1}>Previous</button><button onClick={()=>next(1)} disabled={ayah>=count}>Next</button>
      <button onClick={savePlace} disabled={!resource}>Save place</button><button onClick={resume} disabled={!desk}>Resume</button>
    </header>
    <details className="quran-settings"><summary>Reading settings and source details</summary><div className="quran-settings-grid">
      <label><input type="checkbox" checked={showArabic} onChange={e=>setShowArabic(e.target.checked)}/> Arabic</label>
      <label><input type="checkbox" checked={showEnglish} onChange={e=>setShowEnglish(e.target.checked)}/> English</label>
      <label>Arabic size<input type="range" min="22" max="46" value={arabicSize} onChange={e=>setArabicSize(Number(e.target.value))}/></label>
      <label>English size<input type="range" min="15" max="28" value={englishSize} onChange={e=>setEnglishSize(Number(e.target.value))}/></label>
      <label>Translation<select value={translationKey} onChange={e=>{noteRequest.current++;setTranslationKey(e.target.value);setPending(null);}}>{resources.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
    </div>{resource&&<><p>Arabic: <a href={resource.arabic.attribution_url} target="_blank" rel="noreferrer">Tanzil Project</a>, Uthmani 1.1. English: {resource.translation?.label||'unavailable'}, version {resource.translation?.version||'unknown'}, via <a href="https://quranenc.com/en/home/api/" target="_blank" rel="noreferrer">QuranEnc.com</a>. Reading coverage is not commentary or scholarly review.</p><pre className="quran-source-notice">{resource.arabic.source_notice}</pre></>}</details>
    {message&&<p className="quran-message" role="status">{message}</p>}{loading&&<p role="status">Loading identified reading resources…</p>}
    {resource&&<div className="quran-layout"><div className="quran-verses" aria-label={`Surah ${chapter} verses`}>
      {resource.arabic.verses.map((arabic,index)=>{const number=index+1,english=resource.translation?.verses[index];return <article key={number} id={`quran-${chapter}-${number}`} ref={node=>{if(node)verseNodes.current.set(number,node);else verseNodes.current.delete(number);}} className={ayah===number?'current':''}>
        <div className="quran-verse-head"><a href={`?${new URLSearchParams({project:projectId,view:'quran',chapter,ayah_start:number,ayah_end:number})}`} onClick={event=>{if(event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey){event.preventDefault();move(chapter,number);}}}>Q {chapter}:{number}</a><button onClick={()=>{move(chapter,number);setSidebar('context');}}>Context</button></div>
        {showArabic&&<><p className="quran-arabic" data-quran-text={`arabic:${chapter}:${number}`} dir="rtl" lang="ar" style={{fontSize:arabicSize}}>{arabic.text}</p><div className="quran-verse-actions"><button onClick={()=>{setAyah(number);openNote(number,'arabic');}}>Note on Arabic</button><button onClick={()=>highlight(number,'arabic')}>Highlight selected Arabic</button></div></>}
        {showEnglish&&english&&<><p className="quran-english" data-quran-text={`translation:${chapter}:${number}`} style={{fontSize:englishSize}}>{english.text}</p>{english.footnotes&&<details><summary>Translation footnotes</summary><p>{english.footnotes}</p></details>}<div className="quran-verse-actions"><button onClick={()=>{setAyah(number);openNote(number,'translation');}}>Note on translation</button><button onClick={()=>highlight(number,'translation')}>Highlight selected English</button></div></>}
      </article>;})}</div>
      {sidebar&&<aside className="quran-context" aria-label="Notes and source context"><header><h3>{sidebar==='context'?'Linked context':sidebar==='source'?'Source passage':'Notes beside the verse'}</h3><button onClick={()=>{setSidebar('notes');setInspected(null);}}>Back to notes</button><button onClick={()=>setSidebar('')}>Close</button></header>
        {pending&&<p role="status">Opening Q {chapter}:{pending.ayah} from its exact {pending.kind} resource…</p>}
        {[...drafts.current].filter(([key])=>key.startsWith(`quran-highlight:${JSON.stringify([projectId,chapter,ayah]).slice(0,-1)}`)).map(([key,saved])=><div key={key} className="quran-retry"><p>Unconfirmed exact highlight: {saved.payload.exact}</p><button onClick={()=>submitHighlight(key)}>Retry exact highlight</button><button onClick={()=>{drafts.current.delete(key);changed();setMessage('Unconfirmed highlight discarded locally. Check saved notes if the earlier request may have succeeded.');}}>Discard local request</button></div>)}
        {active?.record&&<SourceReader key={active.document_id+':'+(active.annotation_id||'')} record={active.record} api={api} drafts={drafts} changed={changed} noteEditor={noteEditor}
          initialDocumentId={active.document_id} initialAnnotationId={active.annotation_id||''} onOpenNotebook={onOpenNotebook} navigate={inspect} focused/>}
        {sidebar==='notes'&&!note&&!pending&&<p>Choose “Note” beside a verse. Its private source association opens automatically, without an import form.</p>}
        <VerseMaterialList key={chapter+':'+ayah} api={api} projectId={projectId} reference={{chapter,ayah_start:ayah,ayah_end:ayah}} onOpen={inspect}/>
      </aside>}</div>}
  </section>;
}
