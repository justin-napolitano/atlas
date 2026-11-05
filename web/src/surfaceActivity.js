import {createContext,useContext,useEffect,useRef} from 'react';

export const SurfaceActivity=createContext(true);
// Refresh saved projections on return, without resetting editor state or drafts.
export function useSurfaceResume(refresh){
  const active=useContext(SurfaceActivity),previous=useRef(active);
  useEffect(()=>{if(active && !previous.current)refresh();previous.current=active;},[active]);
}
