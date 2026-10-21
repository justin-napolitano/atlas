/** Organizational location only; offsets count Unicode code points, never UTF-16 units. */
export const boundedPosition=(text,position)=>Number.isInteger(position)&&position>=0&&position<=Array.from(text).length?position:null;
export function readingPosition(root){
  if(!root)return 0;
  const doc=root.ownerDocument,box=root.getBoundingClientRect(),container=root.closest('[data-contained-reader],.workspace-reader');
  const top=Math.max(0,container?.getBoundingClientRect().top || 0),y=Math.min(box.bottom-1,Math.max(box.top+1,top+24));
  const x=Math.max(0,Math.min(window.innerWidth-1,box.left+Math.min(box.width/2,24)));
  try{
    const caret=doc.caretPositionFromPoint?.(x,y),range=caret?null:doc.caretRangeFromPoint?.(x,y);
    const node=caret?.offsetNode || range?.startContainer,offset=caret?.offset ?? range?.startOffset;
    if(node&&root.contains(node)){const before=doc.createRange();before.selectNodeContents(root);before.setEnd(node,offset);return Array.from(before.toString()).length;}
  }catch{/* Geometry fallback is deliberately approximate. */}
  return Math.round(Math.max(0,Math.min(1,(top-box.top)/Math.max(1,box.height)))*Array.from(root.textContent).length);
}
export function readingPointRect(root,position){
  if(!root||boundedPosition(root.textContent,position)===null)return null;
  const doc=root.ownerDocument,walker=doc.createTreeWalker(root,4);let left=position,node;
  while((node=walker.nextNode())){const chars=Array.from(node.textContent);if(left<=chars.length){
    const range=doc.createRange(),offset=chars.slice(0,left).join('').length;range.setStart(node,offset);range.setEnd(node,Math.min(node.length,offset+(left<chars.length?chars[left].length:0)));
    if(!node.parentElement?.closest('[data-source-syntax]'))return range.getBoundingClientRect();
    let visible;while((visible=walker.nextNode())){if(!visible.parentElement?.closest('[data-source-syntax]')&&visible.length){range.setStart(visible,0);range.setEnd(visible,1);return range.getBoundingClientRect();}}
    return root.getBoundingClientRect();
  }left-=chars.length;}
  return null;
}
export function revealReadingPosition(root,position){
  let rect=readingPointRect(root,position);if(!rect)return false;
  if(root.scrollHeight>root.clientHeight){root.scrollTop+=rect.top-root.getBoundingClientRect().top-40;rect=readingPointRect(root,position);}
  const container=root.closest('[data-contained-reader],.workspace-reader');
  if(container)container.scrollTop+=rect.top-container.getBoundingClientRect().top-40;
  else window.scrollBy({top:rect.top-40});
  return true;
}
