/** Keep bibliography intact while showing a short, readable edition control. */
export function readingVersionLabel(value){
  if(!value)return 'Choose a reading version';
  const shorten=(text,size)=>text.length>size?text.slice(0,size-1).trimEnd()+'…':text;
  const edition=String(value.edition || 'Edition not stated').split(/[;,]/)[0].trim();
  const locator=String(value.locator || '').split(';')[0].trim();
  return [shorten(edition,65),locator&&shorten(locator,55)].filter(Boolean).join(' · ');
}
