import React,{useEffect,useState} from 'react';
import {selectedWordGlosses} from './quranWordGloss.js';

// Ephemeral, bounded display cache only. Nothing is written to note storage.
const caches=new WeakMap();
function load(api,selection){
  if(!caches.has(api))caches.set(api,new Map());const cache=caches.get(api),key=selection.chapter+':'+selection.ayah;
  if(cache.get(key)?.until<Date.now())cache.delete(key);
  if(!cache.has(key)){
    const promise=api.request('quran/words',{chapter:selection.chapter,ayah:selection.ayah}).catch(error=>{cache.delete(key);throw error;});
    cache.set(key,{promise,until:Date.now()+600000});while(cache.size>32)cache.delete(cache.keys().next().value);
  }
  return cache.get(key).promise;
}
export default function QuranWordTranslation({api,selection,text}){
  const [state,setState]=useState({loading:true}),[retry,setRetry]=useState(0);
  useEffect(()=>{let live=true;setState({loading:true});load(api,selection).then(value=>selectedWordGlosses(value,selection,text)).then(words=>{if(live)setState({words});}).catch(()=>{if(live)setState({error:true});});return()=>{live=false;};},[api,selection.chapter,selection.ayah,selection.start,selection.end,selection.text_sha256,retry]);
  return <section className="quran-word-translation" aria-label="English word translation" translate="no">
    {state.loading&&<small role="status">Finding word meanings…</small>}
    {state.error&&<p role="status">Word meanings are unavailable. <button onClick={()=>{caches.get(api)?.delete(selection.chapter+':'+selection.ayah);setRetry(n=>n+1);}}>Retry translation</button></p>}
    {state.words&&<><dl>{state.words.map(word=><div key={word.position}><dt lang="ar" dir="rtl">{word.arabic}</dt><dd lang="en">{word.translation}</dd></div>)}</dl><a href={`https://quran.com/${selection.chapter}/${selection.ayah}`} target="_blank" rel="noreferrer">Quran.com · word-by-word meanings ↗</a></>}
  </section>;
}
