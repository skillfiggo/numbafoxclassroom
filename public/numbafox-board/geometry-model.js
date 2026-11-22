// Geometry data, validation and triangle construction shared by server and browser.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.NumbaGeometry=api;})(globalThis,function(){
 const toolkit=typeof module==='object'&&module.exports?require('./geometry-toolkit.js'):globalThis.NumbaGeometryToolkit;
 const str={type:'string'},num={type:'number'},tone={type:'string',enum:['given','note','answer']};
 const obj=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
 const arr=items=>({type:'array',items});
 const schema=obj({source:{type:'string',enum:['photo','constructed']},description:str,figures:arr(toolkit.schema),points:arr(obj({id:str,label:str,x:num,y:num})),paths:arr(obj({id:str,points:arr(str),closed:{type:'boolean'},tone})),segments:arr(obj({id:str,from:str,to:str,label:str,tone,dashed:{type:'boolean'}})),circles:arr(obj({id:str,center:str,through:str,label:str,tone})),angles:arr(obj({id:str,vertex:str,from:str,to:str,label:str,degrees:{anyOf:[num,{type:'null'}]},tone})),highlight:arr(str)});
 const text=(v,n)=>typeof v==='string'&&v.length<=n&&!/[\u0000-\u001f]/.test(v),id=v=>text(v,30)&&/^[A-Za-z][A-Za-z0-9_-]*$/.test(v),tones=new Set(['given','note','answer']);
 function clean(s){if(!s||!['photo','constructed'].includes(s.source)||!text(s.description,350))return null;
  for(const [k,max] of Object.entries({points:16,paths:6,segments:24,circles:4,angles:12,highlight:12}))if(!Array.isArray(s[k])||s[k].length>max)return null;
  if(!s.points.length&&!(Array.isArray(s.figures)&&s.figures.some(f=>f&&['solid','net','plot','bar','pie','clock','numberline','fractionmodel','placevalue','measurement','money','ratio','hundredgrid','algebra','transformation','spinner','probabilitytree','outcometable','numberpyramid','drawing'].includes(f.kind))))return null;const ids=new Set(),points=new Map();
  const unique=v=>{if(!id(v)||ids.has(v))return false;ids.add(v);return true;};
  for(const p of s.points){if(!p||!unique(p.id)||!text(p.label,30)||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>100||p.y<0||p.y>100)return null;points.set(p.id,p);}
  const apart=(a,b)=>points.has(a)&&points.has(b)&&a!==b&&Math.hypot(points.get(a).x-points.get(b).x,points.get(a).y-points.get(b).y)>.5;
  for(const p of s.paths){if(!p||!unique(p.id)||!tones.has(p.tone)||typeof p.closed!=='boolean'||!Array.isArray(p.points)||p.points.length<(p.closed?3:2)||p.points.length>16||new Set(p.points).size!==p.points.length||p.points.some(v=>!points.has(v)))return null;}
  for(const e of s.segments)if(!e||!unique(e.id)||!apart(e.from,e.to)||!text(e.label,50)||!tones.has(e.tone)||typeof e.dashed!=='boolean')return null;
  for(const c of s.circles)if(!c||!unique(c.id)||!apart(c.center,c.through)||!text(c.label,50)||!tones.has(c.tone))return null;
  const vertices=new Set();for(const a of s.angles){if(!a||!unique(a.id)||!apart(a.vertex,a.from)||!apart(a.vertex,a.to)||a.from===a.to||!text(a.label,50)||!tones.has(a.tone)||(a.degrees!==null&&(!Number.isFinite(a.degrees)||a.degrees<=0||a.degrees>180)))return null;const key=[a.vertex,...[a.from,a.to].sort()].join(':');if(vertices.has(key))return null;vertices.add(key);}
  const figures=s.figures===undefined?[]:toolkit.clean(s.figures,points,s.segments,unique);if(!figures)return null;
  for(const h of s.highlight)if(!ids.has(h))return null;
  // Refuse inconsistent fully/partly specified triangle angles instead of drawing a lie.
  for(const p of s.paths.filter(p=>p.closed&&p.points.length===3)){const angles=p.points.map(v=>s.angles.find(a=>a.vertex===v&&p.points.includes(a.from)&&p.points.includes(a.to)));const known=angles.filter(a=>a?.degrees!=null);const sum=known.reduce((n,a)=>n+a.degrees,0);if(known.length===3&&Math.abs(sum-180)>.2||known.length===2&&sum>=180)return null;}
  // Only known, bounded fields survive into the renderer and the next AI request.
  return {source:s.source,description:s.description,points:s.points.map(({id,label,x,y})=>({id,label,x,y})),paths:s.paths.map(({id,points,closed,tone})=>({id,points:[...points],closed,tone})),segments:s.segments.map(({id,from,to,label,tone,dashed})=>({id,from,to,label,tone,dashed})),circles:s.circles.map(({id,center,through,label,tone})=>({id,center,through,label,tone})),angles:s.angles.map(({id,vertex,from,to,label,degrees,tone})=>({id,vertex,from,to,label,degrees,tone})),highlight:[...s.highlight],...(s.figures!==undefined?{figures}:{})};
 }
 function positions(scene){const p=Object.fromEntries(scene.points.map(v=>[v.id,{...v}]));
  // With two specified angles, an isolated triangle has an exact construction.
  // Keep the first edge and orientation; never alter a connected multi-shape diagram.
  if(scene.paths.length===1&&scene.paths[0].closed&&scene.paths[0].points.length===3&&scene.points.length===3&&!scene.circles.length&&!(scene.figures||[]).length){const ids=scene.paths[0].points,values=ids.map(v=>scene.angles.find(a=>a.vertex===v&&ids.includes(a.from)&&ids.includes(a.to))?.degrees??null),known=values.filter(v=>v!==null);if(known.length>=2){if(known.length===2)values[values.indexOf(null)]=180-known.reduce((a,b)=>a+b,0);if(values.every(v=>v>0&&v<180)&&Math.abs(values.reduce((a,b)=>a+b,0)-180)<.2){const [a,b,c]=ids.map(id=>p[id]),dx=b.x-a.x,dy=b.y-a.y,L=Math.hypot(dx,dy),side=Math.sign(dx*(c.y-a.y)-dy*(c.x-a.x))||1,A=values[0]*Math.PI/180,B=values[1]*Math.PI/180,C=values[2]*Math.PI/180,length=L*Math.sin(B)/Math.sin(C);p[ids[2]]={...c,x:a.x+length*(dx/L*Math.cos(A)-side*dy/L*Math.sin(A)),y:a.y+length*(dy/L*Math.cos(A)+side*dx/L*Math.sin(A))};}}}
  return p;
 }
 function angleGeometry(a,p){const v=p[a.vertex],f=p[a.from],t=p[a.to],start=Math.atan2(f.y-v.y,f.x-v.x);let delta=Math.atan2(t.y-v.y,t.x-v.x)-start;while(delta>Math.PI)delta-=2*Math.PI;while(delta< -Math.PI)delta+=2*Math.PI;return {start,delta,degrees:Math.abs(delta)*180/Math.PI};}
 return {schema,clean,positions,angleGeometry};
});
