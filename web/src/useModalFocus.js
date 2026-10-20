import {useEffect} from 'react';

/** Keep keyboard focus inside a transient mobile pane, without changing its data. */
export function useModalFocus(ref,enabled){
  useEffect(()=>{
    if(!enabled||!ref.current)return;
    const root=ref.current;
    const visible=()=>[...root.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[tabindex="0"]')].filter(node=>node.getClientRects().length&&!node.closest('[hidden]'));
    visible()[0]?.focus({preventScroll:true});
    function trap(event){if(event.key!=='Tab')return;const items=visible(),first=items[0],last=items.at(-1);if(!first){event.preventDefault();return;}if(event.shiftKey&&(document.activeElement===first||!root.contains(document.activeElement))){event.preventDefault();last.focus();}else if(!event.shiftKey&&(document.activeElement===last||!root.contains(document.activeElement))){event.preventDefault();first.focus();}}
    root.addEventListener('keydown',trap);return()=>root.removeEventListener('keydown',trap);
  },[enabled,ref]);
}
