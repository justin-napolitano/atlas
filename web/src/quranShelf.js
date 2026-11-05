// A book presentation, never a new source, edition, reading state or library ID.
export function withQuranBook(rows,{query='',state='',scope=''}={}){
  const readable=rows.filter(row=>row.reader==='quran'&&row.availability==='read');
  if(readable.length){
    // Keep the chosen resume tuple intact. Do not combine progress, notes or histories.
    const stamp=row=>Date.parse(row.read_at)||0;
    const chosen=[...readable].sort((a,b)=>stamp(b)-stamp(a))[0];
    const book={...chosen,title:'Qur’an',quran_book:true};
    let inserted=false;
    return rows.flatMap(row=>{
      if(!readable.includes(row))return [row];
      if(inserted)return [];
      inserted=true;return [book];
    });
  }
  // The pinned corpus is available before a first read. Availability is not progress.
  const term=query.trim().toLowerCase().replace(/[’']/g,'');
  if(state||scope||!['quran','koran','قرآن','القرآن'].some(name=>name.includes(term)))return rows;
  return [{id:'builtin:quran',title:'Qur’an',quran_book:true,builtin:true,
    reader:'quran',availability:'read',edition_label:'Arabic · English translations · 114 surahs'},...rows];
}
