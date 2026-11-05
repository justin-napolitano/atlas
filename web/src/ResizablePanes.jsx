import React, { useRef, useState } from 'react';

/** Keyboard/pointer resize with a device-local geometry preference, never note data. */
export default function ResizablePanes({ children, storageKey = 'research:pane-width', className = '',label='Resize result and reading panes',minWidth=30,maxWidth=70,defaultWidth=50,unit='%' }) {
  const root = useRef(null);
  const clamp=value=>Math.max(minWidth,Math.min(maxWidth,value));
  const [width, setWidth] = useState(() => { try { return clamp(Number(localStorage.getItem(storageKey)) || defaultWidth); } catch { return clamp(defaultWidth); } });
  function update(value) {
    const next = clamp(value);
    setWidth(next); try { localStorage.setItem(storageKey, next); } catch { /* Resizing remains available. */ }
  }
  return <div ref={root} className={`resizable-panes ${className}`} style={{ '--list-width': `${width}${unit}` }}>
    {children[0]}
    <div className="pane-divider" role="separator" aria-label={label} aria-orientation="vertical" aria-valuemin={minWidth} aria-valuemax={maxWidth} aria-valuenow={Math.round(width)} tabIndex={0}
      onDoubleClick={() => update(defaultWidth)}
      onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); update(e.key === 'Home' ? minWidth : e.key === 'End' ? maxWidth : width + (e.key === 'ArrowLeft' ? -2 : 2)); } }}
      onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) { const rect = root.current.getBoundingClientRect(); update(unit==='px'?e.clientX-rect.left:(e.clientX - rect.left) / rect.width * 100); } }}
      onPointerUp={e => e.currentTarget.releasePointerCapture(e.pointerId)} />
    {children[1]}
  </div>;
}
