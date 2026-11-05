import React,{useEffect,useRef,useState} from 'react';
import './readingContext.css';

/** Located source readings and attributed preparation cards, saved only by owner choice. */
export default function ReadingCollection({api,onChoose,onOpenVerse,onClose,initialAyah='59',onVerseChange}){
  const [collection,setCollection]=useState(null),[error,setError]=useState(''),[ayah,setAyah]=useState(String(initialAyah)==='83' ? '83' : '59');const generation=useRef(0);
  async function load(){const token=++generation.current;setError('');
    try{const value=await api.request('reading/collection');if(!Array.isArray(value.readings) || !Array.isArray(value.sources) || !Array.isArray(value.context_cards))throw new Error('The identified reading collection is unavailable.');if(token===generation.current)setCollection(value);}
    catch(err){if(token===generation.current)setError(err.message);}
  }
  useEffect(()=>{load();return()=>{generation.current++;};},[]);
  const sources=new Map((collection?.sources || []).map(row=>[row.id,row]));
  const readings=(collection?.readings || []).filter(row=>row.reference.ayah_start===Number(ayah));
  const ids=new Set(readings.map(row=>row.id));
  return <section className="reading-collection" aria-labelledby="collection-heading"><header><h2 id="collection-heading">Read the question from several sources</h2><button onClick={onClose}>Back to my reading</button></header>
    {error && <p role="alert">{error} <button onClick={load}>Retry collection</button></p>}
    {!collection ? <p role="status">Loading identified reading material…</p> : <>
      <p>{collection.label}</p><p>{collection.review_limit}</p>
      <label>Verse<select value={ayah} onChange={event=>{setAyah(event.target.value);onVerseChange?.(event.target.value);}}><option value="59">Q 4:59 · authority</option><option value="83">Q 4:83 · reporting and inference</option></select></label>
      <button onClick={()=>onOpenVerse({chapter:4,ayah_start:Number(ayah),ayah_end:Number(ayah)})}>Read Arabic & linked material</button>
      <section aria-label="Before you read" className="collection-context"><h3>A little context before you read</h3>
        {collection.context_cards.filter(card=>card.reading_ids.some(id=>ids.has(id))).map(card=><details key={card.id}><summary>{card.label}</summary><p>{card.text}</p><small>Preparation paraphrase · pending review · {card.kind}</small><p>{card.scope}</p><p>{card.locator}</p><a href={card.evidence_url} target="_blank" rel="noreferrer">Inspect the located source ↗</a></details>)}
      </section>
      <div className="collection-readings">{readings.map(reading=>{const source=sources.get(reading.source_id);if(!source)return null;
        return <article key={reading.id} data-reading-id={reading.id}><small>{reading.material_kind.replaceAll('_',' ')} · named source · pending editorial review</small><h3>{source.title}</h3><p>{reading.attribution}</p><p>{source.edition}</p>
          <blockquote dir="auto" lang={source.language}>{reading.text}</blockquote><p>{reading.locator}</p><p>{reading.source_scope}</p>
          <details><summary>Preparation note & evidence checked</summary><p><strong>Agent-prepared paraphrase, separate from source wording</strong></p><p>{reading.finding.text}</p><p>{source.coverage}</p><p>Accessed {source.accessed_on} · {source.evidence.method.replaceAll('_',' ')}</p><small>{source.evidence.sha256 ? `Source snapshot ${source.evidence.sha256}` : 'Raw source snapshot unavailable; the recorded web-reader check has narrower evidence.'}</small></details>
          <details><summary>Reuse basis & source notice</summary><p>{source.rights.basis}</p><p>{source.rights.notice}</p></details>
          <a href={source.source_url} target="_blank" rel="noreferrer">Open original reading ↗</a><button onClick={()=>onChoose(collection,reading)}>Add this reading & take notes</button>
        </article>;})}</div>
      <details><summary>What this collection does not cover</summary><ul>{collection.coverage_gaps.map(text=><li key={text}>{text}</li>)}</ul></details>
    </>}
  </section>;
}
