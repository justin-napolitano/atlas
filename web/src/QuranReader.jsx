import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {verifyQuranChapter} from './quranClient.js';
import {RecoveryQueue} from './recoveryQueue.js';
import {recoverySession} from './useWritingRecovery.js';
import {readReadingPreferences,writeReadingPreferences,readingStyle} from './readingPreferences.js';
import ReadingAppearance from './ReadingAppearance.jsx';
import LocationMarginNotes from './LocationMarginNotes.jsx';
import VerseMaterialList from './VerseMaterialList.jsx';
import QuranWriting from './QuranWriting.jsx';
import {selectedPassage} from './passageSelection.js';
import {readingMarks,verifyReadingCapture} from './readingMarks.js';
import SavedPassageNote from './SavedPassageNote.jsx';
import './sourceReader.css';
import './readingAppearance.css';
import './quranReader.css';
import {DocumentNavigation} from './WorkspaceNavigation.jsx';
import {marginWidth,marginWidthKey,defaultMarginWidth,selectionToolbarPosition} from './readerMarginGeometry.js';
import QuranWordTranslation from './QuranWordTranslation.jsx';
import SaveReadingToLibrary from './SaveReadingToLibrary.jsx';
import useQuranProgress from './useQuranProgress.js';
import {isReadingAdvanceKey,nextReadingAyah} from './quranReadingKeys.js';

