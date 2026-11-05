import {useEffect,useMemo,useState} from 'react';
import {QuranProgressClient} from './quranProgressClient.js';
import {useSurfaceResume} from './surfaceActivity.js';
const clients=new WeakMap();
export default function useQuranProgress(api,projectId,drafts,changed,catalog){
  const [,render]=useState(0),store=drafts.current;
  const client=useMemo(()=>{if(!catalog)return null;if(!clients.has(store))clients.set(store,new Map());const cache=clients.get(store);if(!cache.has(projectId))cache.set(projectId,new QuranProgressClient(api,projectId,store,catalog.chapters,changed));return cache.get(projectId);},[store,projectId,catalog]);
  if(client){client.api=api;client.changed=changed;}
  useEffect(()=>{if(!client)return;const off=client.subscribe(()=>render(n=>n+1));client.load();const flush=()=>{for(const queue of client.queues.values())queue.flush();};window.addEventListener('pagehide',flush);return()=>{off();window.removeEventListener('pagehide',flush);};},[client]);
  useSurfaceResume(()=>client?.load());
  return client;
}
