import React,{forwardRef,useEffect,useImperativeHandle,useLayoutEffect,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {Compartment,EditorState,StateEffect,StateField} from '@codemirror/state';
import {Decoration,EditorView,WidgetType,keymap,placeholder as hint} from '@codemirror/view';
import {defaultKeymap,history,historyKeymap} from '@codemirror/commands';
import NotebookMarkdown from './NotebookMarkdown.jsx';
import {markdownBlocks,blockSelected} from './liveMarkdown.js';
import './liveMarkdown.css';

// EditorState contains source, undo and selection. It lives with the workspace's
// in-memory draft owner, never in localStorage or another persistence authority.
const sessions=new WeakMap();
const repaint=StateEffect.define();

/** Live Markdown document: edit the current block, read the surrounding blocks.
 * Markdown stays the stored source. Rendering uses the existing safe renderer.
 * Save/retry/recovery and authorisation remain owned by the calling document.
 */
const LiveMarkdownEditor=forwardRef(function LiveMarkdownEditor({value,onChange,disabled=false,label='Note body',sessionStore,sessionKey,notes=[],complete=true,onOpen,onOpenPassage,raw=false},ref){
  const parent=useRef(null),view=useRef(null),options=useRef(null),editable=useRef(new Compartment()),external=useRef(false),previous=useRef(null);
  options.current={onChange,notes,complete,onOpen,onOpenPassage,raw};
  if(!sessions.has(sessionStore))sessions.set(sessionStore,new Map());
  const cache=sessions.get(sessionStore);
  useImperativeHandle(ref,()=>({focus:()=>view.current?.focus(),insert(text){const current=view.current;if(!current)return;const {from,to}=current.state.selection.main;current.dispatch({changes:{from,to,insert:text},selection:{anchor:from+text.length}});current.focus();}}),[]);
  useLayoutEffect(()=>{
    const roots=new Set();
    class Block extends WidgetType{
      constructor(block){super();this.block=block;this.notes=options.current.notes;this.complete=options.current.complete;}
      eq(other){return this.notes===other.notes&&this.complete===other.complete&&this.block.source===other.block.source&&this.block.from===other.block.from&&this.block.definitions===other.block.definitions;}
      toDOM(editor){
        const element=document.createElement('div');element.className='live-markdown-block';element.tabIndex=0;element.setAttribute('aria-label','Edit Markdown block');
        const activate=event=>{if(event.target.closest('button,a,input'))return;event.preventDefault();editor.dispatch({selection:{anchor:this.block.from}});editor.focus();};
        element.addEventListener('mousedown',event=>{if(event.button===0&&!event.shiftKey)activate(event);});
        element.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target===element)activate(event);});
        const root=createRoot(element);this.root=root;roots.add(root);
        const opts=options.current;
        // Resolve reference links and footnotes against the whole document.
        root.render(<NotebookMarkdown body={this.block.source+(this.block.definitions?'\n\n'+this.block.definitions:'')} notes={opts.notes} complete={opts.complete} onOpen={id=>options.current.onOpen?.(id)} onOpenPassage={id=>options.current.onOpenPassage?.(id)}/>);
        return element;
      }
      destroy(){const root=this.root;if(root){roots.delete(root);queueMicrotask(()=>root.unmount());}}
      ignoreEvent(){return true;}
    }
    function decorate(state){
      if(options.current.raw)return Decoration.none;
      const source=state.doc.toString(),decorations=[];
      for(const block of markdownBlocks(source)){
        if(blockSelected(block,state.selection.ranges))continue;
        // Reference definitions remain editable source; they are not empty widgets.
        if(['definition','footnoteDefinition','html'].includes(block.type))continue;
        decorations.push(Decoration.replace({widget:new Block(block),block:true}).range(block.from,block.to));
      }
      return Decoration.set(decorations,true);
    }
    const blocks=StateField.define({create:decorate,update(old,transaction){return transaction.docChanged||transaction.selection||transaction.effects.some(effect=>effect.is(repaint))?decorate(transaction.state):old;},provide:field=>EditorView.decorations.from(field)});
    const extensions=[history(),keymap.of([...defaultKeymap,...historyKeymap]),EditorView.lineWrapping,
      EditorView.contentAttributes.of({'aria-label':label,'aria-multiline':'true',dir:'auto',spellcheck:'true'}),
      editable.current.of([EditorView.editable.of(!disabled),EditorState.readOnly.of(disabled)]),
      EditorState.transactionFilter.of(transaction=>transaction.newDoc.length>20000?[]:transaction),hint('Start writing…'),blocks,
      EditorView.updateListener.of(update=>{cache.set(sessionKey,update.state);if(update.docChanged&&!external.current)options.current.onChange(update.state.doc.toString());})];
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
  useEffect(()=>{view.current?.dispatch({effects:[editable.current.reconfigure([EditorView.editable.of(!disabled),EditorState.readOnly.of(disabled)]),repaint.of(null)]});},[disabled,raw,notes,complete]);
  return <div className="live-markdown-editor" ref={parent}/>;
});
export default LiveMarkdownEditor;
