/** Never accept text from another chapter/version into the continuous reader. */
export async function verifyQuranChapter(value,chapter){
  if(value?.chapter!==chapter || value.profile_id!=='tanzil-structure-1.0' || !Array.isArray(value.resources) || value.resources.length!==2 || !Array.isArray(value.verses) || !value.verses.length)throw new Error('This surah could not be verified.');
  if(value.resources[0].key!=='tanzil-uthmani'||value.resources[1].key!=='itani-god')throw new Error('The named reading resource is unavailable.');
  const ids=new Set();
  for(let i=0;i<value.verses.length;i++){
    const row=value.verses[i],ref=row.reference;
    if(row.ayah!==i+1||ref?.chapter!==chapter||ref.ayah_start!==i+1||ref.ayah_end!==i+1||!ref.id||ids.has(ref.id))throw new Error('Surah verse order or identity changed.');
    ids.add(ref.id);
    for(const kind of ['arabic','translation']){
      const item=row[kind];if(typeof item?.text!=='string'||!item.text)throw new Error('Part of this reading is unavailable.');
      const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(item.text));
      if([...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('')!==item.text_sha256)throw new Error('The source text changed. Your notes have not moved.');
    }
  }
  return value;
}
export function quranReturn(record,document){
  if(!record?.attributes?.quran_resource || !document)return null;
  const match=/^Q (\d+):(\d+)(?:–(\d+))?$/.exec(document.locator);
  if(!match)return null;
  return {chapter:Number(match[1]),ayah_start:Number(match[2]),ayah_end:Number(match[3]||match[2]),resource_key:record.attributes.quran_resource};
}
