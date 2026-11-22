// Shared, bounded data contract. Neither model output nor client context is HTML.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.NumbaBoardModel=api;})(typeof globalThis==='object'?globalThis:this,function(){
 const geometry=typeof module==='object'&&module.exports?require('./geometry-model.js'):globalThis.NumbaGeometry;
 const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
 const str={type:'string'},enumeration=values=>({type:'string',enum:values});
 const tones=['given','answer','note'];
 const schema=object({action:enumeration(['keep','update','new']),problem:str,title:str,topic:enumeration(['addition','subtraction','multiplication','division','fractions','algebra','geometry','general']),layout:enumeration(['columns','division','equations','diagram']),columns:{type:'integer'},rows:{type:'array',items:object({id:str,heading:str,explanation:str,result:{type:'boolean'},rule:{type:'boolean'},cells:{type:'array',items:object({text:str,tone:enumeration(tones),previous:str})}})},diagram:object({scene:{anyOf:[geometry.schema,{type:'null'}]},shape:enumeration(['none','triangle','rectangle','scene']),labels:{type:'array',items:object({position:enumeration(['top','left','right','bottom','center']),text:str,tone:enumeration(tones)})},gridColumns:{type:'integer'},gridRows:{type:'integer'},showGrid:{type:'boolean'}}),caption:str,question:str,complete:{type:'boolean'}});
 const text=(v,max)=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
 function clean(value){
  if(!value||JSON.stringify(value).length>18000||!schema.properties.action.enum.includes(value.action))return null;
  if(!text(value.problem,180)||!text(value.title,120)||!text(value.caption,350)||!text(value.question,500)||typeof value.complete!=='boolean')return null;
  if(!schema.properties.topic.enum.includes(value.topic)||!schema.properties.layout.enum.includes(value.layout)||!Number.isInteger(value.columns)||value.columns<1||value.columns>10)return null;
  if(!Array.isArray(value.rows)||value.rows.length>24)return null;
  const ids=new Set(),rows=[];
  for(const row of value.rows){if(row&&((row.heading!==undefined&&!text(row.heading,100))||(row.explanation!==undefined&&!text(row.explanation,160))||(row.result!==undefined&&typeof row.result!=='boolean')))return null;if(!row||!text(row.id,40)||!row.id||ids.has(row.id)||typeof row.rule!=='boolean'||!Array.isArray(row.cells)||row.cells.length>value.columns||!row.cells.length)return null;ids.add(row.id);const cells=[];for(const cell of row.cells){if(!cell||!text(cell.text,160)||!text(cell.previous,60)||!tones.includes(cell.tone))return null;cells.push({text:cell.text,tone:cell.tone,previous:cell.previous});}rows.push({id:row.id,rule:row.rule,cells,...(row.heading!==undefined?{heading:row.heading}:{}),...(row.explanation!==undefined?{explanation:row.explanation}:{}),...(row.result!==undefined?{result:row.result}:{})});}
  const d=value.diagram;if(!d||!['none','triangle','rectangle','scene'].includes(d.shape)||!Number.isInteger(d.gridColumns)||d.gridColumns<0||d.gridColumns>12||!Number.isInteger(d.gridRows)||d.gridRows<0||d.gridRows>12||typeof d.showGrid!=='boolean'||!Array.isArray(d.labels)||d.labels.length>5)return null;
  const scene=d.scene==null?null:geometry.clean(d.scene);if((d.shape==='scene'&&!scene)||(d.scene!=null&&!scene))return null;
  const positions=new Set(),labels=[];for(const l of d.labels){if(!l||!['top','left','right','bottom','center'].includes(l.position)||positions.has(l.position)||!text(l.text,60)||!tones.includes(l.tone))return null;positions.add(l.position);labels.push({position:l.position,text:l.text,tone:l.tone});}
  if(value.action!=='keep'&&(!value.problem.trim()||!value.title.trim()))return null;
  return {action:value.action,problem:value.problem,title:value.title,topic:value.topic,layout:value.layout,columns:value.columns,rows,diagram:{shape:d.shape,labels,gridColumns:d.gridColumns,gridRows:d.gridRows,showGrid:d.showGrid,...(scene?{scene}:{})},caption:value.caption,question:value.question,complete:value.complete};
 }
 function signature(b){return JSON.stringify({...b,action:'update'});}
 function accept(state,raw,reply){const board=clean(raw);if(!board)return false;
  if(board.action==='keep'){state.question=board.question||state.question;return false;}
  // A new problem starts a new history. Changing notation alone need not discard it.
  if(state.problem&&state.problem!==board.problem){state.frames=[];state.index=-1;}
  state.problem=board.problem;state.question=board.question;
  if(state.frames.length&&signature(state.frames.at(-1).board)===signature(board)){state.index=state.frames.length-1;return false;}
  state.frames.push({board,reply});if(state.frames.length>40)state.frames.shift();state.index=state.frames.length-1;return true;
 }
 return {schema,clean,accept};
});
