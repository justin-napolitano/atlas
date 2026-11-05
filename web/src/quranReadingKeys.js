/** Reading shortcuts never replace typing, text selection or control navigation. */
export function isReadingAdvanceKey(event){
  if(event.defaultPrevented||event.isComposing||event.keyCode===229||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return false;
  if(![' ','Spacebar','ArrowRight'].includes(event.key))return false;
  return !event.target?.closest?.('input,textarea,select,button,a,summary,[contenteditable]:not([contenteditable=false]),[role=button],[role=separator],[role=slider],[role=combobox],[role=listbox],[role=option],[role=menuitem],[role=dialog],.cm-editor,.quran-notes,.reading-appearance,.quran-progress-summary,.quran-selection-actions,nav,aside');
}

export function nextReadingAyah(chapter,ayah,chapters){
  const count=chapters?.[chapter-1]?.ayah_count;
  if(!Number.isInteger(chapter)||!Number.isInteger(ayah)||!count||ayah<1||ayah>count)return null;
  if(ayah<count)return {chapter,ayah:ayah+1};
  return chapter<chapters.length?{chapter:chapter+1,ayah:1}:null;
}
