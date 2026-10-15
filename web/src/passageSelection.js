// DOM offsets are UTF-16; W3C text positions are Unicode code points.
export function selectionOffsets(text,start,end) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start<0 || start>=end || end>text.length) throw new Error('Select text inside this excerpt.');
  const boundaries=new Set([0]); let offset=0;
  for (const character of text) { offset+=character.length; boundaries.add(offset); }
  if (!boundaries.has(start) || !boundaries.has(end)) throw new Error('Select the whole written character.');
  if (typeof Intl.Segmenter==='function') {
    const graphemes=new Set([...new Intl.Segmenter(undefined,{ granularity:'grapheme' }).segment(text)].map(part=>part.index));
    graphemes.add(text.length);
    if (!graphemes.has(start) || !graphemes.has(end)) throw new Error('Select the whole written character.');
  }
  const exact=text.slice(start,end), size=Array.from(exact).length;
  if (size>500) throw new Error('Select up to 500 characters for one annotation.');
  return { start:Array.from(text.slice(0,start)).length,end:Array.from(text.slice(0,end)).length,exact };
}

export function selectedPassage(root,selection) {
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range=selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) throw new Error('Select text inside this excerpt.');
  const before=range.cloneRange(); before.selectNodeContents(root); before.setEnd(range.startContainer,range.startOffset);
  const through=range.cloneRange(); through.selectNodeContents(root); through.setEnd(range.endContainer,range.endOffset);
  return selectionOffsets(root.textContent,before.toString().length,through.toString().length);
}
