document.title = 'Numbafox Classroom';
let localPreview = false, isTeacher = false;
const $=s=>document.querySelector(s);let state=null,tab='messages',token='',answeredPoll=null;
const boardBrand = document.querySelector('.lesson .eyebrow');
if (boardBrand) boardBrand.firstChild.textContent = 'NUMBAFOX CLASSROOM ';
const clientId=crypto.randomUUID(), votedQuestions=new Set();
async function api(endpoint,data,teacher=false){
 const options={method:'POST',headers:{'Content-Type':'application/json',...(teacher?{'X-Admin-Token':token}:{})},body:JSON.stringify(data)};
 let response=await fetch('/api/'+endpoint,options);
 if(response.status===401&&!localPreview){
  const account=await fetch('/api/account',{cache:'no-store'});
  if(account.ok)response=await fetch('/api/'+endpoint,options);
  else if(account.status===401)location.assign('/learn');
 }
 const result=await response.json();
 if(!response.ok)throw Error(result.error||'Please try again.');
 return result;
}
function el(tag,text,cls){const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n}
// Adapted from MathFox's homework-board.js: generated content is always text,
// with safe nodes for fractions, exponents, columns, and triangle diagrams.
let boardKey=null,previousBoard=null,advancedController=null,boardSounds=false;try{boardSounds=localStorage.getItem('mathfox-board-sounds')==='on'}catch{}
function playBoardCue(hasAnswer){if(!boardSounds)return;try{const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;const ctx=new Audio(),osc=ctx.createOscillator(),gain=ctx.createGain();osc.connect(gain);gain.connect(ctx.destination);osc.frequency.value=hasAnswer?660:480;gain.gain.setValueAtTime(.025,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.12);osc.start();osc.stop(ctx.currentTime+.13);osc.onended=()=>ctx.close();if(ctx.state==='suspended')ctx.resume().catch(()=>ctx.close())}catch{}}
function boardMath(node,text){const pattern=/(\^|_)\{([^{}]{1,40})\}|([−-]?\d+)\/(\d+)/g;let cursor=0;for(const match of text.matchAll(pattern)){node.append(document.createTextNode(text.slice(cursor,match.index)));if(match[1]){const part=document.createElement(match[1]==='^'?'sup':'sub');part.textContent=match[2];node.append(part)}else{const fraction=document.createElement('span');fraction.className='hw-fraction';fraction.setAttribute('aria-label',match[3]+' divided by '+match[4]);for(const value of [match[3],match[4]]){const part=document.createElement('span');part.textContent=value;fraction.append(part)}node.append(fraction)}cursor=match.index+match[0].length}node.append(document.createTextNode(text.slice(cursor)))}
function renderBoard(board){const root=$('#board');if(!board||!Array.isArray(board.rows))return;const key=JSON.stringify(board);if(key===boardKey)return;const old=previousBoard;previousBoard=board;boardKey=key;if(board.diagram){if(!advancedController){root.replaceChildren();root.classList.add('advanced-board');advancedController=new NumbaBoard.Controller(root,{onReplay:(reply,start)=>{start();if(reply&&'speechSynthesis' in window){window.speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(reply);utterance.onstart=()=>setSpeaking(true);utterance.onend=utterance.onerror=()=>setSpeaking(false);window.speechSynthesis.speak(utterance)}}});for(const entry of state?.recap||[]){if(entry.board?.diagram&&entry.board.problem===board.problem&&JSON.stringify(entry.board)!==key)advancedController.accept(entry.board,entry.explanation||'');}}advancedController.accept(board,state?.explanation||'');return;}if(advancedController){advancedController.destroy();advancedController=null;root.classList.remove('advanced-board')}root.replaceChildren();root.dataset.layout=board.layout;if(!board.rows.length&&!(board.layout==='triangle'&&board.angles?.length===3)){root.append(el('p','The board is ready for your teacher.','empty'));return}if(board.title&&board.title!=='The Board')root.append(el('h2',board.title,'board-title'));if(board.layout==='triangle'&&board.angles?.length===3){const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 320 220');svg.setAttribute('role','img');svg.setAttribute('aria-label','Triangle, not to scale. Angles: '+board.angles.join(', '));const outline=document.createElementNS(ns,'path');outline.setAttribute('d','M160 20 L30 190 L290 190 Z');outline.setAttribute('class','triangle-outline');svg.append(outline);[[160,70],[85,172],[235,172]].forEach(([x,y],index)=>{const label=document.createElementNS(ns,'text');label.setAttribute('x',x);label.setAttribute('y',y);label.setAttribute('text-anchor','middle');label.textContent=board.angles[index];if(old?.angles?.[index]!==board.angles[index]&&old)label.classList.add('board-changed');svg.append(label)});root.append(svg,el('small','Diagram not to scale','diagram-note'))}const rows=el('div','','board-rows');board.rows.forEach((item,index)=>{const row=el('div','','board-row '+item.kind);if(old&&(old.rows?.[index]?.text!==item.text||old.rows?.[index]?.kind!==item.kind))row.classList.add('board-changed');row.setAttribute('aria-label',item.kind+': '+item.text);if(board.layout==='columns')row.textContent=item.text;else boardMath(row,item.text);rows.append(row)});root.append(rows);if(old)playBoardCue(board.rows.some(row=>row.kind==='answer'))}
function render(){if(!state)return;$('#title').textContent=state.title;$('#status').textContent=state.status==='live'?'● Live now':state.status==='ended'?'● Class ended':'● Waiting';$('#status').className='status '+state.status;$('#explanation').textContent=state.explanation;const lesson=state.lesson||{};$('#lesson-brief').hidden=!lesson.topic;$('#brief-topic').textContent=lesson.topic||'';$('#brief-question').textContent=lesson.question||'';$('#brief-question-wrap').hidden=!lesson.question;$('#brief-intro').textContent=lesson.introduction||'';$('#pause-lesson').setAttribute('aria-label',lesson.paused?'Resume lesson':'Pause lesson');$('#pause-lesson').title=lesson.paused?'Resume lesson':'Pause lesson';$('#pause-lesson i').className=lesson.paused?'fa-solid fa-play':'fa-solid fa-pause';$('#working').textContent=state.working||'';renderBoard(state.board);const reveal=state.reveal||{visible:0,total:0};$('#reveal-status').textContent=reveal.total?'Board: '+reveal.visible+' / '+reveal.total+' lines':'';$('#reveal-back').disabled=reveal.visible<=1;$('#reveal-next').disabled=reveal.visible>=reveal.total;renderCheck();renderRecap();
 const feed=$('#feed');feed.replaceChildren();const items=tab==='questions'?[...state.questions].sort((a,b)=>(b.votes||0)-(a.votes||0)||a.at-b.at):state.messages;if(!items.length)feed.append(el('p',tab==='messages'?'Say hello to your classmates!':'No questions yet. Ask whenever you need help.','empty feed-empty'));items.forEach(item=>{const itemEl=el('div','','post');itemEl.append(el('strong',item.name),el('p',item.text));if(tab==='questions'){const vote=el('button','▲ '+(item.votes||0),'vote-button');vote.type='button';vote.setAttribute('aria-label','Upvote question by '+item.name);vote.setAttribute('aria-pressed',String(votedQuestions.has(item.id)));vote.onclick=async()=>{vote.disabled=true;try{const result=await api('vote',{id:item.id,clientId});result.voted?votedQuestions.add(item.id):votedQuestions.delete(item.id);render()}catch(e){alert(e.message)}finally{vote.disabled=false}};itemEl.append(vote)}feed.append(itemEl)});$('#count').textContent=state.questions.length||'';
 const q=$('#teacher-questions');q.replaceChildren();if(!state.questions.length)q.append(el('p','No questions yet.','note'));[...state.questions].sort((a,b)=>(b.votes||0)-(a.votes||0)||a.at-b.at).forEach(item=>{const box=el('div','','question');box.append(el('strong',item.name+' · '+(item.votes||0)+' votes'),el('p',item.text));const actions=el('div','','question-actions');const show=el('button','Show on board','text-button');show.onclick=()=>api('spotlight',{id:item.id},true).catch(e=>alert(e.message));const ask=el('button','Ask AI','text-button');ask.onclick=async()=>{try{await api('handoff',{id:item.id},true);await teachAI('A student asks: '+item.text+'. Address this question clearly for the class.')}catch(e){alert(e.message)}};const button=el('button','Mark answered','text-button');button.onclick=()=>api('resolve',{id:item.id},true).catch(e=>alert(e.message));actions.append(show,ask,button);box.append(actions);q.append(box)});
 const hands=state.hands||[], mine=hands.some(h=>h.id===clientId);$('#hand-toggle').setAttribute('aria-pressed',String(mine));$('#hand-toggle').setAttribute('aria-label',mine?'Lower hand':'Raise hand');$('#hand-toggle').title=mine?'Lower hand':'Raise hand';$('#hand-toggle').classList.toggle('raised',mine);$('#hand-count').textContent=hands.length?'('+hands.length+')':'';const handList=$('#teacher-hands');handList.replaceChildren();if(!hands.length)handList.append(el('p','No hands raised.','note'));else hands.forEach(h=>handList.append(el('p',h.name,'raised-name')));
}
let activePanel=null;
const dockButtons=['#explanation-toggle','#chat-tab','#questions-tab','#check-toggle','#recap-toggle','#board-theme-toggle','#reactions-toggle','#teacher-toggle'];
function dismissHint(){const hint=$('#dock-hint');hint.hidden=true;try{localStorage.setItem('mathfox-tools-hint-dismissed','1')}catch{}}
try{if(!localStorage.getItem('mathfox-tools-hint-dismissed'))$('#dock-hint').hidden=false}catch{$('#dock-hint').hidden=false}
$('#dismiss-hint').onclick=dismissHint;
const mobileDock=window.matchMedia('(max-width: 650px)');
let lastTool='#explanation-toggle';
try{const saved=localStorage.getItem('mathfox-last-tool');if(dockButtons.includes(saved))lastTool=saved}catch{}
function updateDockIcon(){const tool=$(lastTool);$('#dock-toggle i').className=tool.querySelector('i').className;const verb=$('#dock-toggle').getAttribute('aria-expanded')==='true'?'Hide':'Show';$('#dock-toggle').setAttribute('aria-label',verb+' class tools. Last selected: '+tool.title)}
function setDockOpen(open){$('#dock-items').inert=mobileDock.matches&&!open;$('#dock-items').classList.toggle('mobile-open',open);$('#dock-toggle').setAttribute('aria-expanded',String(open));updateDockIcon()}
$('#dock-toggle').onclick=()=>{dismissHint();setDockOpen($('#dock-toggle').getAttribute('aria-expanded')!=='true')};
setDockOpen(false);mobileDock.addEventListener('change',()=>setDockOpen(false));

const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
function panelMotion(panel,opening){
  panel.getAnimations().forEach(animation=>animation.cancel());
  const mobileSheet=mobileDock.matches&&panel.id==='community-panel';
  const resting=mobileSheet?'translateY(0)':'translateY(-50%)';
  const offset=mobileSheet?'translateY(18px)':'translateY(-50%) translateX(12px)';
  if(opening){panel.hidden=false;panel.inert=false}else panel.inert=true;
  if(reducedMotion.matches||!panel.animate){if(!opening)panel.hidden=true;return}
  const animation=panel.animate(opening?[{opacity:0,transform:offset},{opacity:1,transform:resting}]:[{opacity:1,transform:resting},{opacity:0,transform:offset}],{duration:opening?260:180,easing:opening?'cubic-bezier(.16,1,.3,1)':'cubic-bezier(.4,0,1,1)',fill:'both'});
  animation.finished.then(()=>{if(!opening)panel.hidden=true;animation.cancel()}).catch(()=>{});
}
function closePanels(){document.body.classList.remove('community-open');for(const id of ['#explanation-panel','#community-panel','#check-panel','#recap-panel','#board-theme-panel','#reactions-panel','#teacher']){const panel=$(id);if(id==='#teacher'&&isTeacher){panel.hidden=false;continue}if(!panel.hidden)panelMotion(panel,false)}for(const id of dockButtons){$(id).classList.remove('active');$(id).setAttribute('aria-expanded','false')}activePanel=null}
function openPanel(kind,button){dismissHint();lastTool=button;try{localStorage.setItem('mathfox-last-tool',button)}catch{}updateDockIcon();if(activePanel===kind)return;closePanels();activePanel=kind;document.body.classList.toggle('community-open',kind==='messages'||kind==='questions');if(isTeacher&&kind!=='teacher')$('#teacher').hidden=true;const panel=kind==='explanation'?'#explanation-panel':kind==='teacher'?'#teacher':kind==='reactions'?'#reactions-panel':kind==='theme'?'#board-theme-panel':kind==='check'?'#check-panel':kind==='recap'?'#recap-panel':'#community-panel';panelMotion($(panel),true);$(button).classList.add('active');$(button).setAttribute('aria-expanded','true')}
function selectTab(next){tab=next;openPanel(next,next==='messages'?'#chat-tab':'#questions-tab');$('#community-title').textContent=tab==='messages'?'Class chat':'Questions';$('#message-label').textContent=tab==='messages'?'Say something to the class':'Ask your teacher';$('#message').placeholder=tab==='messages'?'Message the class…':'Ask a question…';const sendLabel=tab==='messages'?'Send message':'Ask question';$('#send').setAttribute('aria-label',sendLabel);$('#send').title=sendLabel;render()}
const boardThemes=['navy','slate','forest','paper'];
function setBoardTheme(theme){if(!boardThemes.includes(theme))theme='navy';$('#board').dataset.theme=theme;document.querySelectorAll('button[data-theme]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.theme===theme)));try{localStorage.setItem('mathfox-board-theme',theme)}catch{}}
let savedTheme='navy';try{savedTheme=localStorage.getItem('mathfox-board-theme')||'navy'}catch{}setBoardTheme(savedTheme);
function updateBoardSoundControl(){const button=$('#board-sounds');button.setAttribute('aria-pressed',String(boardSounds));button.textContent=boardSounds?'On':'Off'}updateBoardSoundControl();$('#board-sounds').onclick=()=>{boardSounds=!boardSounds;try{localStorage.setItem('mathfox-board-sounds',boardSounds?'on':'off')}catch{}updateBoardSoundControl();if(boardSounds)playBoardCue(false)};
$('#board-theme-toggle').onclick=()=>openPanel('theme','#board-theme-toggle');document.querySelectorAll('button[data-theme]').forEach(button=>button.onclick=()=>setBoardTheme(button.dataset.theme));
$('#check-toggle').onclick=()=>openPanel('check','#check-toggle');$('#recap-toggle').onclick=()=>openPanel('recap','#recap-toggle');
$('#hand-toggle').onclick=async()=>{try{await api('hand',{id:clientId,name:$('#name').value})}catch(e){alert(e.message)}};$('#reactions-toggle').onclick=()=>openPanel('reactions','#reactions-toggle');document.querySelectorAll('[data-reaction]').forEach(button=>button.onclick=async()=>{try{await api('reaction',{reaction:button.dataset.reaction})}catch(e){alert(e.message)}});
$('#chat-tab').onclick=()=>selectTab('messages');$('#questions-tab').onclick=()=>selectTab('questions');$('#explanation-toggle').onclick=()=>openPanel('explanation','#explanation-toggle');document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>{const previous=activePanel;closePanels();const target=previous==='explanation'?'#explanation-toggle':previous==='messages'?'#chat-tab':previous==='questions'?'#questions-tab':previous==='reactions'?'#reactions-toggle':previous==='theme'?'#board-theme-toggle':previous==='check'?'#check-toggle':previous==='recap'?'#recap-toggle':'#teacher-toggle';(mobileDock.matches?$('#dock-toggle'):$(target)).focus()});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&activePanel&&$('#participants-panel').hidden){const target=mobileDock.matches?$('#dock-toggle'):document.querySelector('.dock-button.active');closePanels();target?.focus()}});
$('#message-form').onsubmit=async e=>{e.preventDefault();const name=$('#name').value.trim(),text=$('#message').value.trim(),kind=tab;if(!name||!text)return;const button=$('#send');button.disabled=true;try{await updatePresence();await api(kind==='messages'?'message':'question',{name,text});if($('#message').value.trim()===text)$('#message').value='';$('#feed').scrollTop=$('#feed').scrollHeight}catch(err){alert(err.message)}finally{button.disabled=false}};
$('#message').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('#message-form').requestSubmit()}});
$('#teacher-toggle').onclick=async()=>{if(activePanel==='teacher'||!state)return;try{const response=await fetch('/teacher-token');if(!response.ok)throw Error('Teacher access required.');token=(await response.json()).token;openPanel('teacher','#teacher-toggle');$('#edit-title').value=state.title;$('#rows').value=state.board.rows.map(r=>r.text??r.cells?.map(c=>c.text).join(' ')??'').join('\n');$('#board-layout').value=state.board.layout==='columns'?'columns':'working';$('#edit-working').value=state.working||'';$('#edit-explanation').value=state.explanation}catch{$('#status').textContent='Connection unavailable'}};
$('#lesson-form').onsubmit=async e=>{e.preventDefault();try{await api('update',{title:$('#edit-title').value,board:{title:'The Board',layout:$('#board-layout').value,rows:$('#rows').value.split('\n').filter(x=>x.trim()).map((text,index,rows)=>({text,kind:index===rows.length-1?'answer':'active'})),angles:[]},stage:$('#stage-board').checked,working:$('#edit-working').value,explanation:$('#edit-explanation').value},true);$('#teacher-note').textContent='Lesson updated.'}catch(err){$('#teacher-note').textContent=err.message}};
$('#go-live').onclick=()=>api('update',{status:'live'},true);$('#end-class').onclick=()=>api('update',{status:'ended'},true);
$('#start-lesson').onsubmit=async event=>{event.preventDefault();try{await api('lesson',{topic:$('#lesson-topic').value,grade:$('#lesson-grade').value,exam:$('#lesson-exam').value,introduction:$('#lesson-intro').value,question:$('#lesson-question').value},true);$('#teacher-note').textContent='Lesson started. The AI is preparing the first step…';await teachAI()}catch(error){$('#teacher-note').textContent=error.message}};
function addAiMessage(role,text){const feed=$('#teacher-ai-feed');if(!feed)return;const message=el('div','','teacher-ai-message '+role);message.append(el('small',role==='teacher'?'You':'Numbafox AI'),el('div',text));feed.append(message);feed.scrollTop=feed.scrollHeight}
async function applyRoomSnapshot(snapshot){if(!snapshot||typeof snapshot!=='object')return;const prior=state;state=snapshot;render();if(state.lesson?.step>(prior?.lesson?.step||0)&&!state.lesson?.paused&&!state.voice?.active)playNarration(state.explanation)}
async function teachAI(instruction='',image=null){const buttons=[$('#generate'),$('#ask-ai')];buttons.forEach(b=>b.disabled=true);if(instruction)addAiMessage('teacher',instruction);else addAiMessage('teacher','Continue with the next teaching step.');$('#teacher-note').textContent='AI is preparing the next board update…';try{const result=await api('ai',{instruction,image},true);await applyRoomSnapshot(result.room);addAiMessage('ai','I have prepared the next step and sent it to the board.');$('#teacher-note').textContent='Board updated.'}catch(error){$('#teacher-note').textContent=error.message;addAiMessage('ai','I could not update the board: '+error.message);throw error}finally{buttons.forEach(b=>b.disabled=false)}}
$('#generate').onclick=()=>teachAI().catch(()=>{});let teacherImage=null;
function clearTeacherImage(){teacherImage=null;$('#teacher-image-file').value='';$('#teacher-image').removeAttribute('src');$('#teacher-image-preview').hidden=true}
$('#remove-teacher-image').onclick=clearTeacherImage;$('#attach-teacher-image').onclick=()=>$('#teacher-image-file').click();
$('#teacher-image-file').onchange=event=>{const file=event.target.files?.[0];if(!file)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type)){clearTeacherImage();$('#teacher-note').textContent='Choose a JPEG, PNG or WebP image.';return}const url=URL.createObjectURL(file),image=new Image();image.onload=()=>{try{const scale=Math.min(1,1600/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);teacherImage=canvas.toDataURL('image/jpeg',.82);$('#teacher-image').src=teacherImage;$('#teacher-image-preview').hidden=false;$('#teacher-note').textContent='Image ready to send with your instruction.'}catch{clearTeacherImage();$('#teacher-note').textContent='The image could not be prepared.'}finally{URL.revokeObjectURL(url)}};image.onerror=()=>{URL.revokeObjectURL(url);clearTeacherImage();$('#teacher-note').textContent='The image could not be opened.'};image.src=url};
$('#ask-ai').onclick=()=>{const instruction=$('#ai-instruction').value.trim(),image=teacherImage;if(!instruction&&!image){$('#teacher-note').textContent='Add a question or image first.';return}teachAI(instruction||'Please explain the maths question in this image to the class.',image).then(()=>{$('#ai-instruction').value='';if(teacherImage===image)clearTeacherImage()}).catch(()=>{})};
$('#ai-instruction').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('#ask-ai').click()}});
$('#reveal-back').onclick=()=>api('reveal',{direction:'back'},true).catch(e=>$('#teacher-note').textContent=e.message);$('#reveal-next').onclick=()=>api('reveal',{direction:'next'},true).catch(e=>$('#teacher-note').textContent=e.message);$('#replay-lesson').onclick=()=>api('replay',{},true).catch(e=>$('#teacher-note').textContent=e.message);$('#return-lesson').onclick=async()=>{try{await api('return-lesson',{},true);$('#teacher-note').textContent='Returned to the lesson. Choose the next AI step when ready.'}catch(e){$('#teacher-note').textContent=e.message}};
$('#check-form').onsubmit=async event=>{event.preventDefault();try{await api('poll',{question:$('#check-question').value,options:$('#check-options').value.split('\n')},true);$('#check-results').textContent='Check is live.'}catch(error){$('#check-results').textContent=error.message}};$('#close-check').onclick=()=>api('poll-close',{},true).catch(e=>$('#check-results').textContent=e.message);
function renderCheck(){const root=$('#check-content');root.replaceChildren();const poll=state.poll;if(!poll){root.append(el('p','No check is active yet.','note'));$('#check-results').textContent='';return}root.append(el('h3',poll.question,'check-question'));const already=answeredPoll===poll.id;poll.options.forEach((option,index)=>{const button=el('button',option,'check-choice');button.disabled=already||poll.closed;button.onclick=async()=>{button.disabled=true;try{await api('poll-vote',{id:clientId,choice:index});answeredPoll=poll.id;renderCheck()}catch(error){alert(error.message);button.disabled=false}};root.append(button)});if(already||poll.closed)root.append(el('p',poll.closed?'This check is closed.':'Answer received.','note'));$('#check-results').textContent=poll.options.map((option,index)=>option+': '+poll.counts[index]).join(' · ')+(poll.closed?' (closed)':'')}
function renderRecap(){const root=$('#recap-content');root.replaceChildren();const entries=state.recap||[];if(!entries.length){root.append(el('p','The lesson recap will appear here as the class progresses.','note'));return}entries.forEach((entry,index)=>{const block=document.createElement('details');block.className='recap-entry';const summary=el('summary','Step '+(index+1));block.append(summary);if(entry.working)block.append(el('p',entry.working,'recap-text'));else if(entry.board?.rows?.length)block.append(el('p',entry.board.rows.map(row=>row.text??row.cells?.map(c=>c.text).join(' ')??'').join('\n'),'recap-text'));if(entry.explanation){const spoken=el('p',entry.explanation,'recap-spoken');block.append(spoken)}root.append(block)})}
$('#pause-lesson').onclick=()=>api('lesson-control',{paused:!state.lesson.paused},true).catch(e=>$('#teacher-note').textContent=e.message);
// Local WebRTC audio: viewers opt in before the teacher's microphone connects.
let microphoneStream=null,audioEnabled=true,listenerPeer=null,voiceRequested=false,lastNarratedStep=0;
const teacherPeers=new Map(), earlyIce=new Map();
function closePeer(peer){if(peer){peer.onicecandidate=null;peer.ontrack=null;peer.close()}}
function resetVoicePeers(){for(const peer of teacherPeers.values())closePeer(peer);teacherPeers.clear();earlyIce.clear();closePeer(listenerPeer);listenerPeer=null;voiceRequested=false;$('#teacher-audio').srcObject=null}
async function signalPeer(to,signal,isTeacher=false){return api('voice-signal',{from:clientId,to,signal},isTeacher)}
function attachIce(peer,to,isTeacher){peer.pendingCandidates=[];peer.onicecandidate=event=>{if(event.candidate)signalPeer(to,{type:'ice',candidate:event.candidate.toJSON()},isTeacher).catch(()=>{})}}
async function receiveIce(peer,candidate){if(peer.remoteDescription)await peer.addIceCandidate(candidate);else peer.pendingCandidates.push(candidate)}
async function flushIce(peer){for(const candidate of peer.pendingCandidates.splice(0))await peer.addIceCandidate(candidate)}
async function addListener(id){if(!microphoneStream||teacherPeers.has(id))return;const peer=new RTCPeerConnection();teacherPeers.set(id,peer);attachIce(peer,id,true);microphoneStream.getTracks().forEach(track=>peer.addTrack(track,microphoneStream));peer.onconnectionstatechange=()=>{if(['closed','failed','disconnected'].includes(peer.connectionState)){closePeer(peer);teacherPeers.delete(id)}};const offer=await peer.createOffer();await peer.setLocalDescription(offer);await signalPeer(id,{type:'offer',sdp:peer.localDescription.sdp},true)}
async function receiveSignal(data){const {from,signal}=data;if(microphoneStream){const peer=teacherPeers.get(from);if(!peer)return;if(signal.type==='answer'){await peer.setRemoteDescription({type:'answer',sdp:signal.sdp});await flushIce(peer)}else if(signal.type==='ice')await receiveIce(peer,signal.candidate);return}
 if(signal.type==='offer'){if(!audioEnabled)return;closePeer(listenerPeer);const peer=new RTCPeerConnection();listenerPeer=peer;attachIce(peer,from,false);peer.ontrack=event=>{$('#teacher-audio').srcObject=event.streams[0];$('#teacher-audio').play().catch(()=>{$('#voice-label').textContent='Tap to enable audio'});$('#voice-label').textContent='Teacher live';$('#voice-indicator').setAttribute('aria-label','Teacher microphone is live')};await peer.setRemoteDescription({type:'offer',sdp:signal.sdp});for(const candidate of earlyIce.get(from)||[])peer.pendingCandidates.push(candidate);earlyIce.delete(from);await flushIce(peer);const answer=await peer.createAnswer();await peer.setLocalDescription(answer);await signalPeer(from,{type:'answer',sdp:peer.localDescription.sdp});}else if(signal.type==='ice'){if(listenerPeer)await receiveIce(listenerPeer,signal.candidate);else{const pending=earlyIce.get(from)||[];if(pending.length<100)pending.push(signal.candidate);earlyIce.set(from,pending)}}}
