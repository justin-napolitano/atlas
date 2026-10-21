import React,{forwardRef,useContext,useEffect,useId,useImperativeHandle,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {createRoot} from 'react-dom/client';
import {Compartment,EditorState,StateEffect,StateField,Prec} from '@codemirror/state';
import {Decoration,EditorView,WidgetType,keymap,placeholder as hint} from '@codemirror/view';
import {defaultKeymap,history,historyKeymap} from '@codemirror/commands';
import NotebookMarkdown from './NotebookMarkdown.jsx';
import {markdownBlocks,blockSelected} from './liveMarkdown.js';
import './liveMarkdown.css';
import {PageLinkContext} from './LocalPages.jsx';
import {wikiCompletion,pageWikiText} from './pageLinks.js';

// EditorState contains source, undo and selection. It lives with the workspace's
// in-memory draft owner, never in localStorage or another persistence authority.
const sessions=new WeakMap();
const repaint=StateEffect.define();
const insertedPage=StateEffect.define();

/** Live Markdown document: edit the current block, read the surrounding blocks.
 * Markdown stays the stored source. Rendering uses the existing safe renderer.
 * Save/retry/recovery and authorisation remain owned by the calling document.
 */
const LiveMarkdownEditor=forwardRef(function LiveMarkdownEditor({value,onChange,disabled=false,label='Note body',sessionStore,sessionKey,notes=[],complete=true,onOpen,onOpenPassage,pageLinks=false,raw=false,maxLength=20000,placeholder='Start writing…',onFocus,onBlur,onKeyDown},ref){
  const parent=useRef(null),view=useRef(null),options=useRef(null),editable=useRef(new Compartment()),external=useRef(false),previous=useRef(null);
  const pageContext=useContext(PageLinkContext),[wiki,setWiki]=useState(null),[matches,setMatches]=useState([]),[active,setActive]=useState(0),[wikiError,setWikiError]=useState(''),menuId=useId(),popup=useRef(null),dismissed=useRef(null);
  options.current={onChange,notes,complete,onOpen,onOpenPassage,raw,maxLength,onFocus,onBlur,onKeyDown,pageLinks,pageContext};
  popup.current={wiki,matches,active};
  function choosePage(row){
    const editor=view.current,query=popup.current?.wiki;if(!editor||!query||!options.current.pageContext.enabled)return;
    if(editor.state.selection.main.head!==query.cursor||editor.state.doc.sliceString(query.from,query.to)!==query.raw){setWiki(null);return;}
    const insert=pageWikiText(row);setWiki(null);dismissed.current=null;
    editor.dispatch({changes:{from:query.from,to:query.to,insert},selection:{anchor:query.from+insert.length},effects:insertedPage.of(row),scrollIntoView:true});editor.focus();
  }
  useEffect(()=>{let live=true;setMatches([]);setActive(0);setWikiError('');if(!wiki)return;const timer=setTimeout(()=>pageContext.api.request('desktop/pages',{q:wiki.query,all_pages:true,limit:10}).then(row=>{if(live)setMatches(row.items);}).catch(error=>{if(live)setWikiError(error.message);}),120);return()=>{live=false;clearTimeout(timer);};},[wiki?.query,wiki?.from,pageContext.api]);
  useEffect(()=>{const editor=view.current;if(!editor)return;if(wiki){editor.contentDOM.setAttribute('aria-controls',menuId);editor.contentDOM.setAttribute('aria-expanded','true');}else{editor.contentDOM.removeAttribute('aria-controls');editor.contentDOM.removeAttribute('aria-expanded');}},[!!wiki,menuId]);
  if(!sessions.has(sessionStore))sessions.set(sessionStore,new Map());
  const cache=sessions.get(sessionStore);
  useImperativeHandle(ref,()=>({focus:({end=false}={})=>{const current=view.current;if(!current)return;if(end)current.dispatch({selection:{anchor:current.state.doc.length}});current.focus();},insert(text){const current=view.current;if(!current)return;const {from,to}=current.state.selection.main;current.dispatch({changes:{from,to,insert:text},selection:{anchor:from+text.length}});current.focus();}}),[]);
  useLayoutEffect(()=>{
    const roots=new Set();
    let focused=false;
    function focusChanged(event,editor){focused=event.type==='focus';if(!focused)setWiki(null);queueMicrotask(()=>{if(view.current===editor)editor.dispatch({effects:repaint.of(null)});});options.current[focused?'onFocus':'onBlur']?.(event);return false;}
    class Block extends WidgetType{
      constructor(block){super();this.block=block;this.notes=options.current.notes;this.complete=options.current.complete;this.pages=options.current.pageContext.enabled;}
      eq(other){return this.pages===other.pages&&this.notes===other.notes&&this.complete===other.complete&&this.block.source===other.block.source&&this.block.from===other.block.from&&this.block.definitions===other.block.definitions;}
      toDOM(editor){
        const element=document.createElement('div');element.className='live-markdown-block';element.tabIndex=0;element.setAttribute('aria-label','Edit Markdown block');
        const activate=event=>{if(event.target.closest('button,a,input'))return;event.preventDefault();editor.dispatch({selection:{anchor:this.block.from}});editor.focus();};
        element.addEventListener('mousedown',event=>{if(event.button===0&&!event.shiftKey)activate(event);});
        element.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target===element)activate(event);});
        const root=createRoot(element);this.root=root;roots.add(root);
        const opts=options.current;
        // Resolve reference links and footnotes against the whole document.
        root.render(<NotebookMarkdown body={this.block.source+(this.block.definitions?'\n\n'+this.block.definitions:'')} notes={opts.notes} complete={opts.complete} onWikiOpen={opts.pageContext.enabled?target=>options.current.pageContext.openWiki(target):undefined} onOpen={id=>options.current.onOpen?.(id)} onOpenPassage={id=>options.current.onOpenPassage?.(id)}/>);
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
        if(block.type==='html')continue;
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
          const available=options.current.pageLinks&&options.current.pageContext.enabled&&!options.current.raw&&!disabled;
          if(!available){setWiki(null);return;}
          update.view.requestMeasure({key:parent.current,read:editor=>{
            const query=wikiCompletion(editor.state.doc.toString(),editor.state.selection.main.head);
            if(!query||dismissed.current===query.raw+':'+query.from)return null;
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
  useEffect(()=>{view.current?.dispatch({effects:[editable.current.reconfigure([EditorView.editable.of(!disabled),EditorState.readOnly.of(disabled)]),repaint.of(null)]});},[disabled,raw,notes,complete,pageContext.enabled]);
  return <><div className="live-markdown-editor" ref={parent}/>{wiki&&createPortal(<div id={menuId} className="page-wiki-completion" role="listbox" aria-label="Link a page" style={{left:wiki.left,top:wiki.top}}>{matches.map((row,index)=><button role="option" aria-selected={index===active} key={row.id} onMouseDown={e=>e.preventDefault()} onClick={()=>choosePage(row)}><span>{row.title}</span><small>{row.parent_title||'Top level'}</small></button>)}{!matches.length&&<p>{wikiError||'No matching pages yet.'}</p>}</div>,document.body)}</>;
});
export default LiveMarkdownEditor;
