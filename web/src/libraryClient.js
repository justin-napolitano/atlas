// Library membership is server state. These functions never store private data in the browser.
export function itemUpdate(row,patch={}){
  return {item_id:row.id,expected_revision:row.revision,on_shelf:row.on_shelf,reading_status:row.reading_status,preferred_edition_id:row.preferred_edition_id,...patch,owner_confirmed:true};
}
export function sourceRetention(api,source,documentId=''){
  // Freeze this request object across uncertain retries; indexing never creates bibliography/text.
  const payload={request_uuid:crypto.randomUUID(),project_id:source.project_id,source_record_id:source.id,expected_source_revision:source.revision,owner_confirmed:true};
  let sent=null;
  return async()=>{
    const alias=await api.post('library/index-source',payload);
    const item=await api.request('library/item',{item_id:alias.item_id});
    if(!sent){
      let preferred=item.preferred_edition_id;
      if(documentId){const target=await api.request('library/resolve',{item_id:item.id,document_id:documentId});if(!target.source_available)throw new Error('This source is unavailable.');preferred=target.edition_id;}
      sent=itemUpdate(item,{on_shelf:true,reading_status:item.reading_status==='needs_review'?'want_to_read':item.reading_status,preferred_edition_id:preferred});
    }
    const result=await api.request('library/item',{},sent);
    if(result.id!==item.id || result.revision!==sent.expected_revision+1 || !result.on_shelf || result.reading_status!==sent.reading_status || result.preferred_edition_id!==sent.preferred_edition_id)throw new Error('The exact library save was not confirmed.');
    return result;
  };
}
export function shelfTarget(row){
  if(row.availability!=='read' || !row.source_available || !row.preferred_edition_id)throw new Error('Choose a readable edition first.');
  return {project_id:row.origin_project_id,record_id:row.record_id,document_id:row.document_id,position:row.position||0,reader:row.reader,chapter:row.resume_chapter,ayah:row.resume_ayah,resource_key:row.resource_key,book_id:row.book_id,version:row.book_version};
}
