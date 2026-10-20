import React,{createContext,useContext} from 'react';
import {createPortal} from 'react-dom';
import {SurfaceActivity} from './surfaceActivity.js';

export const WorkspaceNavigation=createContext(null);

/** Keep each cached document's navigation in the single shell, only while active. */
export function DocumentNavigation({children}){
  const host=useContext(WorkspaceNavigation),active=useContext(SurfaceActivity);
  return host&&active ? createPortal(children,host) : null;
}
