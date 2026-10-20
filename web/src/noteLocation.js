/** Describe existing immutable anchors; never reinterpret a note as a new target. */
export function noteLocationLabel(document,position,canonicalLabel=''){
  if(canonicalLabel)return canonicalLabel;
  const chars=Array.from(document?.text_body || '');
  if(!Number.isInteger(position)||position<0||position>chars.length)return 'Reading location';
  const before=chars.slice(0,position).join('');
  // Plain-text paragraph boundaries, not print pages or inferred scripture verses.
  return `Paragraph ${1+[...before.matchAll(/\n[\t ]*\n+/g)].length}`;
}
