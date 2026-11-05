/** A book is browsable before project membership. Writes bind immutable text. */
export function gutenbergReaderAPI(api,binding,document){
  let confirmed=false,pending=null;
  async function ensure(){
    if(confirmed)return;
    if(!pending)pending=api.post('catalog/gutenberg/binding',binding).then(value=>{
      if(value.project_id!==binding.project_id || value.record_id!==document.source_record_id || value.document?.id!==document.id || value.document.text_sha256!==document.text_sha256)throw new Error('The saved book version did not match your reading.');
      confirmed=true;
    }).finally(()=>{pending=null;});
    return pending;
  }
  return {
    ensure,
    async request(path,query={},body){
      if(body){await ensure();return api.request(path,query,body);}
      if(path==='reading/documents')return {items:[document],next_cursor:null};
      if(path==='reading/document'){
        if(query.document_id!==document.id)throw new Error('Open this note in its original reading version.');
        return document;
      }
      return api.request(path,query);
    },
    async post(path,body){
      // The source, immutable section and first actual note commit atomically.
      if(path==='reading/annotations')return api.post('catalog/gutenberg/annotations',{binding,annotation:body});
      if(path==='notebook/entries')return api.post('catalog/gutenberg/notes',{binding,note:body});
      await ensure();return api.post(path,body);
    },
  };
}

export function verifyGutenbergPlace(row,target){
  if(!row || row.project_id!==target.project_id || row.book_id!==target.book_id || !/^[a-f0-9]{64}$/.test(row.version) || !Number.isInteger(row.section) || row.section<0 || !Number.isInteger(row.position) || row.position<0 || !Number.isInteger(row.revision) || row.revision<1)throw new Error('The reading place did not match this book.');
  return row;
}

/** One in-memory owner queue per book, exact retries and newer scrolling retained. */
export function gutenbergPlaceWriter(api,target,initial,notify=()=>{}){
  let cloud=initial,sent=null,next=null,busy=false,error='',current=null;
  const state=()=>({cloud,sent,next,busy,error,current});
  const same=(a,b)=>a&&b&&['version','section','position'].every(k=>a[k]===b[k]);
  async function flush(){
    if(busy||current||(!sent&&!next))return;
    if(!sent && same(next,cloud)){next=null;notify(state());return;}
    if(!sent){sent={...target,...next,expected_revision:cloud?.revision || 0};next=null;}
    busy=true;error='';notify(state());
    try{
      const row=verifyGutenbergPlace(await api.request('catalog/gutenberg/place',{},sent),target);
      if(row.revision!==sent.expected_revision+1 || !same(row,sent))throw new Error('Your exact reading place was not confirmed.');
      cloud=row;sent=null;
    }catch(err){error=err.message || 'Could not save your reading place.';if(err.status===409&&err.current)current=verifyGutenbergPlace(err.current,target);}
    finally{busy=false;notify(state());}
    if(!error && next)await flush();
  }
  return {state,subscribe(listener){notify=listener;notify(state());},move(value){next=value;if(!error&&!current)void flush();},retry(){return flush();},
    keepRemote(){cloud=current;current=null;next=null;sent=null;error='';notify(state());return cloud;},
    replace(){cloud=current;current=null;if(!next)next=sent;sent=null;error='';return flush();}};
}

const sessions=new WeakMap();
export function bookPlaceSession(store,key,create){
  if(!sessions.has(store))sessions.set(store,new Map());
  const held=sessions.get(store);if(!held.has(key))held.set(key,create());return held.get(key);
}
