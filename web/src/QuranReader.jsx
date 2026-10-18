import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {verifyQuranChapter} from './quranClient.js';
import {RecoveryQueue} from './recoveryQueue.js';
import {recoverySession} from './useWritingRecovery.js';
import {readReadingPreferences,writeReadingPreferences,readingStyle} from './readingPreferences.js';
import ReadingAppearance from './ReadingAppearance.jsx';
import LocationMarginNotes from './LocationMarginNotes.jsx';
import VerseMaterialList from './VerseMaterialList.jsx';
import QuranWriting from './QuranWriting.jsx';
import './readingAppearance.css';
import './quranReader.css';

export default function QuranReader({api,projectId,initialReference,drafts,changed,onOpen,onOpenNotebook}){
  const [catalog,setCatalog]=useState(null),[chapter,setChapter]=useState(initialReference?.chapter||4),[ayah,setAyah]=useState(initialReference?.ayah_start||59);
  const [data,setData]=useState(null),[error,setError]=useState(''),[ready,setReady]=useState(false),[jump,setJump]=useState('');
  const [notes,setNotes]=useState(false),[binding,setBinding]=useState(null),[sideError,setSideError]=useState(''),[refresh,setRefresh]=useState(0),[composer,setComposer]=useState(0);
  const [arabic,setArabic]=useState(true),[english,setEnglish]=useState(true),[arabicSize,setArabicSize]=useState(34),[arabicFont,setArabicFont]=useState('"Geeza Pro",Tahoma,serif');
  const [appearance,setAppearance]=useState(()=>readReadingPreferences(localStorage));
  const [resource,setResource]=useState(initialReference?.resource_key||'itani-god');
  const textRoot=useRef(null),root=useRef(null),generation=useRef(0),active=useRef(null),resumed=useRef(false);
  const context={resource_key:resource,chapter,ayah_start:ayah,ayah_end:ayah};
  const contextKey=JSON.stringify(context),contextRef=useRef(context);contextRef.current=context;
  const placeQueue=useRef(null);
  useEffect(()=>{let live=true;
    Promise.all([api.request('quran/catalog'),api.request('quran/place',{project_id:projectId})]).then(([cat,place])=>{
      if(!live)return;if(!Array.isArray(cat.chapters)||cat.chapters.length!==114)throw new Error('Surah navigation is unavailable.');setCatalog(cat);
      const queue=recoverySession(drafts.current,'quran-place:'+projectId,()=>new RecoveryQueue({identity:crypto.randomUUID(),revision:place?.revision||0,delay:1600,write:async sent=>{
        const {draft_uuid,...value}=sent;const row=await api.request('quran/place',{},value);
        if(row?.project_id!==projectId||row.chapter!==sent.chapter||row.ayah!==sent.ayah||row.resource_key!==sent.resource_key)throw new Error('Reading place was not confirmed.');return row;
      }}));placeQueue.current=queue;
      if(!initialReference&&place){setChapter(place.chapter);setAyah(place.ayah);setResource(place.resource_key);}
      setReady(true);
    }).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};
  },[projectId]);
  useEffect(()=>{if(!ready)return;const token=++generation.current;setData(null);setError('');
    api.request('quran/chapter',{chapter}).then(value=>verifyQuranChapter(value,chapter)).then(value=>{
      if(value.verses.length!==catalog.chapters[chapter-1].ayah_count)throw new Error('This surah is incomplete.');
      if(token===generation.current){setData(value);resumed.current=false;}
    }).catch(e=>{if(token===generation.current)setError(e.message);});return()=>{generation.current++;};
  },[chapter,ready]);
  useEffect(()=>{if(!data||resumed.current)return;resumed.current=true;requestAnimationFrame(()=>root.current?.querySelector(`[data-ayah="${ayah}"]`)?.scrollIntoView({block:'start'}));},[data]);
  const isVisible=()=>root.current&&!root.current.closest('[hidden]');
  useEffect(()=>{if(!data)return;const outer=root.current?.closest('.workspace-reader')||window;
    let timer;function track(){if(!isVisible())return;clearTimeout(timer);timer=setTimeout(()=>{
      const top=outer===window?0:outer.getBoundingClientRect().top;
      const verse=[...root.current.querySelectorAll('[data-ayah]')].find(el=>el.getBoundingClientRect().bottom>top+100);
      if(verse)setAyah(Number(verse.dataset.ayah));
    },180);}outer.addEventListener('scroll',track,{passive:true});return()=>{outer.removeEventListener('scroll',track);clearTimeout(timer);};
  },[data]);
  useEffect(()=>{if(!ready||!data||!isVisible())return;const url=new URL(location.href);if(url.searchParams.get('view')!=='quran')return;
    url.searchParams.set('chapter',chapter);url.searchParams.set('ayah_start',ayah);url.searchParams.set('resource_key',resource);history.replaceState(null,'',url);
    placeQueue.current?.enqueue({project_id:projectId,chapter,ayah,resource_key:resource,owner_confirmed:true});
  },[ready,data,chapter,ayah,resource]);
  useEffect(()=>{const flush=()=>placeQueue.current?.flush();window.addEventListener('pagehide',flush);return()=>window.removeEventListener('pagehide',flush);},[]);
  useEffect(()=>{if(!notes)return;let live=true;setBinding(null);setSideError('');
    api.request('quran/binding',{project_id:projectId,...context}).then(value=>{if(live){setBinding(value);active.current=value;}}).catch(e=>{if(live)setSideError(e.message);});return()=>{live=false;};
  },[notes,contextKey,refresh]);
  useLayoutEffect(()=>{textRoot.current=root.current?.querySelector(`[data-ayah="${ayah}"] [data-resource="${resource}"]`)||null;},[data,ayah,resource]);
  function go(c,a){if(c<1||c>114)return;const count=catalog?.chapters[c-1]?.ayah_count;if(!Number.isInteger(a)||a<1||a>count){setError('That ayah is outside this surah.');return;}setError('');setChapter(c);setAyah(a);if(c===chapter)root.current?.querySelector(`[data-ayah="${a}"]`)?.scrollIntoView({block:'start'});}
  function submit(e){e.preventDefault();const match=/^(\d{1,3})(?::(\d{1,3}))?$/.exec(jump.trim());if(!match){setError('Use a reference such as 4:59.');return;}go(Number(match[1]),Number(match[2]||1));}
  function resize(next){const el=root.current?.querySelector(`[data-ayah="${ayah}"]`),top=el?.getBoundingClientRect().top;setAppearance(next);writeReadingPreferences(localStorage,next);requestAnimationFrame(()=>{const parent=root.current?.closest('.workspace-reader');if(el&&parent&&top!=null)parent.scrollTop+=el.getBoundingClientRect().top-top;});}
  async function exactTools(){try{const bound=binding || await api.post('quran/binding',{project_id:projectId,...context,owner_confirmed:true});onOpen(bound.record_id,projectId,'',bound.document.id);}catch(e){setSideError(e.message);}}
  const selected=data?.verses[ayah-1];
  return <section ref={root} className="quran-reader" data-reading-theme={appearance.theme} style={{...readingStyle(appearance),'--quran-arabic-size':arabicSize*appearance.zoom/100+'px','--quran-arabic-font':arabicFont}}>
    <header className="quran-toolbar"><div className="quran-location"><button aria-label="Previous surah" disabled={!catalog||chapter===1} onClick={()=>go(chapter-1,1)}>←</button><label className="sr-only" htmlFor="quran-surah">Surah</label><select id="quran-surah" aria-label="Surah" value={chapter} onChange={e=>go(Number(e.target.value),1)}>{(catalog?.chapters||[{chapter,label:'Qur’an'}]).map(row=><option key={row.chapter} value={row.chapter}>{row.chapter}. {row.label}</option>)}</select><button aria-label="Next surah" disabled={!catalog||chapter===114} onClick={()=>go(chapter+1,1)}>→</button></div>
      <form onSubmit={submit}><input aria-label="Go to verse" placeholder="4:59" value={jump} onChange={e=>setJump(e.target.value)}/><button>Go</button></form><ReadingAppearance value={appearance} onChange={resize}/><button aria-pressed={notes} onClick={()=>setNotes(v=>!v)}>Notes</button>
    </header>
    <div className="quran-view-options"><button aria-pressed={arabic} disabled={arabic&&!english} onClick={()=>setArabic(v=>!v)}>Arabic</button><button aria-pressed={english} disabled={english&&!arabic} onClick={()=>setEnglish(v=>!v)}>English</button><details><summary>Arabic type</summary><label>Size <input aria-label="Arabic text size" type="range" min="24" max="64" value={arabicSize} onChange={e=>setArabicSize(Number(e.target.value))}/></label><label>Font <select aria-label="Arabic font" value={arabicFont} onChange={e=>setArabicFont(e.target.value)}><option value={'"Geeza Pro",Tahoma,serif'}>Geeza Pro / Tahoma</option><option value="serif">System serif</option><option value="sans-serif">System sans</option></select></label></details><span>Talal Itani · ClearQuran</span></div>
    {error&&<p role="alert">{error} <button onClick={()=>{setReady(false);setTimeout(()=>setReady(true),0);}}>Retry reading</button></p>}
    {!data&&!error&&<p role="status">Opening the surah…</p>}
    <div className={'quran-layout'+(notes?' with-notes':'')}><main className="quran-text" aria-label="Qur’an continuous reading">
      {data&&<><h1>{data.label}</h1><p className="quran-surah-count">{data.verses.length} ayahs</p>{data.verses.map(row=><article key={row.reference.id} data-ayah={row.ayah} className={notes&&row.ayah===ayah?'is-current':''}>
        <a className="quran-ayah-number" href={`?project=${encodeURIComponent(projectId)}&view=quran&chapter=${chapter}&ayah_start=${row.ayah}`} aria-label={'Notes for '+row.reference.label} onClick={e=>{e.preventDefault();setAyah(row.ayah);setNotes(true);}}>{chapter}:{row.ayah}</a>
        {arabic&&<p lang="ar" dir="rtl" className="quran-arabic" data-resource="tanzil-uthmani">{row.arabic.text}</p>}
        {english&&<p lang="en" dir="ltr" className="quran-translation" data-resource="itani-god">{row.translation.text}</p>}
      </article>)}<button disabled={chapter===114} onClick={()=>go(chapter+1,1)}>Next surah →</button></>}
    </main>{notes&&selected&&<aside className="quran-notes" aria-label="Verse notes"><header><h2>Q {chapter}:{ayah}</h2><button aria-label="Close notes" onClick={()=>setNotes(false)}>×</button></header>
      <div className="quran-note-resource"><button aria-pressed={resource==='itani-god'} onClick={()=>setResource('itani-god')}>English notes</button><button aria-pressed={resource==='tanzil-uthmani'} onClick={()=>setResource('tanzil-uthmani')}>Arabic notes</button></div>
      {sideError&&<p role="alert">{sideError}</p>}
      {binding&&<LocationMarginNotes key={binding.document.id+':'+refresh} api={api} record={{id:binding.record_id,project_id:projectId}} document={binding.document} textRoot={textRoot} drafts={drafts} changed={changed} onOpenNotebook={onOpenNotebook} navigate={onOpen} hideComposer/>}
      <QuranWriting key={contextKey+':'+composer} api={api} projectId={projectId} context={context} drafts={drafts} changed={changed} onSettled={()=>{setRefresh(n=>n+1);setComposer(n=>n+1);}}/>
      <button className="quran-passage-tools" onClick={exactTools}>Highlight an exact passage ↗</button>
      <details><summary>Commentary & related sources</summary><VerseMaterialList api={api} projectId={projectId} reference={selected.reference} onOpen={onOpen}/></details>
    </aside>}</div>
    {data&&<footer className="quran-attribution">{data.resources.map(row=><details key={row.resource_id}><summary>{row.attribution}</summary><p>{row.label} · {row.version}</p><a href={row.attribution_url} target="_blank" rel="noreferrer">Source ↗</a> · <a href={row.license_url} target="_blank" rel="noreferrer">License & terms ↗</a><pre>{row.source_notice}</pre><p>{row.review_limit}</p></details>)}<details><summary>Other translations</summary>{catalog?.unavailable.map(row=><p key={row.key}>{row.label}: {row.reason}</p>)}</details></footer>}
  </section>;
}