async function requestTeacherAudio(){if(!audioEnabled||!state?.voice?.active||state.voice.teacherId===clientId||voiceRequested)return;voiceRequested=true;try{await api('listen-voice',{id:clientId})}catch{voiceRequested=false}}
async function stopMicrophone(){if(microphoneStream){await api('voice-stop',{id:clientId},true).catch(()=>{});microphoneStream.getTracks().forEach(track=>track.stop());microphoneStream=null}resetVoicePeers();$('#microphone').innerHTML='<i class="fa-solid fa-microphone" aria-hidden="true"></i>';$('#microphone').setAttribute('aria-label','Start microphone');$('#microphone').title='Start microphone';$('#microphone-status').textContent='Microphone off';setSpeaking(false)}
$('#microphone').onclick=async()=>{if(microphoneStream){await stopMicrophone();return}try{if(!navigator.mediaDevices?.getUserMedia)throw Error('Microphone is not available in this browser.');microphoneStream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});await api('voice-start',{id:clientId},true);$('#microphone').innerHTML='<i class="fa-solid fa-microphone-slash" aria-hidden="true"></i>';$('#microphone').setAttribute('aria-label','Stop microphone');$('#microphone').title='Stop microphone';$('#microphone-status').textContent='Microphone live';$('#voice-label').textContent='Teacher live';$('#voice-indicator').setAttribute('aria-label','Teacher microphone is live');microphoneStream.getAudioTracks().forEach(track=>track.onended=()=>stopMicrophone())}catch(error){if(microphoneStream)microphoneStream.getTracks().forEach(t=>t.stop());microphoneStream=null;$('#microphone-status').textContent=error.message||'Microphone permission was not granted.'}};
$('#enable-voice').onclick=()=>{audioEnabled=true;$('#enable-voice').textContent='Class audio enabled';$('#enable-voice').disabled=true;if(state?.voice?.active)requestTeacherAudio();else if(state?.explanation&&state.lesson?.step>0)playNarration(state.explanation)};
function playNarration(text){if(!audioEnabled||!('speechSynthesis'in window)||!text)return;window.speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(text);utterance.onstart=()=>{setSpeaking(true);advancedController?.animate()};utterance.onend=utterance.onerror=()=>setSpeaking(false);window.speechSynthesis.speak(utterance)}
function setSpeaking(speaking){$('#voice-indicator').classList.toggle('speaking',speaking);$('#voice-label').textContent=speaking?'Speaking':'Voice quiet';$('#voice-indicator').setAttribute('aria-label',speaking?'Lesson voice is speaking':'Voice is quiet')}
$('#listen').onclick=()=>{if(!('speechSynthesis'in window))return;window.speechSynthesis.cancel();setSpeaking(false);const utterance=new SpeechSynthesisUtterance(state.explanation);utterance.onstart=()=>setSpeaking(true);utterance.onend=utterance.onerror=()=>setSpeaking(false);window.speechSynthesis.speak(utterance)};
function updatePresence(){return api('presence',{id:clientId,name:$('#name').value}).catch(()=>{})}
$('#name').addEventListener('change',()=>{try{localStorage.setItem('mathfox-display-name',$('#name').value.trim())}catch{}updatePresence()});
const joinDialog=$('#join-dialog');let savedName='';try{savedName=localStorage.getItem('mathfox-display-name')||''}catch{}$('#join-form').onsubmit=event=>{event.preventDefault();const name=$('#join-name').value.trim();if(!name)return;$('#name').value=name;try{localStorage.setItem('mathfox-display-name',name)}catch{}joinDialog.close();updatePresence()};$('#test-sound').onclick=()=>{if('speechSynthesis'in window){window.speechSynthesis.cancel();window.speechSynthesis.speak(new SpeechSynthesisUtterance('Welcome to class.'))}};
function participantInitial(name){return name==='Guest'?'•':Array.from(name.trim())[0]?.toUpperCase()||'•'}
function renderPresence(people){const stack=$('#avatar-stack'),list=$('#participants-list');stack.replaceChildren();list.replaceChildren();people.slice(0,4).forEach(person=>{const avatar=el('span',participantInitial(person.name),'avatar');avatar.title=person.name;avatar.setAttribute('aria-label',person.name);stack.append(avatar)});if(people.length>4)stack.append(el('span','+'+(people.length-4),'avatar avatar-more'));$('#presence-count').textContent=people.length===1?'1 here':people.length+' here';$('#participants-summary').textContent=people.length===1?'1 person online':people.length+' people online';if(!people.length)list.append(el('li','No one is connected yet.','participants-empty'));people.forEach(person=>{const item=el('li','','participant');const avatar=el('span',participantInitial(person.name),'participant-avatar');avatar.setAttribute('aria-hidden','true');const details=el('span','','participant-details');details.append(el('strong',person.name+(person.id===clientId?' (you)':'')),el('small','Online'));item.append(avatar,details);list.append(item)})}
function setParticipantsOpen(open){$('#participants-panel').hidden=!open;$('#participants-toggle').setAttribute('aria-expanded',String(open));$('#participants-toggle').setAttribute('aria-label',open?'Hide online participants':'Show online participants')}
$('#participants-toggle').onclick=()=>setParticipantsOpen($('#participants-panel').hidden);$('#close-participants').onclick=()=>{setParticipantsOpen(false);$('#participants-toggle').focus()};document.addEventListener('click',event=>{if(!$('#participants-panel').hidden&&!event.target.closest('#participants-panel')&&!event.target.closest('#participants-toggle'))setParticipantsOpen(false)});document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('#participants-panel').hidden){setParticipantsOpen(false);$('#participants-toggle').focus()}});

