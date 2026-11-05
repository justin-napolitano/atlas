import React,{useRef,useState} from 'react';
import {sourceRetention} from './libraryClient.js';
// Explicit Save may create an existing reader binding. It never claims a note/read.
export default function SaveReadingToLibrary({api,prepare}){
  const pending=useRef(null),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false),[error,setError]=useState('');
  async function save(){if(busy)return;setBusy(true);setError('');
    if(!pending.current){const bind=prepare;let retain;pending.current=async()=>{if(!retain){const target=await bind();const source=await api.request('record',{record_id:target.record_id});retain=sourceRetention(api,source,target.document_id);}return retain();};}
    try{await pending.current();setSaved(true);pending.current=null;}
    catch(err){setError(err.status===409?'Changed on another device. Reopen this reading to review it.':err.message);}
    finally{setBusy(false);}
  }
  return <span className="library-save"><button disabled={busy||saved} onClick={save}>{busy?'Saving…':saved?'In library':error?'Retry library save':'Save to library'}</button>{error&&<small role="alert">{error}</small>}</span>;
}
