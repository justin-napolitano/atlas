// Isolated synthetic boundary. Never an application entry point or auth bypass.
import React from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/style.css';
import '../../src/workspace.css';
import '../../src/atlasWorkspace.css';
window.__workspaceRequests=[];
window.fetch=async input=>{
 const url=new URL(typeof input==='string'?input:input.url,location.href);
 if(!url.pathname.startsWith('/v1/'))throw Error('Unexpected synthetic fetch');
 const path=url.pathname.slice(4);window.__workspaceRequests.push(path);
 let value={items:[],next_cursor:null};
 if(path==='me')value={mode:'owner',can_edit:true};
 if(path==='desktop/capabilities')value={local_sources:false,pages:false,github_vault:false};
 if(path==='workspace/continue')value={reading:[],documents:[],notes:[],drafts:[]};
 return new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
};
import('../../src/ConnectedWorkspace.jsx').then(({default:ConnectedWorkspace})=>createRoot(document.getElementById('root')).render(<ConnectedWorkspace/>));
