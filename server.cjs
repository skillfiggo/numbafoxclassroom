const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {homeworkReply,cleanBoard}=require('./homework.cjs');
const {prepareTutorContext}=require('./tutor-context.cjs');
const db=require('./classroom-db.cjs');
const localPreview=process.env.CLASSROOM_LOCAL_PREVIEW==='1'&&!db.configured;
const root=path.join(__dirname,'public'), admin=crypto.randomBytes(24).toString('hex'), clients=new Map();
let state={title:'Welcome to maths class',status:'waiting',board:{title:'The Board',layout:'working',rows:[],angles:[]},explanation:'Your lesson will appear here.',working:'Your written explanation will appear here.',messages:[],questions:[],hands:[],poll:null,recap:[],reveal:{visible:0,total:0},lesson:{topic:'',introduction:'',question:'',teacherGuidance:'',speaker:'ai',step:0,paused:false},voice:{active:false,teacherId:null}};
let teachingHistory=[],activePuzzleImage=null,aiBusy=false,lessonGeneration=0,stagedBoard=null,stagedTeaching=null,pollVotes=new Map(),lessonBeforeQuestion=null;
function stageBoard(board){stagedBoard=board;state.reveal={visible:Math.min(1,board.rows.length),total:board.rows.length};state.board={...board,rows:board.rows.slice(0,state.reveal.visible)}}
function saveRecap(){if(state.working||state.explanation||state.board.rows.length)state.recap.push({id:crypto.randomUUID(),board:state.board,working:state.working,explanation:state.explanation});state.recap=state.recap.slice(-40)}
const votes=new Map();
let roomWrites=Promise.resolve();
function publishState(){
 broadcast('state',clientState());
 if(!db.configured)return Promise.resolve();
 const snapshot=structuredClone({
  state:{...state,hands:[],voice:{active:false,teacherId:null}},
  teachingHistory,stagedBoard,stagedTeaching,lessonBeforeQuestion,
  pollVotes:[...pollVotes],votes:[...votes].map(([id,users])=>[id,[...users]])
 });
 const write=roomWrites.then(()=>db.saveRoom(snapshot));
 roomWrites=write.catch(()=>console.error('Supabase classroom snapshot write failed.'));
 return write;
}
function clientState(){const snapshot=structuredClone(state);delete snapshot.lesson.teacherGuidance;return snapshot}

