import React,{useContext,useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import WorkingSurfaces,{WorkingTabs} from '../../src/WorkingSurfaces.jsx';
import {SurfaceActivity} from '../../src/surfaceActivity.js';
import '../../src/workingTabs.css';
const fixture=window.__cache={activeEffects:0};
function Page({id}){
  const active=useContext(SurfaceActivity);
  useEffect(()=>{if(!active)return;fixture.activeEffects++;return()=>{fixture.activeEffects--;};},[active]);
  return <article><h1>Reading {id}</h1>{Array.from({length:200},(_,n)=><p key={n}>Synthetic paragraph {n} in reading {id}.</p>)}</article>;
}
function Harness(){
  const [current,setCurrent]=useState('0'),[dirty,setDirty]=useState(new Set()),[keys,setKeys]=useState(Array.from({length:30},(_,n)=>String(n))),ref=useRef(null);
  function choose(id){ref.current?.capture();setCurrent(id);}
  fixture.choose=choose;fixture.protect=ids=>setDirty(new Set(ids));fixture.close=id=>setKeys(old=>old.filter(key=>key!==id));
  return <><WorkingTabs items={keys.map(key=>({key,title:'Reading '+key,kind:'Reading'}))} activeKey={current} statuses={Object.fromEntries([...dirty].map(key=>[key,'Unsaved']))} onChoose={item=>choose(item.key)} onClose={item=>{if(!dirty.has(item.key))fixture.close(item.key);}}/><main className="workspace-reader" style={{height:350,overflow:'auto'}}><WorkingSurfaces ref={ref} activeKey={current} openKeys={keys} protectedKeys={dirty}><Page id={current}/></WorkingSurfaces></main></>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
