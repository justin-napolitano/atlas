import React,{lazy,Suspense,forwardRef,useRef} from 'react';
const LiveMarkdownEditor=lazy(()=>import('./LiveMarkdownEditor.jsx'));

/** Same editor as Notes; only its measure changes in a reading margin. */
export default forwardRef(function MarginMarkdownEditor({autoFocus=false,...props},ref){
  const focused=useRef(false);
  return <div className="margin-markdown"><Suspense fallback={<small role="status">Opening editor…</small>}>
    <LiveMarkdownEditor {...props} ref={editor=>{if(typeof ref==='function')ref(editor);else if(ref)ref.current=editor;
      if(editor&&autoFocus&&!focused.current){focused.current=true;editor.focus({end:true});}}}/>
  </Suspense></div>;
});
