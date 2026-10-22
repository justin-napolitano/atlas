import React,{forwardRef,useContext,useEffect,useId,useImperativeHandle,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {createRoot} from 'react-dom/client';
import {Compartment,EditorState,StateEffect,StateField,Prec} from '@codemirror/state';
import {Decoration,EditorView,WidgetType,keymap,placeholder as hint} from '@codemirror/view';
import {defaultKeymap,history,historyKeymap} from '@codemirror/commands';
import NotebookMarkdown from './NotebookMarkdown.jsx';
import {markdownBlocks,blockSelected} from './liveMarkdown.js';
import './liveMarkdown.css';
import {tocCommandCompletion,SUBPAGES_MARKER} from './subpageContents.js';
import {SurfaceActivity} from './surfaceActivity.js';
import {PageLinkContext} from './LocalPages.jsx';
import {wikiCompletion,pageWikiText,wikiTargetAt} from './pageLinks.js';
import {propertyCompletion,frontmatterEdit,typeCommandCompletion,typeCommandEdit,taskCommandCompletion} from './markdownProperties.js';

// EditorState contains source, undo and selection. It lives with the workspace's
// in-memory draft owner, never in localStorage or another persistence authority.
const sessions=new WeakMap();
const repaint=StateEffect.define();
const insertedPage=StateEffect.define();

/** Live Markdown document: edit the current block, read the surrounding blocks.
 * Markdown stays the stored source. Rendering uses the existing safe renderer.
 * Save/retry/recovery and authorisation remain owned by the calling document.
 */
const LiveMarkdownEditor=forwardRef(function LiveMarkdownEditor({value,onChange,disabled=false,label='Note body',sessionStore,sessionKey,notes=[],complete=true,onOpen,onOpenPassage,pageLinks=false,properties=false,thoughtType='note',raw=false,maxLength=20000,placeholder='Start writing…',onFocus,onBlur,onKeyDown,onTask,subpages},ref){
  const parent=useRef(null),view=useRef(null),options=useRef(null),editable=useRef(new Compartment()),external=useRef(false),previous=useRef(null);
  const surfaceActive=useContext(SurfaceActivity),pageContext=useContext(PageLinkContext),[wiki,setWiki]=useState(null),[matches,setMatches]=useState([]),[active,setActive]=useState(0),[wikiError,setWikiError]=useState(''),menuId=useId(),popup=useRef(null),dismissed=useRef(null);
  options.current={onChange,notes,complete,onOpen,onOpenPassage,raw,maxLength,onFocus,onBlur,onKeyDown,pageLinks,pageContext,properties,thoughtType,disabled,onTask,subpages,surfaceActive};
  popup.current={wiki,matches,active};
  function choosePage(row){
    const editor=view.current,query=popup.current?.wiki;if(!editor||!query||options.current.disabled||(!['property','type-command','task-command','toc-command'].includes(query.kind)&&!options.current.pageContext.enabled))return;
    if(editor.state.selection.main.head!==query.cursor||editor.state.doc.sliceString(query.from,query.to)!==query.raw){setWiki(null);return;}
    if(query.kind==='toc-command'){setWiki(null);editor.dispatch({changes:{from:query.from,to:query.to,insert:row.insert},selection:{anchor:query.from+row.insert.length},scrollIntoView:true});editor.focus();return;}
    if(query.kind==='task-command'){setWiki(null);editor.dispatch({changes:{from:query.from,to:query.to,insert:''},selection:{anchor:query.from},scrollIntoView:true});options.current.onTask?.(row.insert);return;}
    if(query.kind==='type-command'){const change=typeCommandEdit(editor.state.doc.toString(),query,row.insert);setWiki(null);if(change)editor.dispatch(change);editor.focus();return;}
    const insert=query.kind==='property'?row.insert:pageWikiText(row);setWiki(null);dismissed.current=null;
    editor.dispatch({changes:{from:query.from,to:query.to,insert},selection:{anchor:query.from+insert.length-(query.kind==='property'&&insert.endsWith('[]')?1:0)},effects:query.kind==='property'?[]:insertedPage.of(row),scrollIntoView:true});editor.focus();
  }
  useEffect(()=>{let live=true;setMatches([]);setActive(0);setWikiError('');if(!wiki)return;if(['property','type-command','task-command','toc-command'].includes(wiki.kind)){setMatches(wiki.items);return;}const timer=setTimeout(()=>pageContext.api.request('desktop/pages',{q:wiki.query,all_pages:true,limit:10}).then(row=>{if(live)setMatches(row.items);}).catch(error=>{if(live)setWikiError(error.message);}),120);return()=>{live=false;clearTimeout(timer);};},[wiki?.query,wiki?.raw,wiki?.from,wiki?.kind,pageContext.api]);
  useEffect(()=>{const editor=view.current;if(!editor)return;if(wiki){editor.contentDOM.setAttribute('aria-controls',menuId);editor.contentDOM.setAttribute('aria-expanded','true');if(matches.length)editor.contentDOM.setAttribute('aria-activedescendant',menuId+'-'+active);else editor.contentDOM.removeAttribute('aria-activedescendant');document.getElementById(menuId+'-'+active)?.scrollIntoView({block:'nearest'});}else{editor.contentDOM.removeAttribute('aria-controls');editor.contentDOM.removeAttribute('aria-expanded');editor.contentDOM.removeAttribute('aria-activedescendant');}},[!!wiki,menuId,active,matches.length]);
  if(!sessions.has(sessionStore))sessions.set(sessionStore,new Map());
  const cache=sessions.get(sessionStore);
  useImperativeHandle(ref,()=>({focus:({end=false}={})=>{const current=view.current;if(!current)return;if(end)current.dispatch({selection:{anchor:current.state.doc.length}});current.focus();},insert(text){const current=view.current;if(!current)return;const {from,to}=current.state.selection.main;current.dispatch({changes:{from,to,insert:text},selection:{anchor:from+text.length}});current.focus();}}),[]);
  useLayoutEffect(()=>{
    const roots=new Set();
    let focused=false;
    function focusChanged(event,editor){focused=event.type==='focus';if(!focused)setWiki(null);queueMicrotask(()=>{if(view.current===editor)editor.dispatch({effects:repaint.of(null)});});options.current[focused?'onFocus':'onBlur']?.(event);return false;}
    class Block extends WidgetType{
      constructor(block){super();this.block=block;this.notes=options.current.notes;this.complete=options.current.complete;this.pages=options.current.pageContext.enabled;this.subpages=options.current.subpages?.epoch;this.active=options.current.surfaceActive;}
      eq(other){return this.active===other.active&&this.subpages===other.subpages&&this.pages===other.pages&&this.notes===other.notes&&this.complete===other.complete&&this.block.source===other.block.source&&this.block.from===other.block.from&&this.block.definitions===other.block.definitions;}
      toDOM(editor){
        const element=document.createElement('div');element.className='live-markdown-block';element.tabIndex=0;element.setAttribute('aria-label','Edit Markdown block');
        const activate=event=>{if(event.target.closest('button,a,input'))return;event.preventDefault();editor.dispatch({selection:{anchor:this.block.from}});editor.focus();};
        element.addEventListener('mousedown',event=>{if(event.button===0&&!event.shiftKey)activate(event);});
        element.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target===element)activate(event);});
        const root=createRoot(element);this.root=root;roots.add(root);
        const opts=options.current;
        // Resolve reference links and footnotes against the whole document.
        root.render(<SurfaceActivity.Provider value={opts.surfaceActive}><NotebookMarkdown subpages={opts.subpages} body={this.block.source+(this.block.definitions?'\n\n'+this.block.definitions:'')} notes={opts.notes} complete={opts.complete} onWikiOpen={opts.pageContext.enabled?target=>options.current.pageContext.openWiki(target):undefined} onOpen={id=>options.current.onOpen?.(id)} onOpenPassage={id=>options.current.onOpenPassage?.(id)}/></SurfaceActivity.Provider>);
        return element;
      }
      destroy(){const root=this.root;if(root){roots.delete(root);queueMicrotask(()=>root.unmount());}}
      ignoreEvent(){return true;}
    }
    function decorate(state){
      if(options.current.raw)return Decoration.none;
      const source=state.doc.toString(),decorations=[];
      for(const block of markdownBlocks(source)){
        if(focused&&blockSelected(block,state.selection.ranges))continue;
        if(block.type==='html'&&!(options.current.subpages&&block.source===SUBPAGES_MARKER))continue;
        // Definitions resolve in their referring blocks; reveal their source at
        // the cursor, without repeating raw definitions during ordinary reading.
        const widget=['definition','footnoteDefinition'].includes(block.type)?undefined:new Block(block);
        decorations.push(Decoration.replace({widget,block:true}).range(block.from,block.renderTo));
      }
      return Decoration.set(decorations,true);
    }
    const blocks=StateField.define({create:decorate,update(old,transaction){return transaction.docChanged||transaction.selection||transaction.effects.some(effect=>effect.is(repaint))?decorate(transaction.state):old;},provide:field=>EditorView.decorations.from(field)});
    const extensions=[history(),keymap.of([...defaultKeymap,...historyKeymap]),EditorView.lineWrapping,
      EditorView.contentAttributes.of({'aria-label':label,'aria-multiline':'true',dir:'auto',spellcheck:'true'}),
      editable.current.of([EditorView.editable.of(!disabled),EditorState.readOnly.of(disabled)]),
      EditorState.transactionFilter.of(transaction=>transaction.newDoc.length>options.current.maxLength?[]:transaction),hint(placeholder),blocks,
      Prec.highest(EditorView.domEventHandlers({focus:focusChanged,blur:focusChanged,keydown:event=>{
        const editor=view.current;
        if(!event.isComposing&&editor&&!options.current.disabled){
          const modifier=(event.metaKey||event.ctrlKey)&&!event.altKey;
          if(modifier&&event.shiftKey&&event.key.toLowerCase()==='m'&&options.current.properties){event.preventDefault();editor.dispatch(frontmatterEdit(editor.state.doc.toString(),options.current.thoughtType));return true;}
          if(modifier&&!event.shiftKey&&event.key==='Enter'&&options.current.pageLinks){const target=wikiTargetAt(editor.state.doc.toString(),editor.state.selection.main.head);if(target){event.preventDefault();options.current.pageContext.openWiki(target);return true;}}
          if(event.key==='Enter'&&!event.shiftKey&&!modifier&&options.current.properties&&editor.state.doc.toString()==='---'&&editor.state.selection.main.head===3){event.preventDefault();const insert='\ntype: '+options.current.thoughtType+'\ntags: []\n---\n\n';editor.dispatch({changes:{from:3,insert},selection:{anchor:10,head:10+options.current.thoughtType.length}});return true;}
        }
        const menu=popup.current;
        if(menu?.wiki&&!event.isComposing){
          if(event.key==='Escape'){event.preventDefault();dismissed.current=menu.wiki.raw+':'+menu.wiki.from;setWiki(null);return true;}
          if(menu.matches.length&&['ArrowDown','ArrowUp','Enter','Tab'].includes(event.key)){
            event.preventDefault();if(event.key==='Enter'||event.key==='Tab')choosePage(menu.matches[menu.active]);
            else setActive(index=>(index+(event.key==='ArrowDown'?1:-1)+menu.matches.length)%menu.matches.length);return true;
          }
        }
        options.current.onKeyDown?.(event);return event.defaultPrevented;
      }})),
      EditorView.updateListener.of(update=>{
        cache.set(sessionKey,update.state);
        if(update.docChanged&&!external.current){const picked=update.transactions.flatMap(tr=>tr.effects).find(effect=>effect.is(insertedPage))?.value;options.current.onChange(update.state.doc.toString(),{pageLink:picked});}
        if(update.docChanged||update.selectionSet){
          const available=(options.current.properties||options.current.pageLinks&&options.current.pageContext.enabled)&&!options.current.raw&&!disabled;
          if(!available){setWiki(null);return;}
          update.view.requestMeasure({key:parent.current,read:editor=>{
            const source=editor.state.doc.toString(),cursor=editor.state.selection.main.head;
            const query=(options.current.subpages?tocCommandCompletion(source,cursor):null)||(options.current.onTask?taskCommandCompletion(source,cursor):null)||(options.current.properties?(typeCommandCompletion(source,cursor)||propertyCompletion(source,cursor,options.current.notes)):null)||(options.current.pageLinks?wikiCompletion(source,cursor):null);
            if(!query||(['property','type-command','task-command','toc-command'].includes(query.kind)&&!query.items.length)||dismissed.current===query.raw+':'+query.from)return null;
            const rect=editor.coordsAtPos(query.cursor);return rect?{...query,left:Math.max(12,Math.min(rect.left,innerWidth-344)),top:Math.max(12,Math.min(rect.bottom+6,innerHeight-260))}:null;
          },write:next=>setWiki(next)});
        }
      })];
    // A first successful create assigns the durable ID while the user is typing.
    // Carry its cursor and undo state from the provisional key into that ID.
    const provisional=previous.current&&/"new(?:-question)?"\]$/.test(previous.current.key)?previous.current.state:null;
    const saved=cache.get(sessionKey)||provisional;
    // Rebuild extensions so callbacks belong to this mounted document; retain the
    // immutable document/selection/history through serialization-free state fields.
    const state=saved&&saved.doc.toString()===value?saved.update({effects:StateEffect.reconfigure.of(extensions)}).state:EditorState.create({doc:value,extensions});
    const editor=new EditorView({parent:parent.current,state});
    view.current=editor;
    return()=>{cache.set(sessionKey,editor.state);previous.current={key:sessionKey,state:editor.state};editor.destroy();view.current=null;for(const root of roots)queueMicrotask(()=>root.unmount());roots.clear();};
  },[sessionKey,sessionStore]);
  useEffect(()=>{const editor=view.current;if(editor&&editor.state.doc.toString()!==value){external.current=true;try{editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:value}});}finally{external.current=false;}}},[value]);
  useEffect(()=>{view.current?.dispatch({effects:[editable.current.reconfigure([EditorView.editable.of(!disabled),EditorState.readOnly.of(disabled)]),repaint.of(null)]});},[disabled,raw,notes,complete,pageContext.enabled,subpages?.epoch,surfaceActive]);
  return <><div className="live-markdown-editor" ref={parent}/>{wiki&&createPortal(<div id={menuId} className="page-wiki-completion" role="listbox" aria-label={wiki.kind==='toc-command'?'Insert contents':wiki.kind==='task-command'?'Create task':wiki.kind==='type-command'?'Change note type':wiki.kind==='property'?'Markdown properties':'Link a page'} style={{left:wiki.left,top:wiki.top}}>{matches.map((row,index)=><button id={menuId+'-'+index} role="option" aria-selected={index===active} key={row.id} onMouseDown={e=>e.preventDefault()} onClick={()=>choosePage(row)}><span>{row.title}</span><small>{['property','type-command','task-command','toc-command'].includes(wiki.kind)?'':row.parent_title||'Top level'}</small></button>)}{!matches.length&&<p>{wikiError||(wiki.kind==='property'?'Keep typing your own value.':'No matching pages yet.')}</p>}</div>,document.body)}</>;
});
export default LiveMarkdownEditor;
