/** Device-local presentation only. Never persist research content or identities. */
export const readingPreferencesKey='research:reading-appearance:v1';
export const readingDefaults=Object.freeze({size:22,notesSize:17,font:'serif',spacing:1.65,width:'comfortable',theme:'auto',zoom:100,mode:'scroll'});
const number=(value,fallback,min,max)=>typeof value==='number'&&Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;
const choice=(value,options,fallback)=>options.includes(value)?value:fallback;
export function normalizeReadingPreferences(value){
  const v=value&&typeof value==='object'?value:{};
  return {size:Math.round(number(v.size,22,14,48)),notesSize:Math.round(number(v.notesSize,17,12,32)),
    font:choice(v.font,['serif','book','sans'],'serif'),spacing:number(v.spacing,1.65,1.3,2.2),
    width:choice(v.width,['narrow','comfortable','wide'],'comfortable'),theme:choice(v.theme,['auto','light','paper','dark'],'auto'),
    zoom:Math.round(number(v.zoom,100,80,200)),mode:choice(v.mode,['scroll','pages'],'scroll')};
}
export function readReadingPreferences(storage){try{return normalizeReadingPreferences(JSON.parse(storage.getItem(readingPreferencesKey)));}catch{return {...readingDefaults};}}
export function writeReadingPreferences(storage,value){try{storage.setItem(readingPreferencesKey,JSON.stringify(normalizeReadingPreferences(value)));return true;}catch{return false;}}
export const readingFonts={serif:'Georgia, "Geeza Pro", Tahoma, serif',book:'Palatino, "Palatino Linotype", "Geeza Pro", Tahoma, serif',sans:'ui-sans-serif, system-ui, "Geeza Pro", Tahoma, sans-serif'};
export function readingStyle(value){const v=normalizeReadingPreferences(value);return {
  '--reading-size':`${v.size*v.zoom/100}px`,'--notes-size':`${v.notesSize*v.zoom/100}px`,'--reading-font':readingFonts[v.font],
  '--reading-spacing':v.spacing,'--reading-width':{narrow:'45ch',comfortable:'65ch',wide:'85ch'}[v.width]};}
