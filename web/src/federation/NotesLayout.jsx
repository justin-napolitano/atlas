import React from 'react';
import './notesWorkspace.css';
// One document layout for owner notes and permitted private/team brains.
export default function NotesLayout({sidebar,children,className='',editorId='notes-editor'}){
 return <main className={'notes-workspace '+className}><a className="skip-link" href={'#'+editorId}>Skip to note</a>{sidebar}<section className="notes-editor workspace-reader" id={editorId} tabIndex={-1}>{children}</section></main>;
}
