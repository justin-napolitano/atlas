/** Validate the returned word layer against the displayed immutable Arabic. */
export function selectedWordGlosses(value,selection,text){
  if(value?.chapter!==selection.chapter||value.ayah!==selection.ayah||value.resource_key!=='tanzil-uthmani'||value.text_sha256!==selection.text_sha256||!Array.isArray(value.words)||!value.words.length||value.words.length>1000)throw new Error('Word translations did not match this Arabic edition.');
  const characters=Array.from(text);let end=0;
  for(const [i,word] of value.words.entries()){
    if(word.position!==i+1||!Number.isInteger(word.start)||!Number.isInteger(word.end)||word.start<end||word.end<=word.start||word.end>characters.length||characters.slice(word.start,word.end).join('')!==word.arabic||typeof word.translation!=='string'||!word.translation.trim()||word.translation.length>1000)throw new Error('Word boundaries did not match this Arabic edition.');
    end=word.end;
  }
  const found=value.words.filter(word=>word.start<selection.end&&word.end>selection.start);
  if(!found.length)throw new Error('Select an Arabic word to see its meaning.');
  return found;
}
