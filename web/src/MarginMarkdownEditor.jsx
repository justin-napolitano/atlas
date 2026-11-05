import React,{lazy,Suspense,forwardRef,useRef} from 'react';
const LiveMarkdownEditor=lazy(()=>import('./LiveMarkdownEditor.jsx'));

/** Same editor as Notes; only its measure changes in a reading margin. */
export default forwardRef(function MarginMarkdownEditor({autoFocus=false,complete=false,...props},ref){
  const focused=useRef(false),mounted=useRef(null);
  return <div className="margin-markdown"><Suspense fallback={<small role="status">Opening editor…</small>}>
    <LiveMarkdownEditor {...props} complete={complete} ref={editor=>{mounted.current=editor;if(typeof ref==='function')ref(editor);else if(ref)ref.current=editor;
      if(editor&&autoFocus&&!focused.current){focused.current=true;queueMicrotask(()=>{if(mounted.current===editor)editor.focus({end:true});});}}}/>
  </Suspense></div>;
});
