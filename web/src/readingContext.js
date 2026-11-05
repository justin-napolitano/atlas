/** Decode imported RDF literals without interpreting markup or guessing identity. */
export function contextProperties(record,key) {
  return (record?.attributes?.rdf_properties?.[key] || []).map(value=>{
    const literal=value.match(/^"(?:[^"\\]|\\.)*"/);
    try{return literal ? JSON.parse(literal[0]) : value.replace(/^<|>$/g,'');}catch{return value;}
  });
}

/** Reject mixed-project or misdirected graph data before offering navigation. */
export function verifyContext(value,projectId,recordId) {
  if(value?.project_id!==projectId || value?.record?.id!==recordId || value.record.project_id!==projectId || !Array.isArray(value.items))throw new Error('Context did not match this research record.');
  for(const {edge,node,direction} of value.items){
    if(edge?.project_id!==projectId || node?.project_id!==projectId || !edge.id || !edge.predicate || !edge.provenance ||
      (direction==='out' ? edge.from_id!==recordId || edge.to_id!==node.id : direction==='in' ? edge.to_id!==recordId || edge.from_id!==node.id : true))throw new Error('A graph relationship did not match its source and target.');
  }
  return value;
}

/** Stable navigation targets retain edition/document identity and no private prose. */
export function readingTarget(projectId,recordId,documentId='',annotationId='') {
  return {project_id:projectId,record_id:recordId,document_id:documentId,annotation_id:annotationId};
}

export function verifyComparisonDocument(value,projectId,recordId,documentId){
  if(value?.project_id!==projectId || value.source_record_id!==recordId || value.id!==documentId || typeof value.text_body!=='string' || !/^[a-f0-9]{64}$/.test(value.text_sha256))throw new Error('The reading excerpt did not match its source/version.');
  return value;
}
