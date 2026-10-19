import React,{useId} from 'react';
import {readingDefaults,readingFonts} from './readingPreferences.js';
export default function ReadingAppearance({value,onChange,continuousOnly=false}){
  const id=useId(),pick=(key,next)=>onChange({...value,[key]:next});
  return <div className="reading-appearance" aria-label="Reading appearance">
    <details className="reading-appearance-panel" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();event.currentTarget.open=false;event.currentTarget.querySelector('summary').focus();}}}>
      <summary><span>Appearance</span></summary>
      <div className="reading-options" id={id}>
        <div className="reading-size-controls" role="group" aria-label="Source text size">
          <button aria-label="Decrease source text size" disabled={value.size<=14} onClick={()=>pick('size',value.size-2)}>Smaller</button>
          <output aria-label="Source font size">{Math.round(value.size*value.zoom/100)}px</output>
          <button aria-label="Increase source text size" disabled={value.size>=48} onClick={()=>pick('size',value.size+2)}>Larger</button>
        </div>
        <label>Reading text size <output>{Math.round(value.size*value.zoom/100)}px</output><input aria-label="Reading text size" type="range" min="14" max="48" step="1" value={value.size} style={{'--range-progress':`${(value.size-14)/34*100}%`}} onChange={e=>pick('size',Number(e.target.value))}/></label>
        <fieldset><legend>Font</legend><div className="reading-choices">{[['serif','Georgia'],['book','Palatino'],['sans','System']].map(([font,label])=><button key={font} style={{fontFamily:readingFonts[font]}} aria-pressed={value.font===font} onClick={()=>pick('font',font)}>{label}</button>)}</div></fieldset>
        <label>Notes text size <output>{Math.round(value.notesSize*value.zoom/100)}px</output><input aria-label="Notes text size" type="range" min="12" max="32" step="1" value={value.notesSize} style={{'--range-progress':`${(value.notesSize-12)/20*100}%`}} onChange={e=>pick('notesSize',Number(e.target.value))}/></label>
        <label>Reading zoom · text and notes <output>{value.zoom}%</output><input aria-label="Reading zoom" type="range" min="80" max="200" step="10" value={value.zoom} style={{'--range-progress':`${(value.zoom-80)/120*100}%`}} onChange={e=>pick('zoom',Number(e.target.value))}/></label>
        <fieldset><legend>Line spacing</legend><div className="reading-choices">{[[1.4,'Compact'],[1.65,'Comfortable'],[1.9,'Airy']].map(([n,label])=><button key={n} aria-pressed={value.spacing===n} onClick={()=>pick('spacing',n)}>{label}</button>)}</div></fieldset>
        <fieldset><legend>Page width</legend><div className="reading-choices">{['narrow','comfortable','wide'].map(width=><button key={width} aria-pressed={value.width===width} onClick={()=>pick('width',width)}>{width}</button>)}</div></fieldset>
        <fieldset><legend>Page color</legend><div className="reading-choices">{[['auto','App theme'],['light','White'],['paper','Paper'],['dark','Dark']].map(([theme,label])=><button key={theme} aria-pressed={value.theme===theme} onClick={()=>pick('theme',theme)}>{label}</button>)}</div></fieldset>
        {!continuousOnly&&<fieldset><legend>Reading flow</legend><div className="reading-choices">{[['scroll','Continuous'],['pages','Page steps']].map(([mode,label])=><button key={mode} aria-pressed={value.mode===mode} onClick={()=>pick('mode',mode)}>{label}</button>)}</div></fieldset>}
        <button className="reading-reset" onClick={()=>onChange({...readingDefaults})}>Reset reading preferences</button>
        <small>Saved on this device. Browser zoom remains available for the whole app.</small>
      </div>
    </details>
  </div>;
}