function showMessage(message){const popups=$('#message-popups'),bubble=el('div','','message-popup');bubble.append(el('strong',message.name),el('span',message.text));popups.append(bubble);while(popups.children.length>3)popups.firstElementChild.remove();setTimeout(()=>bubble.remove(),5000)}
let savedVisit = '';
let pendingVisit = null;
let savingVisit = false;
async function saveVisit(snapshot) {
  if (localPreview || snapshot.status !== 'live' || !snapshot.lesson?.id) return;
  const { id } = snapshot.lesson;
  const key = JSON.stringify([id, snapshot.board, snapshot.working]);
  pendingVisit = { id, key };
  if (savingVisit) return;
  savingVisit = true;
  try {
    while (pendingVisit) {
      const visit = pendingVisit;
      pendingVisit = null;
      if (visit.key === savedVisit) continue;
      await api('visit', { lessonId: visit.id });
      savedVisit = visit.key;
      $('#presence-count').removeAttribute('title');
    }
  } catch {
    $('#presence-count').title = 'Lesson notes could not sync. Reconnect to try again.';
  } finally {
    savingVisit = false;
  }
}

async function connectClassroom() {
  try {
    localPreview = (await (await fetch('/api/classroom-mode')).json()).localPreview;
    if (localPreview) {
      enableTeacherWorkspace();
      if (savedName) $('#name').value = savedName;
      else joinDialog.showModal();
    } else {
      const response = await fetch('/api/account');
      // The public Worker board permits a guest view. Authenticated classroom
      // sessions still load their profile once the full account API is present.
      if (response.status === 401) {
        if (savedName) $('#name').value = savedName;
        else joinDialog.showModal();
        return;
      }
      if (!response.ok) throw Error('Account unavailable');
      const account = await response.json();
      if (!account.profile) return location.assign('/learn');
      $('#name').value = account.profile.name;
      $('#name').readOnly = true;
      if (account.teacher) enableTeacherWorkspace();
    }
  } catch {
    $('#status').textContent = '● Classroom connection unavailable';
    return;
  }

function enableTeacherWorkspace() {
  isTeacher = true;
  document.body.classList.add('teacher-mode');
  $('#teacher-toggle').hidden = true;
  $('#teacher').hidden = false;
  const classSetup = $('#start-lesson');
  const setupPanel = classSetup?.closest('.teacher-disclosure');
  if (setupPanel && !setupPanel.dataset.teacherSetupReady) {
    setupPanel.dataset.teacherSetupReady = 'true';
    classSetup.hidden = true;
    setupPanel.querySelector('summary').textContent = 'Class details';
    const note = el('p', 'Class details are chosen when you create the class in Teacher settings. ', 'note');
    const link = document.createElement('a');
    link.href = '/learn';
    link.textContent = 'Return to Teacher settings';
    note.append(link, '.');
    setupPanel.append(note);
  }
  const aiHeading = $('#teacher .teacher-chat-heading strong');
  const aiDescription = $('#teacher .teacher-chat-heading small');
  if (aiHeading) aiHeading.textContent = 'Private AI chat';
  if (aiDescription) aiDescription.textContent = 'Only you can guide the AI here — students cannot see this conversation.';
  const heading = $('#teacher .teacher-heading > div');
  if (heading && !$('#open-shared-chat')) {
    const sharedChat = document.createElement('button');
    sharedChat.id = 'open-shared-chat';
    sharedChat.type = 'button';
    sharedChat.className = 'teacher-shared-chat';
    sharedChat.innerHTML = '<i class="fa-solid fa-comments" aria-hidden="true"></i> Open class chat';
    sharedChat.onclick = () => selectTab('messages');
    heading.append(sharedChat);
  }
  const aiChat = $('#teacher .teacher-chat');
  if (aiChat && !$('#teacher-ai-feed')) {
    const feed = document.createElement('div');
    feed.id = 'teacher-ai-feed';
    feed.className = 'teacher-ai-feed';
    aiChat.querySelector('.teacher-composer').before(feed);
    addAiMessage('ai', 'I’m ready to help you direct this class. Tell me what to teach, adapt, or put on the board.');
  }
  const teacherGrid = $('#teacher .teacher-grid');
  if (teacherGrid && !$('#teacher-tabs')) {
    const tabs = document.createElement('div');
    tabs.id = 'teacher-tabs';
    tabs.className = 'teacher-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Teacher workspaces');
    teacherGrid.before(tabs);
    const disclosures = [...teacherGrid.querySelectorAll('.teacher-disclosure')];
    const paneWith = text => disclosures.find(pane => pane.querySelector('summary')?.textContent.includes(text));
    const panes = [
      aiChat,
      paneWith('Question queue'),
      paneWith('Raised hands'),
      paneWith('Class details'),
      paneWith('Edit the lesson'),
      paneWith('Understanding check')
    ].filter(Boolean);
    panes.forEach((pane, index) => {
      pane.classList.add('teacher-tab-pane');
      teacherGrid.append(pane);
      const button = document.createElement('button');
      const label = index === 0 ? 'AI chat' : pane.querySelector('summary')?.textContent.trim() || 'Teacher tools';
      button.type = 'button';
      button.textContent = label;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(index === 0));
      button.onclick = () => {
        panes.forEach((item, itemIndex) => {
          item.hidden = itemIndex !== index;
          tabs.children[itemIndex].setAttribute('aria-selected', String(itemIndex === index));
        });
      };
      tabs.append(button);
      pane.hidden = index !== 0;
    });
    teacherGrid.querySelector('.teacher-side')?.remove();
  }
  const attachment = $('#attach-teacher-image');
  if (attachment && !attachment.dataset.friendlyLabel) {
    attachment.dataset.friendlyLabel = 'true';
    attachment.classList.add('teacher-attachment');
    attachment.innerHTML = '<i class="fa-solid fa-paperclip" aria-hidden="true"></i><span>Attach image</span>';
  }
  tab = 'messages';
  render();
}
async function refreshRoomSnapshot(){
  try{const response=await fetch('/api/state',{cache:'no-store'});if(response.ok)await applyRoomSnapshot(await response.json())}catch{}
}
const events=new EventSource('/events?id='+encodeURIComponent(clientId));events.addEventListener('open',()=>{renderPresence([{id:clientId,name:$('#name').value.trim()||'Guest'}]);updatePresence();refreshRoomSnapshot()});events.addEventListener('presence',e=>renderPresence(JSON.parse(e.data)));events.addEventListener('message',e=>showMessage(JSON.parse(e.data)));events.addEventListener('reaction',e=>{const item=el('span',JSON.parse(e.data).symbol,'reaction-float');$('#reaction-popups').append(item);setTimeout(()=>item.remove(),2200)});events.addEventListener('replay',()=>{if(state?.explanation)playNarration(state.explanation)});events.addEventListener('voice-listener',e=>addListener(JSON.parse(e.data).id).catch(()=>{$('#microphone-status').textContent='A listener could not connect.'}));events.addEventListener('voice-signal',e=>receiveSignal(JSON.parse(e.data)).catch(()=>{$('#voice-label').textContent='Audio connection failed'}));events.addEventListener('voice-ended',()=>{resetVoicePeers();if(!microphoneStream)setSpeaking(false)});events.addEventListener('state',e=>{const next=JSON.parse(e.data),prior=state;state=next;render();saveVisit(next);if(!prior)lastNarratedStep=next.lesson?.step||0;else if(next.lesson?.step>lastNarratedStep){lastNarratedStep=next.lesson.step;if(!next.lesson.paused&&next.lesson.speaker==='ai'&&!next.voice.active)playNarration(state.explanation)}else if(next.lesson?.step===0){lastNarratedStep=0;if(prior?.lesson?.step>0&&'speechSynthesis'in window){window.speechSynthesis.cancel();setSpeaking(false)}}if(next.lesson?.paused&&!prior?.lesson?.paused&&'speechSynthesis'in window){window.speechSynthesis.cancel();setSpeaking(false)}if(next.voice?.active&&!prior?.voice?.active){if('speechSynthesis'in window)window.speechSynthesis.cancel();requestTeacherAudio()}if(!next.voice?.active&&prior?.voice?.active){resetVoicePeers();if(!microphoneStream)setSpeaking(false)}});events.onerror=()=>{$('#status').textContent='● Reconnecting…';setSpeaking(false);setTimeout(refreshRoomSnapshot,1000)};

}
connectClassroom();
