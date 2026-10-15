import React, { useRef, useState } from 'react';

/** Keyboard/pointer resize with a device-local geometry preference, never note data. */
export default function ResizablePanes({ children, storageKey = 'research:pane-width', className = '',label='Resize result and reading panes' }) {
  const root = useRef(null);
  const [width, setWidth] = useState(() => { try { return Math.max(30, Math.min(70, Number(localStorage.getItem(storageKey)) || 50)); } catch { return 50; } });
  function update(value) {
    const next = Math.max(30, Math.min(70, value));
    setWidth(next); try { localStorage.setItem(storageKey, next); } catch { /* Resizing remains available. */ }
  }
  return <div ref={root} className={`resizable-panes ${className}`} style={{ '--list-width': `${width}%` }}>
    {children[0]}
    <div className="pane-divider" role="separator" aria-label={label} aria-orientation="vertical" aria-valuemin={30} aria-valuemax={70} aria-valuenow={Math.round(width)} tabIndex={0}
      onDoubleClick={() => update(50)}
      onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); update(e.key === 'Home' ? 30 : e.key === 'End' ? 70 : width + (e.key === 'ArrowLeft' ? -2 : 2)); } }}
      onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) { const rect = root.current.getBoundingClientRect(); update((e.clientX - rect.left) / rect.width * 100); } }}
      onPointerUp={e => e.currentTarget.releasePointerCapture(e.pointerId)} />
    {children[1]}
  </div>;
}
