import React, { useRef, useState } from 'react';
import { definitiveRejection, validBoundedText } from './requestPolicy.js';
import { prepareGoldProposal } from './goldIntent.js';

// This first UI slice reviews one exact page. Multi-page manifests and rollback
// remain available through the reviewed API; they are never partially approved.
export default function GoldReviewPanel({ client, account, brain, profile, page, locallyReady }) {
  const [context, setContext] = useState(null), [items, setItems] = useState([]), [current, setCurrent] = useState(null);
  const [selected, setSelected] = useState(null), [preview, setPreview] = useState(null), [audience, setAudience] = useState([profile.user_id]);
  const [members,setMembers]=useState([{user_id:profile.user_id,display_name:profile.name||'Me'}]),[directoryTotal,setDirectoryTotal]=useState(1),[directoryOffset,setDirectoryOffset]=useState(0);
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const pendingProposal = useRef(null), pendingDecision = useRef(null);
  const selectionGeneration=useRef(0);
  const base = `${client.brain(account, brain)}/gold`;
  async function load() {
    selectionGeneration.current++;
    setBusy(true); setError('');
    try {
      const permissions = await client.request(`${base}/context`); setContext(permissions);
      try {const directory=await client.request(`${client.profile(account)}/members`);setMembers([...new Map([{user_id:profile.user_id,display_name:profile.name||'Me'},...directory.items.filter(item=>item.active)].map(member=>[member.user_id,member])).values()]);setDirectoryTotal(directory.total);setDirectoryOffset(directory.items.length);}catch {setMembers([{user_id:profile.user_id,display_name:profile.name||'Me'}]);setDirectoryTotal(1);setDirectoryOffset(1);}
      setItems((await client.request(`${base}/proposals`)).items || []);
      try { setCurrent(await client.request(`${base}/current`)); } catch (err) { if (![403,404].includes(err.status)) throw err; setCurrent(null); }
      setNotice('Only exact proposals and approved content visible to this account are shown.');return true;
    } catch (err) { if(!pendingDecision.current){setContext(null); setItems([]); setCurrent(null); setSelected(null); setPreview(null);} setError(err.message);return false; }
    finally { setBusy(false); }
  }
  async function open(proposal) {
    if(pendingDecision.current){setError('Resolve the unconfirmed decision for the inspected proposal before selecting another.');return;}
    const generation=++selectionGeneration.current;
    setSelected(proposal); setPreview(null); setError('');
    if (proposal.manifest.revisions.length !== 1) { setError('Review this multi-page manifest through the API. This panel never approves a partial preview.'); return; }
    try { const value=await client.request(`${base}/proposals/${encodeURIComponent(proposal.proposal_id)}/pages/${encodeURIComponent(proposal.manifest.revisions[0].page_id)}`);if(selectionGeneration.current===generation)setPreview(value); }
    catch (err) { if(selectionGeneration.current===generation)setError(err.message); }
  }
  async function morePeople(){
    setBusy(true);setError('');try{
      const directory=await client.request(`${client.profile(account)}/members`,{offset:directoryOffset});
      setMembers(old=>[...new Map([...old,...directory.items.filter(item=>item.active)].map(member=>[member.user_id,member])).values()]);setDirectoryTotal(directory.total);setDirectoryOffset(old=>old+directory.items.length);
    }catch(err){setError(err.message);}finally{setBusy(false);}
  }
  async function propose() {
    setBusy(true); setError('');
    try {
      if(pendingDecision.current)throw Error('Resolve the unconfirmed review before proposing another version.');
      if (!locallyReady || !page?.remote || page.remote.content.state !== 'active') throw Error('Sync the exact active page before proposing gold.');
      if (!pendingProposal.current) {
        const fresh = await client.request(`${base}/context`);
        pendingProposal.current = prepareGoldProposal(audience, normalized => ({ generation_id:fresh.generation_id,manifest:{schema_version:'v1alpha1',organization_id:profile.organization_id,manifest_id:crypto.randomUUID(),audience_brain_ids:[brain],revisions:[{brain_id:brain,page_id:page.page_id,revision_id:page.remote.revision_id}]},audience_user_ids:normalized }));
      }
      const result = await client.request(`${base}/proposals`,pendingProposal.current);
      pendingProposal.current=null; await open(result); setItems(old=>[result,...old.filter(item=>item.proposal_id!==result.proposal_id)]);
      setNotice('Exact revision proposed. Nothing has been approved or published.');
    } catch (err) { if(definitiveRejection(err))pendingProposal.current=null;setError(err.message); }
    finally { setBusy(false); }
  }
  async function decide(kind) {
    setBusy(true); setError('');
    try {
      if(pendingProposal.current)throw Error('Resolve the unconfirmed proposal before reviewing another version.');
      if (!preview || selected.manifest.revisions.length!==1 || preview.reference.revision_id!==selected.manifest.revisions[0].revision_id) throw Error('Inspect the complete exact revision before deciding.');
      if(pendingDecision.current&&(pendingDecision.current.proposal_id!==selected.proposal_id||pendingDecision.current.manifest_sha256!==selected.manifest_sha256||pendingDecision.current.kind!==kind))throw Error('The frozen decision does not match this proposal and action. Refresh its status before starting another review.');
      if (!pendingDecision.current) {
        if(!validBoundedText(reason,1000))throw Error('Keep your review reason within 1000 UTF-8 bytes. Your reason remains editable.');
        const fresh=await client.request(`${base}/state`);
        pendingDecision.current={generation_id:fresh.generation_id,decision_id:crypto.randomUUID(),proposal_id:selected.proposal_id,manifest_sha256:selected.manifest_sha256,expected_state_id:fresh.state_id,kind,reason};
      }
      const decision=await client.request(`${base}/decisions`,pendingDecision.current);
      pendingDecision.current=null; setSelected(null);setPreview(null);setReason('');await load();
      setNotice(decision.kind==='approve'?'This exact version is approved gold. Later working edits do not change it.':'Proposal rejected. Working writing is unchanged.');
    } catch (err) {if(definitiveRejection(err)){pendingDecision.current=null;if(err.status===409){selectionGeneration.current++;setSelected(null);setPreview(null);setNotice('Review state changed. Load gold review and inspect the current proposal before deciding again.');}}setError(err.message); }
    finally { setBusy(false); }
  }
  return <section className="federation-gold" aria-label="Gold review"><h2>Reviewed gold</h2>
    <p>Keep an exact approved version while the working page continues to change. No external publication happens here.</p>
    <button onClick={load} disabled={busy||!!pendingDecision.current}>Load gold review</button>
    {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
    {context&&<>
      {current?<button onClick={()=>open(current.proposal)} disabled={busy||!!pendingDecision.current}>Inspect current gold</button>:<p>No approved gold is visible to this account.</p>}
      {context.can_propose&&<><fieldset><legend>Gold audience</legend>{members.map(member=><label key={member.user_id}><input type="checkbox" checked={audience.includes(member.user_id)} disabled={busy||!!pendingProposal.current||!!pendingDecision.current||member.user_id===profile.user_id||!audience.includes(member.user_id)&&new Set(audience).size>=100} onChange={event=>setAudience(old=>event.target.checked?[...new Set([...old,member.user_id])]:old.filter(id=>id!==member.user_id))}/>{member.display_name}{member.user_id===profile.user_id?' (me)':''}</label>)}</fieldset><small>Choose up to 100 people. Everyone selected must already have access to this brain. Future members do not automatically join this audience.</small>{directoryTotal>directoryOffset&&<button onClick={morePeople} disabled={busy||!!pendingDecision.current||directoryOffset>10000}>Load more people</button>}<button onClick={propose} disabled={busy||!!pendingDecision.current||!locallyReady||!page?.remote||page.remote.content.state!=='active'}>{pendingProposal.current?'Retry exact gold proposal':'Propose synced page as gold'}</button></>}
      <ul>{items.map(item=><li key={item.proposal_id}><button onClick={()=>open(item)} disabled={busy||!!pendingDecision.current}>Inspect proposal · {item.status}</button></li>)}</ul>
    </>}
    {selected&&<article aria-label="Exact gold proposal" data-proposal-id={selected.proposal_id}><h3>Exact proposal</h3><p>Audience: {selected.audience_user_ids.map(id=>members.find(member=>member.user_id===id)?.display_name||id).join(', ')}</p>
      {preview&&<><p>Revision {preview.snapshot.revision}</p><strong>{preview.snapshot.content.title}</strong><pre>{preview.snapshot.content.body}</pre><details><summary>Review identifiers</summary><small>Revision: {preview.reference.revision_id}<br/>Manifest hash: {selected.manifest_sha256}<br/>Content checksum: {preview.content_sha256}</small></details></>}
      {context?.can_review&&selected.status==='pending'&&preview&&<><label>Review reason<input value={reason} onChange={event=>setReason(event.target.value)} disabled={busy||!!pendingDecision.current}/></label><small>Up to 1000 UTF-8 bytes.</small><p>Review is attributed to this account, including when you review your own proposal.</p>{pendingDecision.current?<><p>Unconfirmed {pendingDecision.current.kind==='approve'?'approval':'rejection'} of this exact proposal. The inspected version and audience are frozen.</p><button onClick={()=>decide(pendingDecision.current.kind)} disabled={busy}>Retry exact {pendingDecision.current.kind==='approve'?'approval':'rejection'}</button></>:<><button onClick={()=>decide('approve')} disabled={busy||!reason.trim()||!!pendingProposal.current}>Approve inspected gold</button><button onClick={()=>decide('reject')} disabled={busy||!reason.trim()||!!pendingProposal.current}>Reject inspected proposal</button></>}</>}
      {pendingDecision.current&&<button disabled={busy} onClick={async()=>{if(await load()){pendingDecision.current=null;setSelected(null);setPreview(null);setReason('');}}}>Refresh status before a new review</button>}
    </article>}
  </section>;
}
