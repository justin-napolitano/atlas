import React,{useEffect,useState} from 'react';
import SourceReader from './SourceReader.jsx';
import RecordContext from './RecordContext.jsx';
import EvidencePaths from './EvidencePaths.jsx';

/** Keep source navigation inside the writing surface, without changing its page route. */
export default function NotebookSourcePane({api,projectId,target,drafts,changed,noteEditor,onNavigate,onClose,onExpand,onQuote,hidden=false}){
  const [record,setRecord]=useState(null),[error,setError]=useState('');
  const [place,setPlace]=useState(null),[trail,setTrail]=useState(null);
  useEffect(()=>{let active=true;setTrail(null);if(record?.kind==='question')api.request('evidence-path',{project_id:projectId,record_id:record.id,profile_id:'question_evidence_trail'}).then(value=>{if(active)setTrail(value);}).catch(()=>{if(active)setTrail({failed:true});});return()=>{active=false;};},[record?.id,projectId]);
  useEffect(()=>{let active=true;setRecord(null);setError('');setPlace(null);
    api.request('record',{project_id:projectId,record_id:target.recordId}).then(value=>{if(value.project_id!==projectId || value.id!==target.recordId)throw new Error('The source did not match this project.');if(active)setRecord(value);}).catch(err=>{if(active)setError(err.message || 'Could not open this source.');});
    return()=>{active=false;};},[api,projectId,target.recordId]);
  return <aside hidden={hidden} data-contained-reader onKeyDown={event=>{if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();onClose();}}} className="notebook-source-pane" aria-label="Source beside notebook">
    <header><span>Alongside your work</span><button onClick={onClose} aria-label="Close source panel">Close source ×</button></header>
    {error && <p role="alert">{error}</p>}{!error&&!record&&<p role="status">Opening the source…</p>}
    {record && <><h3 dir="auto">{record.title}</h3><button className="notebook-source-expand" onClick={()=>onExpand?.(record.id,projectId,place?.annotation_id || target.annotationId,place?.document_id || target.documentId,...(target.readingPosition!=null?[target.readingPosition]:[]))}>Open full reader ↗</button>
      {['source','work','edition'].includes(record.kind)?<SourceReader key={JSON.stringify([projectId,target.recordId,target.annotationId,target.documentId,target.readingPosition])} record={record} api={api} drafts={drafts} changed={changed} noteEditor={noteEditor} navigate={onNavigate} initialReadingPosition={target.readingPosition} initialDocumentId={target.documentId} initialAnnotationId={target.annotationId} initialMarginOpen={false} onBookmark={setPlace} onReadingPlace={setPlace} onQuote={onQuote?value=>onQuote({...value,title:record.title}):undefined}/>:<><p>{record.summary || 'No summary recorded.'}</p>{record.kind==='question'&&<><small>Research graph · {record.review_state || 'Review not stated'}</small><EvidencePaths api={api} trail={trail} onOpen={onNavigate}/></>}<RecordContext expanded api={api} record={record} onOpen={onNavigate}/></>}
    </>}
  </aside>;
}
