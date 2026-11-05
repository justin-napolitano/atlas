/** Resolve one source-version tuple; never mix a new URL with an older annotation. */
export function currentReadingAnchor(projectId,recordId,route,place=null){
  if(place?.project_id===projectId && place.record_id===recordId && place.document_id){
    return {documentId:place.document_id,annotationId:place.annotation_id || ''};
  }
  if(route?.project===projectId && route.record===recordId && route.document){
    return {documentId:route.document,annotationId:route.annotation || ''};
  }
  return {documentId:'',annotationId:''};
}

/** A notebook creation anchor is usable only in the project that supplied it. */
export function notebookAnchorForProject(projectId,anchor){
  return anchor?.project_id===projectId && anchor.record_id?anchor:null;
}
