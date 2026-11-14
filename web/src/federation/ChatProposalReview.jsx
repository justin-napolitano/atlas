import React, { useState } from 'react';

export default function ChatProposalReview({ proposals = [], canApply, onApply }) {
  const [pending, setPending] = useState(''), [outcomes, setOutcomes] = useState({});
  async function apply(proposal) {
    setPending(proposal.proposal_id);
    try {
      await onApply(proposal);
      setOutcomes(old => ({ ...old, [proposal.proposal_id]: { applied:true,message:'Applied. Sync has refreshed the permitted page.' } }));
    } catch (error) {
      setOutcomes(old => ({ ...old, [proposal.proposal_id]: {applied:false,message:error.message || 'The result is unconfirmed. Retry this exact proposal when connected.'} }));
    } finally { setPending(''); }
  }
  return proposals.map(proposal => <section className="federation-chat-proposal" aria-label="Review chat proposal" key={proposal.proposal_id}>
    <h3>Review the proposed edit</h3><p>{outcomes[proposal.proposal_id]?.applied?'This exact proposal has been applied.':'No page changes until you apply this exact proposal.'}</p>
    <details open><summary>Exact base · revision {proposal.base?.revision}</summary><strong>{proposal.base?.content?.title}</strong><pre>{proposal.base?.content?.body}</pre><p>State: {proposal.base?.content?.state}</p></details>
    <details open><summary>Proposed version</summary><strong>{proposal.payload?.title}</strong><pre>{proposal.payload?.body}</pre><p>State: {proposal.payload?.state}</p></details>
    <p>{proposal.rationale}</p><small>Expires {new Date(proposal.expires_at).toLocaleString()}</small><details><summary>Proposal identifiers</summary><small>Page: {proposal.page_id}<br />Proposal hash: {proposal.sha256}</small></details>
    {!canApply && <p>Sync your local writing and resolve conflicts before applying a proposal.</p>}
    <button onClick={() => apply(proposal)} disabled={!canApply || !!pending || outcomes[proposal.proposal_id]?.applied}>{outcomes[proposal.proposal_id]?.applied?'Proposal applied':pending === proposal.proposal_id ? 'Applying exact proposal…' : 'Apply reviewed proposal'}</button>
    {outcomes[proposal.proposal_id] && <p role="status">{outcomes[proposal.proposal_id].message}</p>}
  </section>);
}
