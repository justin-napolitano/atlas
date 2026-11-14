// Isolated synthetic boundary. Never an application entry point or auth bypass.
import React from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/style.css';
import '../../src/workspace.css';
import '../../src/atlasWorkspace.css';
window.__workspaceRequests=[];
const notes=new Map(),history=new Map();
window.__syntheticWriting={notes,history};
window.fetch=async (input,options={})=>{
 const url=new URL(typeof input==='string'?input:input.url,location.href);
 if(!url.pathname.startsWith('/v1/'))throw Error('Unexpected synthetic fetch');
 const path=url.pathname.slice(4);window.__workspaceRequests.push(path);
 let value={items:[],next_cursor:null};
 const sent=options.body?JSON.parse(options.body):null;
 if(path==='workspace/notes'){
  if(sent){value={...sent,id:'urn:research:notebook:'+sent.request_uuid,project_id:null,revision:1,title_mode:sent.title?'manual':'automatic',title:sent.title||'Synthetic writing',trashed:false};notes.set(value.id,value);history.set(value.id,[structuredClone(value)]);}
  else value={items:[...notes.values()],next_cursor:null};
 }
 if(path==='workspace/note'){
  const id=sent?.entry_id||url.searchParams.get('entry_id'),previous=notes.get(id);
  if(sent){value={...previous,...sent,revision:previous.revision+1};notes.set(id,value);history.get(id).unshift(structuredClone(value));}else value=previous;
 }
 if(path==='workspace/draft'&&sent)value={...sent,id:'urn:research:writing-draft:'+sent.draft_uuid,revision:sent.expected_revision+1};
 if(path==='workspace/note/history')value={items:(history.get(url.searchParams.get('entry_id'))||[]).map(snapshot=>({revision:snapshot.revision,snapshot})),next_before_revision:null};
 if(path==='me')value={mode:'owner',can_edit:true};
 if(path==='desktop/capabilities')value={local_sources:false,pages:false,github_vault:false};
 if(path==='workspace/continue')value={reading:[],documents:[],notes:[],drafts:[]};
 return new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
};
import('../../src/ConnectedWorkspace.jsx').then(({default:ConnectedWorkspace})=>createRoot(document.getElementById('root')).render(<ConnectedWorkspace/>));
