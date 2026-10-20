export const marginWidthKey='research:quran-notes-width-v1';
export const defaultMarginWidth=360;
/** Geometry only; saved note bodies and source selectors never enter preferences. */
export function marginWidth(value,available=1200){
  const maximum=Math.min(640,Math.max(220,available-340));
  return Math.min(maximum,Math.max(220,Number.isFinite(Number(value))?Number(value):defaultMarginWidth));
}
export function selectionToolbarPosition(rect,width,height,size={}){
  const actionWidth=Math.min(size.width||240,width-24),actionHeight=Math.min(size.height||48,height-24);
  return {left:Math.max(12,Math.min(rect.left,width-actionWidth-12)),
    top:Math.max(12,Math.min(rect.bottom+8+actionHeight<=height?rect.bottom+8:rect.top-actionHeight-8,height-actionHeight-12)),maxWidth:actionWidth};
}
