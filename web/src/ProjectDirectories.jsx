import React, {useRef, useState} from 'react';

// Projects are existing durable owner workspaces, not folders on the host machine.
export default function ProjectDirectories({api, projects, current, onOpen, onCreated}) {
  const [creating,setCreating]=useState(false), [title,setTitle]=useState(''), [error,setError]=useState(''), [saving,setSaving]=useState(false);
  const pending=useRef(null);
  async function save(event) {
    event.preventDefault();if(saving || !title.trim())return;
    const payload=pending.current || {project_id:'urn:research:project:'+crypto.randomUUID(),title:title.trim(),scope:''};
    pending.current=payload;setSaving(true);setError('');
    try {
      let row;
      // Reconcile an uncertain previous response before retrying the same ID.
      const existing=(await api.request('projects')).items.find(row=>row.id===payload.project_id);
      if(existing){if(existing.title!==payload.title)throw new Error('This project ID has different details. Cancel and create a new project.');row=existing;}
      else row=await api.post('projects',payload);
      if(row.id!==payload.project_id || row.title!==payload.title)throw new Error('Could not confirm the saved project. Retry to check it.');
      pending.current=null;setTitle('');setCreating(false);onCreated(row);
    } catch(err) {setError(err.message+' Retry checks the same project before creating it again.');}
    finally {setSaving(false);}
  }
  return <section className="atlas-projects" aria-label="Projects">
    <div className="atlas-projects-heading"><h2>Projects</h2><button aria-expanded={creating} onClick={()=>{setCreating(!creating);setError('');pending.current=null;setTitle('');}} disabled={saving}>{creating?'Cancel':'+ New project'}</button></div>
    <nav className="atlas-project-list" aria-label="Project directories">{projects.map(row=><button key={row.id} aria-current={row.id===current?'page':undefined} onClick={()=>onOpen(row.id)}>{row.title}</button>)}</nav>
    {!projects.length && !creating && <p>Create a project for your sources, questions, and notes.</p>}
    {creating && <form onSubmit={save}><label>Project name<input autoFocus required maxLength={200} value={title} disabled={saving || !!pending.current} onChange={event=>setTitle(event.target.value)}/></label><button type="submit" disabled={saving || !title.trim()}>{saving?'Creating…':error?'Retry creation':'Create project'}</button>{error && <p role="alert">{error}</p>}</form>}
  </section>;
}
