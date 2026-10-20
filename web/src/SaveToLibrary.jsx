import React,{useRef,useState} from 'react';
import {sourceRetention} from './libraryClient.js';
export default function SaveToLibrary({api,source,documentId=''}){
  const pending=useRef(null),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false),[error,setError]=useState('');
  async function save(){if(busy)return;setBusy(true);setError('');
    try{pending.current ||= sourceRetention(api,source,documentId);await pending.current();setSaved(true);pending.current=null;}
    catch(err){setError(err.status===409?'Changed on another device. Reopen this source before saving.':err.message);}
    finally{setBusy(false);}
  }
  return <span className="library-save"><button disabled={busy||saved} onClick={save}>{busy?'Saving…':saved?'In library':error?'Retry library save':'Save to library'}</button>{error&&<small role="alert">{error}</small>}</span>;
}