export default function QuranReader({api,projectId,initialReference,drafts,changed,onOpen,onOpenNotebook,onLocation,noteEditor,startAtBeginning=false}){
  const [marks,setMarks]=useState([]),[marksCursor,setMarksCursor]=useState(null),[marksError,setMarksError]=useState(''),[selection,setSelection]=useState(null),[activeMark,setActiveMark]=useState('');
  const [selectionPosition,setSelectionPosition]=useState(null),[focusRequest,setFocusRequest]=useState(0);
  const [preferredWidth,setPreferredWidth]=useState(()=>{try{return marginWidth(Number(localStorage.getItem(marginWidthKey))||defaultMarginWidth);}catch{return defaultMarginWidth;}}),[availableWidth,setAvailableWidth]=useState(1200);
  const layout=useRef(null),resizeAnchor=useRef(null),marginDrag=useRef(null),resizeAction=useRef(null);
  const selectionPanel=useRef(null),selectionRect=useRef(null);
  const keyboardCursor=useRef(null),keyboardHandler=useRef(null);
  const [keyboardReading,setKeyboardReading]=useState(false),[keyboardMessage,setKeyboardMessage]=useState('');
  const notesWidth=marginWidth(preferredWidth,availableWidth);
  const captureKey='quran-capture:'+projectId;const capture=drafts.current.get(captureKey);
  const [catalog,setCatalog]=useState(null),[chapter,setChapter]=useState(initialReference?.chapter||(startAtBeginning?1:4)),[ayah,setAyah]=useState(initialReference?.ayah_start||(startAtBeginning?1:59));
  const [data,setData]=useState(null),[error,setError]=useState(''),[ready,setReady]=useState(false),[jump,setJump]=useState(''),[placeStatus,setPlaceStatus]=useState({phase:'idle'}),[stickyTop,setStickyTop]=useState(0),[toolbarHeight,setToolbarHeight]=useState(64);
  const [notes,setNotes]=useState(!!initialReference?.note_scope),[binding,setBinding]=useState(null),[sideError,setSideError]=useState(''),[refresh,setRefresh]=useState(0),[composer,setComposer]=useState(0),[scope,setScope]=useState(initialReference?.note_scope||'verse'),[rangeEnd,setRangeEnd]=useState(initialReference?.ayah_end>initialReference?.ayah_start?initialReference.ayah_end:null),[broadNotes,setBroadNotes]=useState([]),[broadCursor,setBroadCursor]=useState(null);
  const [appearance,setAppearance]=useState(()=>{try{return readReadingPreferences(localStorage);}catch{return readReadingPreferences({getItem:()=>null});}});
  const arabic=appearance.showArabic,english=appearance.showEnglish,arabicSize=appearance.arabicSize,arabicFont={geeza:'"Geeza Pro",Tahoma,serif',serif:'serif',sans:'sans-serif'}[appearance.arabicFont];
  const [resource,setResource]=useState(initialReference?.resource_key||'itani-god');
  const textRoot=useRef(null),root=useRef(null),generation=useRef(0),active=useRef(null),resumed=useRef(false);
  const context={resource_key:resource,chapter,ayah_start:ayah,ayah_end:rangeEnd&&rangeEnd>=ayah?rangeEnd:ayah,note_scope:scope};
  const contextKey=JSON.stringify(context),contextRef=useRef(context);contextRef.current=context;
  const progress=useQuranProgress(api,projectId,drafts,changed,catalog),progressCounts=progress?.counts(chapter);
  const placeQueue=useRef(null);
  useEffect(()=>{let live=true,unsubscribe;
    Promise.all([api.request('quran/catalog'),api.request('quran/place',{project_id:projectId})]).then(([cat,place])=>{
      if(!live)return;if(!Array.isArray(cat.chapters)||cat.chapters.length!==114)throw new Error('Surah navigation is unavailable.');setCatalog(cat);
      const queue=recoverySession(drafts.current,'quran-place:'+projectId,()=>new RecoveryQueue({identity:crypto.randomUUID(),revision:place?.revision||0,delay:1600,write:async sent=>{
        const {draft_uuid,...value}=sent;const row=await api.request('quran/place',{},value);
        if(row?.project_id!==projectId||row.chapter!==sent.chapter||row.ayah!==sent.ayah||row.resource_key!==sent.resource_key)throw new Error('Reading place was not confirmed.');return row;
      }}));placeQueue.current=queue;unsubscribe=queue.subscribe(setPlaceStatus);
      if(!initialReference&&place){setChapter(place.chapter);setAyah(place.ayah);setResource(place.resource_key);}
      setReady(true);
    }).catch(e=>{if(live)setError(e.message);});return()=>{live=false;unsubscribe?.();};
  },[projectId]);
  useEffect(()=>{if(!ready)return;const token=++generation.current;setData(null);setError('');
    api.request('quran/chapter',{chapter}).then(value=>verifyQuranChapter(value,chapter)).then(value=>{
      if(value.verses.length!==catalog.chapters[chapter-1].ayah_count)throw new Error('This surah is incomplete.');
      if(token===generation.current){setData(value);resumed.current=false;}
    }).catch(e=>{if(token===generation.current)setError(e.message);});return()=>{generation.current++;};
  },[chapter,ready]);
  useEffect(()=>{if(!data||resumed.current)return;resumed.current=true;requestAnimationFrame(()=>{const verse=root.current?.querySelector(`[data-ayah="${ayah}"]`);verse?.scrollIntoView({block:'start'});if(keyboardCursor.current?.chapter===data.chapter)verse?.focus({preventScroll:true});});},[data]);
  const isVisible=()=>root.current&&!root.current.closest('[hidden]');
  useEffect(()=>{if(!data)return;const outer=root.current?.closest('.workspace-reader')||window;
    let timer;function track(){if(!isVisible())return;clearTimeout(timer);timer=setTimeout(()=>{
      // An idle margin follows reading. An exact quote, broad note, or active
      // editor stays pinned so scrolling cannot rebind unfinished writing.
      if(notes&&(scope!=='verse'||activeMark||(root.current?.querySelector('.quran-notes')?.contains(document.activeElement)&&document.activeElement.closest('textarea,input,[contenteditable=true],.cm-editor'))))return;
      const top=outer===window?0:outer.getBoundingClientRect().top;
      const cursor=keyboardCursor.current,pinned=cursor?.chapter===chapter?root.current.querySelector(`[data-ayah="${cursor.ayah}"]`):null;
      if(pinned&&pinned.getBoundingClientRect().bottom>top+stickyTop+toolbarHeight&&pinned.getBoundingClientRect().top<(outer===window?innerHeight:outer.getBoundingClientRect().bottom)){setAyah(cursor.ayah);return;}
      const verse=[...root.current.querySelectorAll('[data-ayah]')].find(el=>el.getBoundingClientRect().bottom>top+stickyTop+toolbarHeight+25);
      if(verse)setAyah(Number(verse.dataset.ayah));
    },180);}outer.addEventListener('scroll',track,{passive:true});return()=>{outer.removeEventListener('scroll',track);clearTimeout(timer);};
  },[data,notes,scope,activeMark,stickyTop,toolbarHeight]);
  useEffect(()=>{if(!ready||!data||!isVisible())return;const url=new URL(location.href);if(url.searchParams.get('view')!=='quran')return;
    url.searchParams.set('chapter',chapter);url.searchParams.set('ayah_start',ayah);url.searchParams.set('resource_key',resource);if(notes)url.searchParams.set('note_scope',scope);else url.searchParams.delete('note_scope');history.replaceState(null,'',url);
    onLocation?.({chapter,ayah_start:ayah,ayah_end:context.ayah_end,resource_key:resource,...(notes?{note_scope:scope}:{})});
    placeQueue.current?.enqueue({project_id:projectId,chapter,ayah,resource_key:resource,owner_confirmed:true});
  },[ready,data,chapter,ayah,resource,notes,scope,rangeEnd]);
  useEffect(()=>{const flush=()=>placeQueue.current?.flush();window.addEventListener('pagehide',flush);return()=>window.removeEventListener('pagehide',flush);},[]);
  useEffect(()=>{if(!notes)return;let live=true;setBinding(null);setSideError('');
    setBroadNotes([]);setBroadCursor(null);
    const request=scope==='verse'?api.request('quran/binding',{project_id:projectId,...context}):api.request('quran/notes',{project_id:projectId,resource_key:resource,chapter,note_scope:scope});
    request.then(value=>{if(live){if(scope==='verse'){setBinding(value);active.current=value;}else{setBroadNotes(value.items);setBroadCursor(value.next_cursor);}}}).catch(e=>{if(live)setSideError(e.message);});return()=>{live=false;};
  },[notes,contextKey,refresh]);
  useLayoutEffect(()=>{textRoot.current=root.current?.querySelector(`[data-ayah="${ayah}"] [data-resource="${resource}"]`)||null;},[data,ayah,resource]);
  function go(c,a,{keyboard=false}={}){if(!keyboard)setKeyboardMessage('');setActiveMark('');setSelection(null);if(c<1||c>114)return;const count=catalog?.chapters[c-1]?.ayah_count;if(!Number.isInteger(a)||a<1||a>count){setError('That ayah is outside this surah.');return;}setError('');keyboardCursor.current={chapter:c,ayah:a};if(c!==chapter)setData(null);setChapter(c);setAyah(a);setRangeEnd(null);if(c===chapter){const verse=root.current?.querySelector(`[data-ayah="${a}"]`);verse?.scrollIntoView({block:'start'});if(keyboard)verse?.focus({preventScroll:true});}}
  keyboardHandler.current=event=>{
    if(!isVisible()||!isReadingAdvanceKey(event))return;
    const target=event.target,outer=root.current.closest('.workspace-reader');
    if(target!==document.body&&target!==document.documentElement&&target!==outer&&!root.current.contains(target))return;
    if([...document.querySelectorAll('dialog[open],[role=dialog][aria-modal=true]')].some(dialog=>dialog.getClientRects().length)||!window.getSelection()?.isCollapsed)return;
    event.preventDefault();if(event.repeat)return;
    if(!progress?.loaded||progress.error){setKeyboardMessage('Reading progress is unavailable. Retry progress before marking the next ayah.');return;}
    let current=keyboardCursor.current||{chapter,ayah};if(!data||data.chapter!==current.chapter)return;
    if(!keyboardCursor.current){const top=(outer?.getBoundingClientRect().top||0)+stickyTop+toolbarHeight+25,bottom=outer?.getBoundingClientRect().bottom||innerHeight,currentElement=root.current.querySelector(`[data-ayah="${current.ayah}"]`),rect=currentElement?.getBoundingClientRect();
      if(!rect||rect.bottom<=top||rect.top>=bottom){const visible=[...root.current.querySelectorAll('[data-ayah]')].find(el=>el.getBoundingClientRect().bottom>top);if(visible)current={chapter,ayah:Number(visible.dataset.ayah)};}}
    keyboardCursor.current=current;progress.set(current.chapter,current.ayah,true);
    const next=nextReadingAyah(current.chapter,current.ayah,catalog.chapters);setKeyboardReading(true);
    if(!next){setKeyboardMessage('End of the Qur’an.');return;}
    setKeyboardMessage('');keyboardCursor.current=next;go(next.chapter,next.ayah,{keyboard:true});
  };
  useEffect(()=>{const key=event=>{if(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End'].includes(event.key)&&!event.target.closest?.('input,textarea,[contenteditable=true]'))keyboardCursor.current=null;keyboardHandler.current?.(event);};const pointer=()=>{keyboardCursor.current=null;};
    document.addEventListener('keydown',key);window.addEventListener('wheel',pointer,{passive:true});window.addEventListener('touchstart',pointer,{passive:true});window.addEventListener('pointerdown',pointer,{passive:true});
    return()=>{document.removeEventListener('keydown',key);window.removeEventListener('wheel',pointer);window.removeEventListener('touchstart',pointer);window.removeEventListener('pointerdown',pointer);};
  },[]);
  function submit(e){e.preventDefault();const match=/^(\d{1,3})(?::(\d{1,3}))?$/.exec(jump.trim());if(!match){setError('Use a reference such as 4:59.');return;}go(Number(match[1]),Number(match[2]||1));}
  function resize(next){const el=root.current?.querySelector(`[data-ayah="${ayah}"]`),top=el?.getBoundingClientRect().top;setAppearance(next);writeReadingPreferences(localStorage,next);requestAnimationFrame(()=>{const parent=root.current?.closest('.workspace-reader');if(el&&parent&&top!=null)parent.scrollTop+=el.getBoundingClientRect().top-top;});}
  async function exactTools(){try{const bound=binding || await api.post('quran/binding',{project_id:projectId,...context,owner_confirmed:true});onOpen(bound.record_id,projectId,'',bound.document.id);}catch(e){setSideError(e.message);}}
  useLayoutEffect(()=>{if(data)root.current?.querySelector(`[data-ayah="${ayah}"]`)?.scrollIntoView({block:'start'});},[notes]);
  useEffect(()=>{const reveal=()=>requestAnimationFrame(()=>root.current?.querySelector(`[data-ayah="${contextRef.current.ayah_start}"]`)?.scrollIntoView({block:'start'}));window.addEventListener('resize',reveal);return()=>window.removeEventListener('resize',reveal);},[]);
  useEffect(()=>{if(!initialReference||!ready)return;if(initialReference.chapter!==chapter||initialReference.ayah_start!==ayah){setChapter(initialReference.chapter);setAyah(initialReference.ayah_start);setRangeEnd(initialReference.ayah_end>initialReference.ayah_start?initialReference.ayah_end:null);requestAnimationFrame(()=>root.current?.querySelector(`[data-ayah="${initialReference.ayah_start}"]`)?.scrollIntoView({block:'start'}));}if(initialReference.resource_key)setResource(initialReference.resource_key);if(initialReference.note_scope){setScope(initialReference.note_scope);setNotes(true);}},[initialReference?.chapter,initialReference?.ayah_start,initialReference?.resource_key,initialReference?.note_scope]);
  async function loadMarks(append=false){try{const value=await api.request('quran/marks',{project_id:projectId,chapter,...(append?{cursor:marksCursor}:{})});
    if(!Array.isArray(value.items)||value.items.some(row=>row.project_id!==projectId||!new RegExp('^Q '+chapter+':[0-9]+$').test(row.locator)))throw new Error('Saved highlights did not match this reading.');
    if(contextRef.current.chapter!==chapter)return;setMarks(rows=>append?[...new Map([...rows,...value.items].map(row=>[row.id,row])).values()]:value.items);setMarksCursor(value.next_cursor);setMarksError('');
  }catch(e){setMarksError(e.message);}}
  useEffect(()=>{setMarks([]);setMarksCursor(null);loadMarks();},[chapter,refresh]);
  function inspectSelection(){try{const selected=window.getSelection(),element=selected?.anchorNode?.parentElement?.closest('[data-resource]');
    if(!element||!root.current?.contains(element)||selected.isCollapsed){setSelection(null);setSelectionPosition(null);return;}
    const target=element.closest('[data-ayah]'),found=selectedPassage(element,selected);
    setSelection(found?{...found,chapter,ayah:Number(target.dataset.ayah),resource_key:element.dataset.resource,text_sha256:element.dataset.textSha}:null);
    selectionRect.current=found?selected.getRangeAt(0).getBoundingClientRect():null;
    setSelectionPosition(found?selectionToolbarPosition(selectionRect.current,innerWidth,innerHeight):null);
  }catch{setSelection(null);setSelectionPosition(null);}}
  useEffect(()=>{let timer;const update=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(isVisible())inspectSelection();},120);};document.addEventListener('selectionchange',update);return()=>{clearTimeout(timer);document.removeEventListener('selectionchange',update);};},[chapter,data]);
  useLayoutEffect(()=>{if(!selectionPanel.current)return;const panel=selectionPanel.current;const measure=()=>{if(!selectionRect.current)return;const rect=panel.getBoundingClientRect();setSelectionPosition(selectionToolbarPosition(selectionRect.current,innerWidth,innerHeight,{width:selection?.resource_key==='tanzil-uthmani'?340:240,height:rect.height}));};measure();const observer=new ResizeObserver(measure);observer.observe(panel);return()=>observer.disconnect();},[selection?.resource_key,selection?.chapter,selection?.ayah,selection?.start,selection?.end]);
  useEffect(()=>{if(!selection)return;const update=()=>{const selected=window.getSelection();if(selected?.rangeCount&&!selected.isCollapsed){selectionRect.current=selected.getRangeAt(0).getBoundingClientRect();const panel=selectionPanel.current?.getBoundingClientRect();setSelectionPosition(selectionToolbarPosition(selectionRect.current,innerWidth,innerHeight,{width:selection.resource_key==='tanzil-uthmani'?340:240,height:panel?.height}));}};window.addEventListener('scroll',update,true);window.addEventListener('resize',update);return()=>{window.removeEventListener('scroll',update,true);window.removeEventListener('resize',update);};},[selection]);
  useLayoutEffect(()=>{if(!layout.current)return;const measure=()=>setAvailableWidth(layout.current.getBoundingClientRect().width);measure();const observer=new ResizeObserver(measure);observer.observe(layout.current);return()=>observer.disconnect();},[]);
  function resizeMargin(value){const outer=root.current?.closest('.workspace-reader'),top=(outer?.getBoundingClientRect().top||0)+stickyTop+toolbarHeight;
    const element=[...root.current.querySelectorAll('[data-ayah]')].find(node=>node.getBoundingClientRect().bottom>top+20);
    resizeAnchor.current=element&&outer?{element,outer,top:element.getBoundingClientRect().top}:null;
    const next=marginWidth(value,availableWidth);setPreferredWidth(next);try{localStorage.setItem(marginWidthKey,String(next));}catch{/* Resizing still works for this session. */}
  }
  resizeAction.current=resizeMargin;
  useEffect(()=>{const move=event=>{if(marginDrag.current===event.pointerId&&layout.current)resizeAction.current(layout.current.getBoundingClientRect().right-event.clientX);};
    const end=()=>{marginDrag.current=null;};window.addEventListener('pointermove',move);window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);window.addEventListener('blur',end);
    return()=>{end();window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end);window.removeEventListener('blur',end);};
  },[]);
  useLayoutEffect(()=>{const anchor=resizeAnchor.current;if(anchor?.element.isConnected)anchor.outer.scrollTop+=anchor.element.getBoundingClientRect().top-anchor.top;resizeAnchor.current=null;},[notesWidth]);
  async function saveSelection(){const held=drafts.current.get(captureKey);if(held?.saving||(!selection&&!held))return;
    const draft=held||{selection,annotation_uuid:crypto.randomUUID(),projectId,workspaceMode:'quran'};
    drafts.current.set(captureKey,{...draft,saving:true,error:''});changed();
    try{const picked=draft.selection;let sent=draft.sent;
      if(!sent){const bound=await api.post('quran/binding',{project_id:projectId,resource_key:picked.resource_key,chapter:picked.chapter,ayah_start:picked.ayah,ayah_end:picked.ayah,note_scope:'verse',owner_confirmed:true});
        if(bound.project_id!==projectId||bound.resource_key!==picked.resource_key||bound.reference?.chapter!==picked.chapter||bound.reference?.ayah_start!==picked.ayah||bound.reference?.ayah_end!==picked.ayah||bound.document.text_sha256!==picked.text_sha256||Array.from(bound.document.text_body).slice(picked.start,picked.end).join('')!==picked.exact)throw new Error('The selected text version changed. Your selection is retained.');
        sent={project_id:projectId,document_id:bound.document.id,annotation_uuid:draft.annotation_uuid,text_sha256:bound.document.text_sha256,start:picked.start,end:picked.end,exact:picked.exact,capture_kind:'comment',body:'',mark_style:'highlight'};
        draft.bound=bound;draft.sent=sent;drafts.current.set(captureKey,{...draft,saving:true});changed();}
      const row=verifyReadingCapture(await api.post('reading/annotations',sent),sent);
      drafts.current.delete(captureKey);changed();setSelection(null);window.getSelection()?.removeAllRanges();setChapter(picked.chapter);setAyah(picked.ayah);setResource(picked.resource_key);setScope('verse');setRangeEnd(null);setNotes(true);setActiveMark(row.id);setFocusRequest(n=>n+1);noteEditor?.adopt(row,draft.bound.record_id);noteEditor?.open(row.id);setRefresh(n=>n+1);
    }catch(e){drafts.current.set(captureKey,{...draft,saving:false,error:e.message});changed();}}
  function markedText(row,kind){const key=kind==='arabic'?'tanzil-uthmani':'itani-god',text=row[kind];
    const related=marks.filter(mark=>mark.resource_key===key&&mark.locator===`Q ${chapter}:${row.ayah}`).map(mark=>noteEditor?.entries.get(mark.id)?.server||mark),document={project_id:projectId,id:related[0]?.document_id,text_body:text.text,text_sha256:text.text_sha256};
    return readingMarks(document,related).runs.map(run=>run.highlight||run.underline?<mark key={run.start} className={`${run.underline?'quran-underlined ':''}${notes&&run.ids.includes(activeMark)?'quran-selected-mark':''}`} tabIndex={0} role="button" aria-label="Open passage note" onMouseDown={e=>e.preventDefault()} onClick={()=>openMark(run.ids,row.ayah,key)} onKeyDown={e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();openMark(run.ids,row.ayah,key);}}}>{run.text}</mark>:<React.Fragment key={run.start}>{run.text}</React.Fragment>);
  }
  function openMark(ids,a,key){keyboardCursor.current=null;setKeyboardMessage('');const id=ids[(ids.indexOf(activeMark)+1)%ids.length],row=marks.find(mark=>mark.id===id);if(row?.source_record_id&&noteEditor){noteEditor.adopt(row,row.source_record_id);noteEditor.open(id);}setActiveMark(id);setFocusRequest(n=>n+1);setAyah(a);setResource(key);setScope('verse');setRangeEnd(null);setNotes(true);}
  useLayoutEffect(()=>{const tabs=root.current?.closest('.workspace-reader')?.querySelector('.working-tabs'),bar=root.current?.querySelector('.quran-toolbar');if(!bar)return;
    const measure=()=>{setStickyTop(tabs?Math.max(0,tabs.getBoundingClientRect().height+(parseFloat(getComputedStyle(tabs).top)||0))+8:0);setToolbarHeight(bar.getBoundingClientRect().height);};measure();const observer=new ResizeObserver(measure);observer.observe(bar);if(tabs)observer.observe(tabs);return()=>observer.disconnect();
  },[ready]);
  const selected=data?.verses[ayah-1];
  const exactMode=scope==='verse'&&marks.some(row=>row.id===activeMark&&row.document_id===binding?.document?.id);
  return <section ref={root} onKeyDown={event=>{if(event.altKey&&event.key.toLowerCase()==='n'&&selection&&!event.target.closest('textarea,input,[contenteditable=true]')){event.preventDefault();saveSelection();}}} className="quran-reader" data-reading-theme={appearance.theme} style={{...readingStyle(appearance),'--quran-sticky-top':stickyTop+'px','--quran-toolbar-height':toolbarHeight+'px','--quran-arabic-size':arabicSize*appearance.zoom/100+'px','--quran-arabic-font':arabicFont}}>
    <DocumentNavigation><details className="quran-sidebar-surahs" open><summary>Surahs</summary><nav aria-label="Surahs">{catalog?.chapters.map(row=><button key={row.chapter} data-document-open="" aria-current={row.chapter===chapter?'page':undefined} onClick={()=>go(row.chapter,1)}><span>{row.chapter}. {row.label}</span>{progress?.loaded&&<small aria-label={`${progress.counts(row.chapter).chapter} of ${row.ayah_count} ayahs read`}>{progress.counts(row.chapter).chapter}/{row.ayah_count}</small>}</button>)}</nav></details></DocumentNavigation>
    <header className="quran-toolbar"><div className="quran-location"><button aria-label="Previous surah" disabled={!catalog||chapter===1} onClick={()=>go(chapter-1,1)}>←</button><span className="quran-current-surah" aria-label="Current surah">{chapter}. {catalog?.chapters[chapter-1]?.label||'Qur’an'}{progress?.loaded&&<small className="quran-chapter-progress">{progressCounts.chapter}/{catalog.chapters[chapter-1].ayah_count} read</small>}</span><button aria-label="Next surah" disabled={!catalog||chapter===114} onClick={()=>go(chapter+1,1)}>→</button></div>
      <form onSubmit={submit}><input aria-label="Go to verse" placeholder="4:59" value={jump} onChange={e=>setJump(e.target.value)}/><button>Go</button></form><SaveReadingToLibrary key={projectId+resource} api={api} prepare={async()=>{const value=await api.post('quran/binding',{project_id:projectId,resource_key:resource,chapter,ayah_start:ayah,ayah_end:ayah,note_scope:'verse',owner_confirmed:true});return {record_id:value.record_id,document_id:value.document.id};}}/>
        <ReadingAppearance value={appearance} onChange={resize} continuousOnly>
        <fieldset className="quran-translation-options"><legend>English translation</legend><span>Talal Itani · ClearQuran</span><small>Current translation</small><a href={`https://quran.com/${chapter}/${ayah}?translations=131`} target="_blank" rel="noreferrer">Dr. Mustafa Khattab · The Clear Quran ↗</a><small>Read on Quran.com. Not connected inside Atlas yet.</small></fieldset>
      </ReadingAppearance><button aria-pressed={notes} onClick={()=>setNotes(v=>!v)}>Notes</button>
      {progress?.loaded&&<details className="quran-progress-summary"><summary aria-label="Reading progress">{progressCounts.total.toLocaleString()}/6,236 read</summary><div><label>Qur’an completion <progress max={6236} value={progressCounts.total}/></label><p>{(progressCounts.total/6236*100).toFixed(1)}% · {catalog.chapters.filter(row=>progress.counts(row.chapter).chapter===row.ayah_count).length}/114 surahs complete</p><small>Space or Right Arrow marks the current ayah read and advances. Scrolling saves your place separately.</small></div></details>}
    </header>
    {keyboardMessage&&<p className="quran-keyboard-status" role="status">{keyboardMessage}</p>}
    {progress?.error&&<p className="quran-progress-error" role="alert">{progress.error} <button onClick={()=>progress.load()}>Retry progress</button></p>}
    {progress?.failures().map(([key,queue])=><div key={key} className="quran-progress-error" role="alert">Read mark for Q {key} is not saved. <button onClick={()=>queue.retry()}>Retry read mark</button>{queue.status.phase==='conflict'&&<><span>Another device saved {queue.status.current?.is_read?'read':'unread'}.</span><button onClick={()=>{const [c,a]=key.split(':').map(Number);progress.resolve(c,a,'saved');}}>Use saved progress</button><button onClick={()=>{const [c,a]=key.split(':').map(Number);progress.resolve(c,a,'mine');}}>Keep my read mark</button></>}</div>)}
    <div className="quran-view-options"><button aria-pressed={arabic} disabled={arabic&&!english} onClick={()=>resize({...appearance,showArabic:!arabic})}>Arabic</button><button aria-pressed={english} disabled={english&&!arabic} onClick={()=>resize({...appearance,showEnglish:!english})}>English</button><details><summary>Arabic type</summary><label>Size <input aria-label="Arabic text size" type="range" min="24" max="64" value={arabicSize} onChange={e=>resize({...appearance,arabicSize:Number(e.target.value)})}/></label><label>Font <select aria-label="Arabic font" value={appearance.arabicFont} onChange={e=>resize({...appearance,arabicFont:e.target.value})}><option value="geeza">Geeza Pro / Tahoma</option><option value="serif">System serif</option><option value="sans">System sans</option></select></label></details><span>Talal Itani · ClearQuran</span></div>
    {(selection||capture)&&<div ref={selectionPanel} role="region" aria-label="Selected text actions" className={'quran-selection-actions'+(selection?.resource_key==='tanzil-uthmani'?' with-translation':'')} style={selectionPosition||{left:12,bottom:12}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();setSelection(null);window.getSelection()?.removeAllRanges();}}}>
      {selection?.resource_key==='tanzil-uthmani'&&<QuranWordTranslation api={api} selection={selection} text={data?.verses[selection.ayah-1]?.arabic.text||''}/>}
      <div className="quran-selection-buttons"><button disabled={capture?.saving} onMouseDown={e=>e.preventDefault()} onClick={saveSelection}>{capture?.saving?'Saving highlight…':capture?.sent?'Retry selected note':'Note on selection'}</button>{!capture&&<button aria-label="Dismiss selection actions" onClick={()=>{setSelection(null);window.getSelection()?.removeAllRanges();}}>×</button>}</div>{capture?.error&&<span role="alert">{capture.error}</span>}</div>}
    {marksError&&<p role="status">{marksError} <button onClick={()=>loadMarks()}>Retry highlights</button></p>}
    {error&&<p role="alert">{error} <button onClick={()=>{setReady(false);setTimeout(()=>setReady(true),0);}}>Retry reading</button></p>}
    {['error','conflict'].includes(placeStatus.phase)&&<p role="status">Reading place was not saved. <button onClick={()=>placeQueue.current?.retry()}>Retry reading place</button>{placeStatus.current&&<button onClick={()=>{const saved=placeStatus.current;placeQueue.current.revision=saved.revision;placeQueue.current.sent=null;placeQueue.current.retry();}}>Keep this reading place</button>}</p>}
    {!data&&!error&&<p role="status">Opening the surah…</p>}
    <div ref={layout} className={'quran-layout'+(notes?' with-notes':'')} style={{'--quran-notes-width':notesWidth+'px'}}><main className="quran-text" translate="no" onMouseUp={inspectSelection} onKeyUp={inspectSelection} onClick={event=>{
      const text=event.target.closest('[data-resource]');if(!text||event.target.closest('mark')||!window.getSelection()?.isCollapsed)return;
      setAyah(Number(text.closest('[data-ayah]').dataset.ayah));setResource(text.dataset.resource);setScope('verse');setRangeEnd(null);setActiveMark('');
    }} aria-label="Qur’an continuous reading" aria-keyshortcuts="Space ArrowRight">
      {data&&<><h1>{data.label}</h1><p className="quran-surah-count">{data.verses.length} ayahs</p>{data.verses.map(row=><article key={row.reference.id} data-ayah={row.ayah} tabIndex={-1} aria-label={row.reference.label} className={(notes||keyboardReading)&&row.ayah===ayah?'is-current':''}>
        <div className="quran-ayah-meta"><a className="quran-ayah-number" href={`?project=${encodeURIComponent(projectId)}&view=quran&chapter=${chapter}&ayah_start=${row.ayah}`} aria-label={'Notes for '+row.reference.label} onClick={e=>{e.preventDefault();if(e.shiftKey&&notes&&row.ayah>=ayah){setRangeEnd(row.ayah);}else{setAyah(row.ayah);setRangeEnd(null);}setScope('verse');setActiveMark('');setNotes(true);}}>{chapter}:{row.ayah}</a>
        <button className="quran-read-mark" disabled={!progress?.loaded||!!progress?.error} aria-pressed={!!progress?.desired(chapter,row.ayah)} aria-label={`Mark Q ${chapter}:${row.ayah} ${progress?.desired(chapter,row.ayah)?'unread':'read'}`} onClick={()=>progress.set(chapter,row.ayah,!progress.desired(chapter,row.ayah))}>{progress?.desired(chapter,row.ayah)?'Read ✓':'Mark read'}</button>{drafts.current.get(progress?.draftKey(chapter,row.ayah))?.saving&&<small className="quran-read-saving" role="status">Saving…</small>}</div>
        {arabic&&<p lang="ar" dir="rtl" className="quran-arabic" data-resource="tanzil-uthmani" data-text-sha={row.arabic.text_sha256}>{markedText(row,'arabic')}</p>}
        {english&&<p lang="en" dir="ltr" className="quran-translation" data-resource="itani-god" data-text-sha={row.translation.text_sha256}>{markedText(row,'translation')}</p>}
      </article>)}<button disabled={chapter===114} onClick={()=>go(chapter+1,1)}>Next surah →</button></>}
      {marksCursor&&<button onClick={()=>loadMarks(true)}>More saved highlights</button>}
    </main>{notes&&selected&&<div className="quran-notes-divider" role="separator" aria-label="Resize reading and notes" aria-orientation="vertical" aria-valuemin={220} aria-valuemax={marginWidth(640,availableWidth)} aria-valuenow={Math.round(notesWidth)} tabIndex={0}
      onDoubleClick={()=>resizeMargin(defaultMarginWidth)} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();resizeMargin(event.key==='Home'?220:event.key==='End'?640:notesWidth+(event.key==='ArrowLeft'?20:-20));}}}
      onPointerDown={event=>{event.preventDefault();marginDrag.current=event.pointerId;event.currentTarget.focus({preventScroll:true});}}/>}{notes&&selected&&<aside className="quran-notes" aria-label="Verse notes"><header>
      <details className="quran-note-context"><summary aria-label="Change note location">{scope==='source'?'Qur’an':scope==='surah'?data.label:`Q ${chapter}:${ayah}${rangeEnd&&rangeEnd>ayah?'–'+rangeEnd:''}`} · {resource==='itani-god'?'English':'Arabic'}</summary>
        <p>New writing stays with this reading. Existing notes keep their original location.</p>
        <nav className="quran-note-scope" aria-label="Note scope">{[['verse','Ayah'],['surah','Surah'],['source','Whole Qur’an']].map(([key,label])=><button key={key} aria-pressed={scope===key} onClick={event=>{setScope(key);setActiveMark('');event.currentTarget.closest('details').open=false;}}>{label}</button>)}</nav>
        <div className="quran-note-resource"><button aria-pressed={resource==='itani-god'} onClick={event=>{setResource('itani-god');setActiveMark('');event.currentTarget.closest('details').open=false;}}>English notes</button><button aria-pressed={resource==='tanzil-uthmani'} onClick={event=>{setResource('tanzil-uthmani');setActiveMark('');event.currentTarget.closest('details').open=false;}}>Arabic notes</button></div>
        <small>{resource==='itani-god'?'Talal Itani · ClearQuran':'Tanzil · Uthmani'} · {data.resources.find(row=>row.key===resource)?.version}</small>
        {scope==='verse'&&<><button className="quran-passage-tools" onClick={exactTools}>Open passage tools ↗</button><small className="quran-range-hint">Shift-click another ayah number for a range.</small></>}
      </details><button aria-label="Close notes" onClick={()=>setNotes(false)}>×</button></header>
      {sideError&&<p role="alert">{sideError}</p>}
      {scope==='verse'&&binding?.document&&noteEditor&&marks.filter(row=>row.document_id===binding.document.id).map(row=><SavedPassageNote compact locationLabel={binding.reference.label} autoSave focusRequest={focusRequest} hidden={!!activeMark&&row.id!==activeMark} key={row.id} row={row} sourceId={binding.record_id} document={binding.document} editor={noteEditor} reopen={async(row,exportFile)=>{if(exportFile){try{const value=await api.request('reading/annotation',{project_id:projectId,annotation_id:row.id});if(value.annotation?.id!==row.id||value.annotation.project_id!==projectId)throw new Error('Annotation export identity changed');const url=URL.createObjectURL(new Blob([JSON.stringify(value.web_annotation,null,2)],{type:'application/ld+json'}));const link=window.document.createElement('a');link.href=url;link.download='private-research-annotation.jsonld';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setSideError(e.message);}}else{setActiveMark(row.id);root.current?.querySelector(`[data-ayah="${ayah}"]`)?.scrollIntoView({block:'start'});}}} api={api} drafts={drafts} changed={changed} navigate={onOpen} onOpenVerse={ref=>{go(ref.chapter,ref.ayah_start);setNotes(true);}} active={row.id===activeMark} onTrashChange={()=>setRefresh(n=>n+1)}/>)}
      {activeMark&&!exactMode&&!sideError&&<p role="status">Opening the selected text’s note…</p>}
      {activeMark&&<button className="quran-all-notes" onClick={()=>setActiveMark('')}>← All ayah notes</button>}
      <div hidden={!!activeMark}>
      {scope==='verse'&&binding?.document&&<LocationMarginNotes locationLabel={binding.reference.label} onReturn={()=>{const ref=binding.reference;go(ref.chapter,ref.ayah_start);setRangeEnd(ref.ayah_end>ref.ayah_start?ref.ayah_end:null);requestAnimationFrame(()=>root.current?.querySelector(`[data-ayah="${ref.ayah_start}"]`)?.focus({preventScroll:true}));}} key={binding.document.id+':'+refresh} api={api} record={{id:binding.record_id,project_id:projectId}} document={binding.document} textRoot={textRoot} drafts={drafts} changed={changed} onOpenNotebook={onOpenNotebook} navigate={onOpen} hideComposer/>}
      {scope!=='verse'&&broadNotes.map(row=><QuranWriting key={row.id+':'+row.revision} initialNote={row} api={api} projectId={projectId} context={context} drafts={drafts} changed={changed} onSettled={()=>setRefresh(n=>n+1)}/>)}
      {broadCursor&&<button onClick={async()=>{try{const page=await api.request('quran/notes',{project_id:projectId,resource_key:resource,chapter,note_scope:scope,cursor:broadCursor});setBroadNotes(rows=>[...rows,...page.items]);setBroadCursor(page.next_cursor);}catch(e){setSideError(e.message);}}}>Earlier notes</button>}
      <QuranWriting key={contextKey+':'+composer} api={api} projectId={projectId} context={context} drafts={drafts} changed={changed} onSettled={()=>{setRefresh(n=>n+1);setComposer(n=>n+1);}}/>
      </div>
      <details><summary>Commentary & related sources</summary><VerseMaterialList api={api} projectId={projectId} reference={{...selected.reference,ayah_end:context.ayah_end}} onOpen={onOpen}/></details>
    </aside>}</div>
    {data&&<footer className="quran-attribution">{data.resources.map(row=><details key={row.resource_id}><summary>{row.attribution}</summary><p>{row.label} · {row.version}</p><a href={row.attribution_url} target="_blank" rel="noreferrer">Source ↗</a> · <a href={row.license_url} target="_blank" rel="noreferrer">License & terms ↗</a><pre>{row.source_notice}</pre><p>{row.review_limit}</p></details>)}<details><summary>Other translations</summary>{catalog?.unavailable.map(row=><p key={row.key}>{row.label}: {row.reason}</p>)}</details></footer>}
  </section>;
}
