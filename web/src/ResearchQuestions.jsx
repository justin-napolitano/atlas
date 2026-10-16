import React,{useEffect,useRef,useState} from 'react';
import ResearchNotebook from './ResearchNotebook.jsx';

export default function ResearchQuestions(props){
  const {api,projectId}=props;const [rows,setRows]=useState([]),[cursor,setCursor]=useState(null),[error,setError]=useState('');const generation=useRef(0);
  async function load(after=''){const token=++generation.current;try{const page=await api.request('records',{project_id:projectId,kind:'question',limit:25,...(after?{cursor:after}:{})});
    if(!Array.isArray(page.items)||page.items.some(row=>row.project_id!==projectId))throw new Error('Research questions did not match this project.');
    if(token===generation.current){setRows(old=>after?[...old,...page.items.filter(row=>row.kind==='question')]:page.items.filter(row=>row.kind==='question'));setCursor(page.next_cursor);setError('');}}
    catch(err){if(token===generation.current)setError(err.message);}}
  useEffect(()=>{setRows([]);setCursor(null);load();return()=>{generation.current++;};},[projectId]);
  return <ResearchNotebook {...props} mode="questions" initialCollection="writing" researchQuestions={rows} moreResearchQuestions={cursor?()=>load(cursor):null} researchQuestionError={error}/>;
}