async function start(){
 if(db.configured){
  const snapshot=await db.loadRoom();
  if(snapshot){
   ({state,teachingHistory,stagedBoard,stagedTeaching,lessonBeforeQuestion}=snapshot);
   pollVotes=new Map(snapshot.pollVotes);
   for(const [id,users] of snapshot.votes)votes.set(id,new Set(users));
  }
 }
 const port=Number(process.env.CLASSROOM_PORT)||5174;
 server.once('error',error=>{console.error('Could not listen for classroom connections:',error.message);process.exitCode=1;});
 server.listen(port,'127.0.0.1',()=>console.log(`Classroom: http://127.0.0.1:${port}`));
}
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function broadcast(event,data){for(const c of clients.keys())c.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)}
function sendTo(id,event,data){for(const [client,info] of clients)if(info.id===id)client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)}
function publishPresence(){broadcast('presence',Array.from(clients.values()).map(({id,name})=>({id,name})))}
function body(req){return new Promise((resolve,reject)=>{let s='';req.on('data',chunk=>{s+=chunk;if(s.length>6*1024*1024){reject(Error('too large'));req.destroy()}});req.on('end',()=>{try{resolve(JSON.parse(s||'{}'))}catch{reject(Error('invalid JSON'))}});req.on('error',reject)})}
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 const route=url.pathname;
 if(req.method==='POST'&&route.startsWith('/api/')&&
   (['cross-site','same-site'].includes(req.headers['sec-fetch-site'])||
    !/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))){
  return send(res,403,{error:'Use the classroom app to make this request.'});
 }
 if(req.method==='GET'&&route==='/api/classroom-mode')return send(res,200,{localPreview});
 if(route==='/api/account'||route.startsWith('/api/account/')){
  return send(res,200,await db.route(req,res,route,body));
 }
 if(['/classroom','/index.html'].includes(route)&&!localPreview){
  try{await db.authenticate(req,res,true)}
  catch(error){if(error.status!==401&&error.status!==503)throw error;res.writeHead(303,{Location:'/learn'});return res.end()}
 }
 const protectedRoute=route==='/events'||route.startsWith('/api/')||route==='/teacher-token';
 let account;
 if(protectedRoute&&!localPreview){
  account=await db.authenticate(req,res,route==='/events');
 }
 if(req.method==='GET'&&route==='/api/classes'){
  return send(res,200,state.status==='live'&&state.lesson.topic?[{
   title:state.lesson.topic,description:state.lesson.introduction,
   grade:state.lesson.grade,exam:state.lesson.exam
  }]:[]);
 }
 if(req.method==='GET'&&route==='/api/history'&&account)return send(res,200,await db.history(account));
 if(req.method==='POST'&&route==='/api/visit'){
  const {lessonId}=await body(req);
  if(account&&state.lesson.id&&state.lesson.id===lessonId&&state.status==='live'&&
    Array.from(clients.values()).some(client=>client.userId===account.user.id)){
   await db.saveVisit(account.user.id,state);
  }
  return send(res,200,{ok:true});
 }
 if(req.method==='GET'&&route==='/events'){
  const profile=account?await db.readProfile(account):null;
  const id=String(url.searchParams.get('id')||'').slice(0,60);
  if(account&&Array.from(clients.values()).some(c=>c.id===id&&c.userId!==account.user.id)){
   return send(res,409,{error:'Reconnect to the class.'});
  }
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});
  res.write('event: state\ndata: '+JSON.stringify(clientState())+'\n\n');
  clients.set(res,{id,name:profile?.name||(account?'Student':'Guest'),userId:account?.user.id});
  publishPresence();
  const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),20000);
  const expiry=account?setTimeout(()=>res.end(),Math.max(1,account.expiresAt-Date.now())):null;
  res.on('close',()=>{
   clearInterval(heartbeat);
   clearTimeout(expiry);
   clients.delete(res);
   if(!Array.from(clients.values()).some(c=>c.id===id)){
    state.hands=state.hands.filter(h=>h.id!==id);
    if(state.voice.teacherId===id){
     state.voice={active:false,teacherId:null};
     state.lesson.speaker='ai';
     broadcast('voice-ended',{});
    }
    broadcast('state',state);
   }
   publishPresence();
  });
  return;
 }
 if(req.method==='GET'&&url.pathname==='/api/state')return send(res,200,clientState());
 if(req.method==='POST'&&url.pathname.startsWith('/api/')){
  const d=await body(req), isAdmin=account?account.teacher:req.headers['x-admin-token']===admin;
  if(account&&['/api/presence','/api/hand','/api/vote','/api/poll-vote','/api/listen-voice','/api/voice-signal','/api/voice-start','/api/voice-stop'].includes(route)){
   const id=route==='/api/vote'?d.clientId:route==='/api/voice-signal'?d.from:d.id;
   if(!Array.from(clients.values()).some(client=>client.id===id&&client.userId===account.user.id)){
    return send(res,403,{error:'Reconnect to the class.'});
   }
  }
  if(url.pathname==='/api/presence'){for(const client of clients.values())if(!account&&client.id===d.id)client.name=String(d.name||'Guest').trim().slice(0,30)||'Guest';publishPresence();return send(res,200,{ok:true});}
  if(url.pathname==='/api/hand'){
   const id=String(d.id||'');if(!Array.from(clients.values()).some(c=>c.id===id))return send(res,400,{error:'Reconnect to the class first.'});
   const existing=state.hands.some(h=>h.id===id);state.hands=state.hands.filter(h=>h.id!==id);if(!existing)state.hands.push({id,name:Array.from(clients.values()).find(c=>c.id===id).name});broadcast('state',state);return send(res,200,{raised:!existing});
  }
  if(url.pathname==='/api/reaction'){
   const symbols={'understand':'👍','slow':'🐢','help':'🙋','love':'❤️'};if(!symbols[d.reaction])return send(res,400,{error:'Unknown reaction.'});broadcast('reaction',{symbol:symbols[d.reaction]});return send(res,200,{ok:true});
  }
  if(url.pathname==='/api/vote'){
   const id=String(d.clientId||'');if(!Array.from(clients.values()).some(c=>c.id===id))return send(res,400,{error:'Reconnect to the class first.'});const question=state.questions.find(q=>q.id===d.id);if(!question)return send(res,404,{error:'Question no longer available.'});const voter=account?.user.id||id;let set=votes.get(question.id)||new Set();if(set.has(voter))set.delete(voter);else set.add(voter);votes.set(question.id,set);question.votes=set.size;await publishState();return send(res,200,{voted:set.has(voter)});
  }
  if(url.pathname==='/api/message'||url.pathname==='/api/question'){
   const text=String(d.text||'').trim().slice(0,500);
   if(!text)return send(res,400,{error:'Please write a message.'});
   const name=account?(await db.readProfile(account))?.name||'Student':String(d.name||'Student').trim().slice(0,30)||'Student';
   const item={id:crypto.randomUUID(),name,text,at:Date.now(),...(url.pathname.endsWith('question')?{votes:0}:{})};const key=url.pathname.endsWith('question')?'questions':'messages';state[key].push(item);state[key]=state[key].slice(-100);await publishState();if(key==='messages')broadcast('message',item);return send(res,200,{ok:true});
  }
  if(url.pathname==='/api/poll-vote'){
   const id=String(d.id||''),choice=Number(d.choice);if(!Array.from(clients.values()).some(c=>c.id===id))return send(res,400,{error:'Reconnect first.'});if(!state.poll||state.poll.closed||!Number.isInteger(choice)||choice<0||choice>=state.poll.options.length)return send(res,400,{error:'That check is unavailable.'});const voter=account?.user.id||id;if(pollVotes.has(voter))return send(res,409,{error:'You have already answered.'});pollVotes.set(voter,choice);state.poll.counts[choice]++;await publishState();return send(res,200,{ok:true});
  }
  if(url.pathname==='/api/listen-voice'){
   const id=String(d.id||'');if(!Array.from(clients.values()).some(c=>c.id===id)||!state.voice.active)return send(res,400,{error:'Teacher microphone is not live.'});sendTo(state.voice.teacherId,'voice-listener',{id});return send(res,200,{ok:true});
  }
  if(url.pathname==='/api/voice-signal'){
   const from=String(d.from||''),to=String(d.to||'');if(!state.voice.active||!Array.from(clients.values()).some(c=>c.id===from)||!Array.from(clients.values()).some(c=>c.id===to))return send(res,400,{error:'Voice connection unavailable.'});
   if(from===state.voice.teacherId&&!isAdmin)return send(res,403,{error:'Teacher access required.'});if(from!==state.voice.teacherId&&to!==state.voice.teacherId)return send(res,403,{error:'Invalid voice connection.'});
   if(!d.signal||!['offer','answer','ice'].includes(d.signal.type)||JSON.stringify(d.signal).length>12000)return send(res,400,{error:'Invalid voice signal.'});sendTo(to,'voice-signal',{from,signal:d.signal});return send(res,200,{ok:true});
  }
  if(!isAdmin)return send(res,403,{error:'Teacher access required.'});
  if(url.pathname==='/api/lesson'){
   const topic=String(d.topic||'').trim().slice(0,200);if(!topic)return send(res,400,{error:'Add a topic first.'});
   lessonGeneration++;teachingHistory=[];activePuzzleImage=null;lessonBeforeQuestion=null;stagedBoard=null;stagedTeaching=null;pollVotes.clear();state.poll=null;state.recap=[];state.messages=[];state.questions=[];votes.clear();state.reveal={visible:0,total:0};state.lesson={id:crypto.randomUUID(),topic,grade:['All levels','JSS 1','JSS 2','JSS 3','SS 1','SS 2','SS 3','Graduate','Other'].includes(d.grade)?d.grade:'All levels',exam:['All goals','JAMB','WAEC','NECO','School exams','General learning'].includes(d.exam)?d.exam:'All goals',introduction:String(d.introduction||'').trim().slice(0,1200),question:String(d.question||'').trim().slice(0,800),teacherGuidance:String(d.teacherGuidance||'').trim().slice(0,1200),speaker:state.voice.active?'teacher':'ai',step:0,paused:false};state.title=topic;state.status='live';state.board={title:'The Board',layout:'working',rows:[],angles:[]};state.working='';state.explanation='';await publishState();return send(res,200,{ok:true});
  }
  if(url.pathname==='/api/lesson-control'){
   if(typeof d.paused==='boolean'){if(d.paused&&!state.lesson.paused)lessonGeneration++;state.lesson.paused=d.paused;}if(['ai','teacher'].includes(d.speaker))state.lesson.speaker=d.speaker;
   if(typeof d.question==='string')state.lesson.question=d.question.trim().slice(0,800);await publishState();return send(res,200,{ok:true});
  }
  if(url.pathname==='/api/reveal'){
   if(!stagedBoard)return send(res,400,{error:'No staged working yet.'});const step=d.direction==='back'?-1:1;state.reveal.visible=Math.max(1,Math.min(stagedBoard.rows.length,state.reveal.visible+step));state.board={...stagedBoard,rows:stagedBoard.rows.slice(0,state.reveal.visible)};if(stagedTeaching){const complete=state.reveal.visible===state.reveal.total;state.working=complete?stagedTeaching.working:'';state.explanation=complete?stagedTeaching.explanation:''}await publishState();return send(res,200,{ok:true});
  }
  if(url.pathname==='/api/replay'){if(!state.explanation)return send(res,400,{error:'No explanation to repeat.'});broadcast('replay',{});return send(res,200,{ok:true});}
  if(url.pathname==='/api/handoff'){if(!state.lesson.topic)return send(res,400,{error:'Start a lesson first.'});const q=state.questions.find(q=>q.id===d.id);if(!q)return send(res,404,{error:'Question no longer available.'});if(lessonBeforeQuestion===null)lessonBeforeQuestion=state.lesson.question;state.lesson.question=q.text;await publishState();return send(res,200,{ok:true});}
  if(url.pathname==='/api/return-lesson'){if(lessonBeforeQuestion!==null){state.lesson.question=lessonBeforeQuestion;lessonBeforeQuestion=null;await publishState()}return send(res,200,{ok:true});}
  if(url.pathname==='/api/poll'){const question=String(d.question||'').trim().slice(0,300),options=Array.isArray(d.options)?d.options.map(x=>String(x).trim().slice(0,100)).filter(Boolean).slice(0,4):[];if(!question||options.length<2)return send(res,400,{error:'Add a question and at least two choices.'});pollVotes=new Map();state.poll={id:crypto.randomUUID(),question,options,counts:options.map(()=>0),closed:false};await publishState();return send(res,200,{ok:true});}
  if(url.pathname==='/api/poll-close'){if(state.poll)state.poll.closed=true;await publishState();return send(res,200,{ok:true});}
  if(url.pathname==='/api/voice-start'){
   const id=String(d.id||'');if(!Array.from(clients.values()).some(c=>c.id===id))return send(res,400,{error:'Reconnect to the class first.'});if(state.voice.active&&state.voice.teacherId!==id)return send(res,409,{error:'Another teacher is already speaking.'});state.voice={active:true,teacherId:id};state.lesson.speaker='teacher';await publishState();return send(res,200,{ok:true});
  }
  if(url.pathname==='/api/voice-stop'){if(state.voice.teacherId===d.id){state.voice={active:false,teacherId:null};state.lesson.speaker='ai';broadcast('voice-ended',{});await publishState()}return send(res,200,{ok:true});}
  if(url.pathname==='/api/update'){
   const board=d.board?cleanBoard(d.board):null;
   if(d.board&&!board)return send(res,400,{error:'Invalid board.'});
   if(typeof d.title==='string')state.title=d.title.trim().slice(0,100)||'Maths class';
   if(['live','waiting','ended'].includes(d.status)){if(d.status==='ended'&&state.status!=='ended'){saveRecap();activePuzzleImage=null}state.status=d.status;}
   if(d.status==='live'&&!state.lesson.id){
    state.lesson={...state.lesson,id:crypto.randomUUID(),topic:state.title,grade:'All levels',exam:'All goals'};
   }
   if(typeof d.explanation==='string')state.explanation=d.explanation.trim().slice(0,5000);
   if(typeof d.working==='string')state.working=d.working.trim().slice(0,6000);
   if(board){if(d.stage){stagedTeaching={working:state.working,explanation:state.explanation};stageBoard(board);if(state.reveal.visible<state.reveal.total){state.working='';state.explanation=''}}else{stagedTeaching=null;stagedBoard=board;state.board=board;state.reveal={visible:board.rows.length,total:board.rows.length}}}
   if(Array.isArray(d.rows))state.board={title:'The Board',layout:'working',rows:d.rows.slice(0,24).map(text=>({text:String(text).slice(0,240),kind:'active'})),angles:[]};
   await publishState();return send(res,200,{ok:true});
  }
  if(url.pathname==='/api/resolve'){votes.delete(d.id);state.questions=state.questions.filter(q=>q.id!==d.id);await publishState();return send(res,200,{ok:true});}
  if(url.pathname==='/api/spotlight'){const question=state.questions.find(q=>q.id===d.id);if(!question)return send(res,404,{error:'Question no longer available.'});state.board={title:'The Board',layout:'working',rows:[{text:question.text,kind:'given'}],angles:[]};stagedBoard=state.board;state.reveal={visible:1,total:1};await publishState();return send(res,200,{ok:true});}
  if(url.pathname==='/api/ai'){
   if(!process.env.OPENAI_API_KEY)return send(res,503,{error:'AI is not configured yet.'});if(!state.lesson.topic)return send(res,400,{error:'Start a lesson first.'});if(state.voice.active)return send(res,409,{error:'Stop the microphone before AI teaches.'});if(state.lesson.paused)return send(res,409,{error:'Resume the lesson first.'});if(aiBusy)return send(res,409,{error:'AI is already preparing a step.'});
   const instruction=String(d.instruction||'').trim().slice(0,800),generation=lessonGeneration,step=state.lesson.step;
   const prompt=step===0?`Teach a live maths class about ${state.lesson.topic}. Host introduction: ${state.lesson.introduction||'(none)'}. Current question: ${state.lesson.question||'(choose an appropriate example)'}. Private teacher briefing: ${state.lesson.teacherGuidance||'(none)'}. Immediate teacher guidance: ${instruction||'(none)'}. Begin teaching clearly, one manageable step at a time. Students see the board and hear your explanation.`:(instruction||'Continue the lesson with the next teaching step. Explain it to the class and update the board.');
   aiBusy=true;try{const context=prepareTutorContext(teachingHistory,prompt,activePuzzleImage,d.image);const messages=context.messages;const result=await homeworkReply({messages,image:context.image,boardContext:d.image?null:state.board},{apiKey:process.env.OPENAI_API_KEY});if(generation!==lessonGeneration)return send(res,409,{error:'The lesson changed while AI was preparing.'});activePuzzleImage=context.image;teachingHistory=messages.concat({role:'assistant',text:result.reply+(result.working?'\n\nWritten on the board:\n'+result.working:'')}).slice(-22);if(result.board&&result.board.action!=='keep'){stagedTeaching=null;stagedBoard=result.board;state.board=result.board;state.reveal={visible:result.board.rows.length,total:result.board.rows.length}}state.working=result.working;state.explanation=result.reply;state.lesson.step++;saveRecap();state.lesson.speaker='ai';await publishState();return send(res,200,{ok:true})}finally{aiBusy=false}
  }
  return send(res,404,{error:'Not found'});
 }
 if(req.method==='GET'){
  if(route==='/teacher-token')return account&&!account.teacher?send(res,403,{error:'Teacher access required.'}):send(res,200,{token:account?'':admin});
  const name=url.pathname==='/'?'landing.html':url.pathname==='/classroom'?'index.html':url.pathname==='/learn'?'learn.html':url.pathname.slice(1);if(!['index.html','landing.html','landing.css','landing.js','learn.html','learn.css','learn.js','assets/classroom-hero.png','assets/math-community.png','assets/student-books.png','assets/student-books-vector.png','app.js','style.css','vendor/css/all.min.css','vendor/webfonts/fa-solid-900.woff2',...['puzzle-drawing.js','learning-diagrams.js','geometry-toolkit.js','geometry-toolkit-view.js','geometry-model.js','geometry-view.js','board-model.js','homework-board.js','homework-board.css'].map(file=>'numbafox-board/'+file)].includes(name)){res.writeHead(404);return res.end('Not found')}
  res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':name.endsWith('.woff2')?'font/woff2':name.endsWith('.png')?'image/png':'text/html; charset=utf-8'});return fs.createReadStream(path.join(root,name)).pipe(res)
 }
 send(res,405,{error:'Method not allowed'});
 }catch(e){const messages={'ai-invalid-board':'The AI could not prepare a valid board. Please try again or simplify the diagram.','ai-configuration-error':'Check the AI configuration.','ai-quota':'AI credits are unavailable.','ai-busy':'AI is busy. Please try again.','ai-unavailable':'AI is unavailable. Please try again.'};if(!res.headersSent)send(res,e.status||500,{error:e.publicMessage||messages[e.code]||'Something went wrong. Please try again.'});else res.end()}});
start().catch(error=>{
 console.error('Could not start the classroom:',error.publicMessage||error.message);
 process.exitCode=1;
});
