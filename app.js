const $=(id)=>document.getElementById(id);
const qs=(s)=>document.querySelector(s);
const qsa=(s)=>[...document.querySelectorAll(s)];
const state={role:null,loginRole:'ADMIN',source:'live',mediaRecorder:null,mediaStream:null,recording:false,shouldRestart:false,segmentTimer:null,clockTimer:null,startAt:0,elapsedBefore:0,segments:[],markers:[],cachedTranscript:'',activeReportId:null,deferredPrompt:null,transcribing:false,retryTimer:null,finalSegmentPromise:null};
const DB_KEY='meetwise_state_v1';
const defaultData={auth:{adminHash:null,guestHash:null,guestEnabled:false},prefs:{recentLimit:20,detailLevel:'standard'},keys:{groq:'',gemini:''},meetings:[],tasks:[],draftLive:null};
let data=load();
function load(){try{return {...structuredClone(defaultData),...JSON.parse(localStorage.getItem(DB_KEY)||'{}')}}catch{return structuredClone(defaultData)}}
function save(){localStorage.setItem(DB_KEY,JSON.stringify(data));renderAll()}
function saveQuiet(){localStorage.setItem(DB_KEY,JSON.stringify(data))}
function uid(){return crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2)}
async function hash(s){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600)}
function esc(s=''){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function fmtTime(sec){sec=Math.max(0,Math.floor(sec));const h=String(Math.floor(sec/3600)).padStart(2,'0'),m=String(Math.floor(sec%3600/60)).padStart(2,'0'),s=String(sec%60).padStart(2,'0');return `${h}:${m}:${s}`}
function fmtDate(ts){return new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(ts))}
function normalizeData(){data.auth=data.auth||defaultData.auth;data.prefs=data.prefs||defaultData.prefs;data.keys=data.keys||defaultData.keys;data.meetings=data.meetings||[];data.tasks=data.tasks||[];if(!('draftLive' in data))data.draftLive=null}
normalizeData();

async function boot(){
 // Stability-first: remove old service workers/caches so stale app shells cannot blank the UI.
 try{if('serviceWorker' in navigator){const regs=await navigator.serviceWorker.getRegistrations();await Promise.all(regs.map(r=>r.unregister()));}}catch{}
 try{if('caches' in window){const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith('meetwise-')).map(k=>caches.delete(k)));}}catch{}
 if(!data.auth.adminHash){$('loginView').classList.add('hidden');$('setupView').classList.remove('hidden')}else{$('setupView').classList.add('hidden');$('loginView').classList.remove('hidden')}
 bind();renderAll();
}
function bind(){
 $('createAdminBtn').onclick=async()=>{const a=$('setupPassword').value,b=$('setupPassword2').value;if(a.length<6)return toast('Use at least 6 characters.');if(a!==b)return toast('Passwords do not match.');data.auth.adminHash=await hash(a);save();$('setupView').classList.add('hidden');state.role='ADMIN';openApp()};
 qsa('[data-login-role]').forEach(b=>b.onclick=()=>{state.loginRole=b.dataset.loginRole;qsa('[data-login-role]').forEach(x=>x.classList.toggle('active',x===b));$('guestDisabledMsg').classList.toggle('hidden',!(state.loginRole==='GUEST'&&!data.auth.guestEnabled))});
 const submitLogin=async()=>{const role=state.loginRole;if(role==='GUEST'&&!data.auth.guestEnabled)return toast('Guest access is disabled.');const expected=role==='ADMIN'?data.auth.adminHash:data.auth.guestHash;if(!expected)return toast(`${role} password is not configured.`);if(await hash($('loginPassword').value)!==expected)return toast('Incorrect password.');state.role=role;openApp()}; $('loginBtn').onclick=submitLogin; $('loginPassword').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();submitLogin()}});
 $('logoutBtn').onclick=()=>location.reload();
 qsa('.nav-btn,.mobile-nav-btn').forEach(b=>b.onclick=()=>showPage(b.dataset.page));
 $('newMeetingTopBtn').onclick=()=>openMeeting('live');$('mobileNewBtn').onclick=()=>openMeeting('live');
 qsa('.source-card').forEach(b=>b.onclick=()=>openMeeting(b.dataset.source));
 qsa('[data-modal-source]').forEach(b=>b.onclick=()=>setSource(b.dataset.modalSource));
 qsa('[data-close]').forEach(b=>b.onclick=()=>closeModal(b.dataset.close));
 $('chooseFileBtn').onclick=()=>$('sourceFile').click();$('dropZone').onclick=(e)=>{if(e.target!==$('chooseFileBtn'))$('sourceFile').click()};
 const dz=$('dropZone');
 ['dragenter','dragover'].forEach(evt=>dz.addEventListener(evt,e=>{e.preventDefault();e.stopPropagation();dz.classList.add('dragging')}));
 ['dragleave','drop'].forEach(evt=>dz.addEventListener(evt,e=>{e.preventDefault();e.stopPropagation();dz.classList.remove('dragging')}));
 dz.addEventListener('drop',e=>{const files=e.dataTransfer?.files;if(files&&files[0]){const dt=new DataTransfer();dt.items.add(files[0]);$('sourceFile').files=dt.files;showSelectedFile(files[0]);}});
 $('sourceFile').onchange=()=>showSelectedFile($('sourceFile').files[0]);
 $('startRecBtn').onclick=startRecording;$('finishRecBtn').onclick=finishRecording;$('markBtn').onclick=markImportant;
 $('processMeetingBtn').onclick=processMeeting;
 $('quickSearch').oninput=()=>renderMeetings();$('meetingSearch').oninput=()=>renderMeetings();$('taskFilter').onchange=renderTasks;
 $('saveKeysBtn').onclick=()=>{data.keys.groq=$('groqKey').value.trim();data.keys.gemini=$('geminiKey').value.trim();save();toast('API settings saved on this device.')};
 $('saveGuestBtn').onclick=async()=>{data.auth.guestEnabled=$('guestEnabled').checked;const p=$('guestPassword').value;if(p){if(p.length<6)return toast('Guest password needs at least 6 characters.');data.auth.guestHash=await hash(p)}save();$('guestPassword').value='';toast('Guest settings saved.')};
 $('savePrefsBtn').onclick=()=>{data.prefs.recentLimit=Number($('recentLimit').value);save();toast('Preference saved.')};
 $('backupBtn').onclick=()=>downloadBlob(`meetwise-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify({...data,keys:{groq:'',gemini:''}},null,2),'application/json');
 $('txtBtn').onclick=exportTxt;$('wordBtn').onclick=exportWord;$('pdfBtn').onclick=()=>window.print();$('saveEditedBtn').onclick=saveEditedReport;
 window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.deferredPrompt=e;$('installBtn').classList.remove('hidden')});
 $('installBtn').onclick=async()=>{if(state.deferredPrompt){state.deferredPrompt.prompt();await state.deferredPrompt.userChoice;state.deferredPrompt=null;$('installBtn').classList.add('hidden')}};
 window.onclick=(e)=>{if(e.target.classList.contains('modal'))closeModal(e.target.id)};
 window.addEventListener('online',()=>{if(state.recording||state.segments.some(x=>!x.text))drainTranscriptionQueue();});
}
function openApp(){$('setupView').classList.add('hidden');$('loginView').classList.add('hidden');$('appView').classList.remove('hidden');$('roleBadge').textContent=state.role;document.body.dataset.role=state.role;qsa('.admin-only').forEach(x=>x.classList.toggle('hidden',state.role!=='ADMIN'));showPage('home');renderAll()}
function showPage(name){qsa('.page').forEach(p=>p.classList.add('hidden'));$(`${name}Page`)?.classList.remove('hidden');const titles={home:'Workspace',meetings:'Meeting Memory',tasks:'Action Register',reports:'Reports',settings:'Settings'};$('pageTitle').textContent=titles[name]||'Meetwise';qsa('.nav-btn,.mobile-nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.page===name));if(name==='settings')fillSettings();}
function fillSettings(){$('groqKey').value=data.keys.groq||'';$('geminiKey').value=data.keys.gemini||'';$('guestEnabled').checked=!!data.auth.guestEnabled;$('recentLimit').value=String(data.prefs.recentLimit||20)}
function openMeeting(source){state.segments=[];state.markers=[];state.cachedTranscript='';clearTimeout(state.retryTimer);$('meetingTitleInput').value='';$('textSource').value='';$('sourceFile').value='';$('selectedFileName').textContent='';$('processingBox').classList.add('hidden');$('processMeetingBtn').disabled=false;$('markerList').innerHTML='';$('recordTime').textContent='00:00:00';$('recordStatus').textContent='Ready for a long meeting. Audio is saved in 60-second local chunks and transcribed progressively.';setSource(source);$('meetingModal').classList.remove('hidden')}
function setSource(source){state.source=source;qsa('[data-modal-source]').forEach(b=>b.classList.toggle('active',b.dataset.modalSource===source));['liveInput','fileInputPane','textInputPane'].forEach(id=>$(id).classList.add('hidden'));const map={live:'liveInput',file:'fileInputPane',text:'textInputPane'};$(map[source]).classList.remove('hidden');$('modalHeading').textContent={live:'Start Live Meeting',file:'Upload Recording',text:'Use Text / Transcript'}[source]}
function closeModal(id){if(id==='meetingModal'&&state.recording){toast('Finish the recording before closing.');return}$(id).classList.add('hidden')}

function fileExt(name=''){const m=String(name).toLowerCase().match(/\.([a-z0-9]+)$/);return m?m[1]:''}
function classifyFile(file){const ext=fileExt(file?.name||'');const type=file?.type||'';if(type.startsWith('audio/')||['mp3','m4a','wav','webm','ogg','aac'].includes(ext))return 'audio';if(type.startsWith('video/')||['mp4','mov','mkv','webm'].includes(ext))return 'video';if(['txt','csv'].includes(ext)||type.startsWith('text/'))return 'textdoc';if(['pdf','doc','docx'].includes(ext))return 'document';if(['xls','xlsx'].includes(ext))return 'spreadsheet';if(['ppt','pptx'].includes(ext))return 'presentation';return 'unknown'}
function showSelectedFile(file){if(!file){$('selectedFileName').textContent='';return}const kind=classifyFile(file);$('selectedFileName').textContent=`${file.name} • ${kind} • ${(file.size/1024/1024).toFixed(2)} MB`;if(kind==='video'&&$('recordingType'))$('recordingType').value='youtube';}
async function extractDocument(file){const ext=fileExt(file.name);if(['txt','csv'].includes(ext)||file.type.startsWith('text/'))return await file.text();const maxDirect=4*1024*1024;if(file.size>maxDirect)throw new Error(`This document is ${(file.size/1024/1024).toFixed(1)} MB. Current Vercel preview document processing supports about 4 MB per file.`);const form=new FormData();form.append('file',file,file.name);const r=await fetch('/api/extract-document',{method:'POST',body:form});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Document extraction failed.');return j.text||''}

async function startRecording(){
 try{
  state.mediaStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
  state.recording=true;state.shouldRestart=true;state.startAt=Date.now();state.elapsedBefore=0;state.segments=[];state.markers=[];state.cachedTranscript='';state.transcribing=false;clearTimeout(state.retryTimer);
  data.draftLive={id:uid(),startedAt:state.startAt,title:$('meetingTitleInput').value.trim(),markers:[],segments:[]};saveQuiet();
  $('startRecBtn').classList.add('hidden');$('finishRecBtn').classList.remove('hidden');$('markBtn').disabled=false;$('recIndicator').classList.add('active');
  $('recordStatus').textContent='Long Meeting Mode active • saving 60-second chunks locally…';state.clockTimer=setInterval(updateClock,500);startSegment();
 }catch(e){toast('Microphone permission is required.')}
}
function preferredAudioMime(){return ['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(m=>MediaRecorder.isTypeSupported(m))||''}
function startSegment(){
 if(!state.recording||!state.mediaStream)return;
 const mime=preferredAudioMime();
 state.mediaRecorder=new MediaRecorder(state.mediaStream,mime?{mimeType:mime}:undefined);
 const recorder=state.mediaRecorder,parts=[];
 recorder.ondataavailable=e=>{if(e.data.size)parts.push(e.data)};
 state.finalSegmentPromise=new Promise(resolve=>{
  recorder.onstop=async()=>{
   try{
    const blob=new Blob(parts,{type:recorder.mimeType||'audio/webm'});
    if(blob.size>500){
     const index=state.segments.length+1,key=`long-${data.draftLive?.id||'meeting'}-${String(index).padStart(4,'0')}`;
     const segment={blob,index,key,text:'',status:'saved'};state.segments.push(segment);
     await idbPut(key,blob).catch(()=>{});
     if(data.draftLive){data.draftLive.markers=[...state.markers];data.draftLive.title=$('meetingTitleInput').value.trim();data.draftLive.segments.push({key,index,text:'',status:'saved'});saveQuiet()}
     updateLongMeetingStatus();
     drainTranscriptionQueue();
    }
   }finally{
    resolve();
    if(state.shouldRestart&&state.recording)setTimeout(startSegment,80);
   }
  };
 });
 recorder.start();
 state.segmentTimer=setTimeout(()=>{if(recorder.state==='recording')recorder.stop()},60000);
}
function updateClock(){const sec=(Date.now()-state.startAt)/1000;$('recordTime').textContent=fmtTime(sec)}
function markImportant(){const sec=(Date.now()-state.startAt)/1000;state.markers.push(Math.floor(sec));if(data.draftLive){data.draftLive.markers=[...state.markers];saveQuiet()}const s=document.createElement('span');s.className='marker';s.textContent=`★ ${fmtTime(sec)}`;$('markerList').appendChild(s);toast('Important moment marked.')}
function updateLongMeetingStatus(){
 if(!state.segments.length)return;
 const done=state.segments.filter(x=>x.text).length,total=state.segments.length,pending=total-done;
 const offline=!navigator.onLine;
 $('recordStatus').textContent=offline?`Recording continues offline • ${total} chunk(s) saved locally • ${pending} waiting to transcribe`:`Long Meeting Mode • ${total} chunk(s) saved • ${done} transcribed${pending?` • ${pending} queued`:''}`;
}
async function drainTranscriptionQueue(force=false){
 if(state.transcribing){if(force){while(state.transcribing)await new Promise(r=>setTimeout(r,200));return drainTranscriptionQueue(true)}return;}
 if(!navigator.onLine&&!force){updateLongMeetingStatus();return}
 state.transcribing=true;
 try{
  for(const seg of state.segments){
   if(seg.text)continue;
   seg.status='transcribing';updateLongMeetingStatus();
   try{
    const ext=(seg.blob.type||'').includes('mp4')?'m4a':'webm';
    seg.text=await transcribeBlob(seg.blob,`meeting-${String(seg.index).padStart(4,'0')}.${ext}`,{sourceLanguage:$('sourceLanguage')?.value||'auto',contentType:$('recordingType')?.value||'meeting',mediaKind:'audio'});
    seg.status='done';
    const meta=data.draftLive?.segments?.find(x=>x.key===seg.key);if(meta){meta.text=seg.text;meta.status='done';saveQuiet()}
    state.cachedTranscript=state.segments.filter(x=>x.text).sort((a,b)=>a.index-b.index).map(x=>x.text).join('\n');
    await idbDelete(seg.key).catch(()=>{});seg.blob=null;
    updateLongMeetingStatus();
   }catch(e){
    seg.status='saved';console.error('MEETWISE_CHUNK_TRANSCRIBE',seg.index,e);
    if(!force){$('recordStatus').textContent=`Recording is safe • chunk ${seg.index} saved locally • transcription will retry`;clearTimeout(state.retryTimer);state.retryTimer=setTimeout(()=>drainTranscriptionQueue(),15000);break}
    throw e;
   }
  }
 }finally{state.transcribing=false}
}
async function finishRecording(){
 if(!state.recording)return;
 state.shouldRestart=false;state.recording=false;clearTimeout(state.segmentTimer);clearInterval(state.clockTimer);
 const recorder=state.mediaRecorder;if(recorder?.state==='recording')recorder.stop();
 try{await state.finalSegmentPromise}catch{}
 state.mediaStream?.getTracks().forEach(t=>t.stop());
 $('recordStatus').textContent='Recording finished • saved locally • completing any remaining transcription…';$('recIndicator').classList.remove('active');$('finishRecBtn').classList.add('hidden');$('startRecBtn').classList.remove('hidden');$('startRecBtn').textContent='Record again';$('markBtn').disabled=true;
 drainTranscriptionQueue();toast('Long meeting recording saved locally.')
}
function idb(){return new Promise((resolve,reject)=>{const r=indexedDB.open('meetwise_audio_v1',1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('audio'))r.result.createObjectStore('audio')};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function idbPut(k,v){const db=await idb();return new Promise((res,rej)=>{const tx=db.transaction('audio','readwrite');tx.objectStore('audio').put(v,k);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)})}
async function idbDelete(k){const db=await idb();return new Promise((res,rej)=>{const tx=db.transaction('audio','readwrite');tx.objectStore('audio').delete(k);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)})}
async function cleanupLiveAudio(){const keys=state.segments.map(x=>x.key).filter(Boolean);await Promise.all(keys.map(k=>idbDelete(k).catch(()=>{})));data.draftLive=null;saveQuiet()}

async function processMeeting(){
 const lang=$('reportLanguage').value;let contentType=$('recordingType')?.value||'meeting';const sourceLanguage=$('sourceLanguage')?.value||'auto';const detailLevel=$('outputDetailLevel')?.value||'standard';let transcript='',sourceType=state.source,title=$('meetingTitleInput').value.trim();setProcessing(true,'Preparing source…');
 try{
   if(sourceType==='text'){transcript=$('textSource').value.trim();if(!transcript)throw new Error('Paste meeting text first.');}
   else if(sourceType==='file'){
     const f=$('sourceFile').files[0];if(!f)throw new Error('Choose or drop a supported file first.');const kind=classifyFile(f);if(kind==='unknown')throw new Error('Unsupported file type. Use audio, video, PDF, DOCX, XLS/XLSX, PPTX, TXT or CSV.');
     if(['document','spreadsheet','presentation','textdoc'].includes(kind)){
       contentType=kind==='spreadsheet'?'spreadsheet':kind==='presentation'?'presentation':'document';setProcessing(true,'Extracting document content…');transcript=await extractDocument(f);
     }else{
       const maxDirect=25*1024*1024;if(f.size>maxDirect)throw new Error(`This media file is ${(f.size/1024/1024).toFixed(1)} MB. Current preview media upload supports files up to 25 MB.`);if(kind==='video'&&contentType==='meeting')contentType='video';setProcessing(true,kind==='video'?'Transcribing video audio with accuracy mode…':'Transcribing uploaded audio…');transcript=await transcribeBlob(f,f.name,{sourceLanguage,contentType,mediaKind:kind});
     }
   }
   else if(sourceType==='live'){if(state.recording)await finishRecording();if(!state.segments.length)throw new Error('Record the meeting first.');setProcessing(true,'Completing any remaining meeting transcription…');await drainTranscriptionQueue(true);transcript=state.segments.sort((a,b)=>a.index-b.index).map(x=>x.text||'').filter(Boolean).join('\n');state.cachedTranscript=transcript;}
   if(!transcript.trim())throw new Error('No usable text/transcript was produced.');setProcessing(true,lang==='my'?'AI report ဖန်တီးနေသည်…':'Generating AI report…');const result=await generateReport(transcript,lang,title,state.markers,contentType,detailLevel);const meeting=saveMeeting({title:title||result.title||autoTitle(transcript),lang,sourceType,transcript,result,markers:[...state.markers],contentType,detailLevel,sourceLanguage});if(sourceType==='live')await cleanupLiveAudio();setProcessing(false);$('meetingModal').classList.add('hidden');openReport(meeting.id);toast('AI Report created and saved.');
 }catch(e){setProcessing(false);toast(e.message||'Processing failed.')}
}
function setProcessing(on,detail=''){$('processingBox').classList.toggle('hidden',!on);$('processMeetingBtn').disabled=on;$('processingDetail').textContent=detail}
async function transcribeBlob(blob,name,opts={}){const form=new FormData();form.append('file',blob,name);if(data.keys.groq)form.append('apiKey',data.keys.groq);if(opts.sourceLanguage&&opts.sourceLanguage!=='auto')form.append('language',opts.sourceLanguage);if(opts.contentType)form.append('contentType',opts.contentType);if(opts.mediaKind)form.append('mediaKind',opts.mediaKind);const r=await fetch('/api/transcribe',{method:'POST',body:form});const j=await r.json().catch(()=>({}));if(!r.ok){if(j.error==='GROQ_API_KEY_REQUIRED')throw new Error('Groq API key is required in Settings or Vercel.');throw new Error(j.error||'Transcription failed.')}if(j.quality==='poor')throw new Error('Transcript quality is too low to create a reliable report. Try a clearer source or select the correct source language.');return j.text||''}
function reportPrompt(transcript,lang,title,markers,contentType='meeting'){const language=lang==='my'?'Burmese (Myanmar language)':'English';return `You are an AI content analyst.\nContent type: ${contentType}.\nOutput language: ${language}.\n\nBefore writing the report:\n- Identify the real topic.\n- Remove obvious transcription errors.\n- Keep important facts, names and numbers.\n- Do not invent information not present in the transcript.\n\nFor YouTube/Video content focus on topic, explanation, key arguments and conclusion. For meetings focus on decisions, actions and responsibilities.\n\nTitle hint: ${title||'none'}\nMarkers: ${markers.map(fmtTime).join(', ')||'none'}\n\nTRANSCRIPT:\n${transcript}`}
async function generateReport(transcript,lang,title,markers,contentType='meeting',detailLevel=null){const payload=JSON.stringify({transcript,language:lang,title,markers:markers.map(fmtTime),contentType,detailLevel:detailLevel||data.prefs?.detailLevel||'standard',apiKey:data.keys.gemini||''});let r,lastErr=null;for(let attempt=1;attempt<=3;attempt++){try{r=await fetch('/api/report',{method:'POST',headers:{'content-type':'application/json','x-meetwise-client':'1.5.4'},cache:'no-store',body:payload});lastErr=null;break}catch(e){lastErr=e;console.error('MEETWISE_REPORT_FETCH',attempt,e);if(attempt<3)await new Promise(resolve=>setTimeout(resolve,700*attempt));}}if(!r){const detail=lastErr?.message||'network request failed';throw new Error(`REPORT NETWORK ERROR (V1.5.4): ${detail}. The transcript is saved; do not record again.`)}const j=await r.json().catch(()=>({}));if(!r.ok){if(j.error==='GEMINI_API_KEY_REQUIRED')throw new Error('Gemini API key is required in Settings or Vercel.');if(j.code==='GEMINI_REPORT_FAILED')throw new Error('AI report generation failed after retrying. Please try once more.');throw new Error(j.error||`AI report generation failed (HTTP ${r.status}).`)}if(j.report&&typeof j.report==='object')return j.report;let text=j.text||'';text=text.replace(/^```json\s*/i,'').replace(/```$/,'').trim();try{return JSON.parse(text)}catch{throw new Error('AI returned an unreadable report. Please retry.') }}
function autoTitle(t){const words=t.replace(/\s+/g,' ').trim().split(' ').slice(0,7).join(' ');return words?`${words}${t.split(' ').length>7?'…':''}`:'Untitled Meeting'}
function saveMeeting({title,lang,sourceType,transcript,result,markers,contentType='meeting',detailLevel='standard',sourceLanguage='auto'}){const id=uid(),createdAt=Date.now();const meeting={id,title,lang,sourceType,transcript,result,markers,contentType,detailLevel,sourceLanguage,createdAt,updatedAt:createdAt,reportHtml:reportToHtml(result,lang)};data.meetings.unshift(meeting);(result.actions||[]).forEach(a=>data.tasks.unshift({id:uid(),meetingId:id,title:a.action||'',owner:a.owner||'',deadline:a.deadline||'',done:false,createdAt}));save();return meeting}
function reportToHtml(r,lang){const L=lang==='my'?{summary:'အကျဉ်းချုပ်',points:'အဓိက ဆွေးနွေးချက်များ',decisions:'ဆုံးဖြတ်ချက်များ',actions:'လုပ်ဆောင်ရန် အချက်များ',risks:'ပြဿနာ / အန္တရာယ်များ',facts:'အရေးကြီး ကိန်းဂဏန်းနှင့် အချက်အလက်များ',unresolved:'မဖြေရှင်းရသေးသော အချက်များ',next:'နောက်တစ်ဆင့်',moments:'အရေးကြီး မှတ်သားချက်များ',action:'လုပ်ဆောင်ရန်',owner:'တာဝန်ရှိသူ',deadline:'သတ်မှတ်ရက်'}:{summary:'Executive Summary',points:'Key Discussion Points',decisions:'Decisions Made',actions:'Action Items',risks:'Problems / Risks',facts:'Important Numbers & Facts',unresolved:'Unresolved Questions',next:'Next Steps',moments:'Important Marked Moments',action:'Action',owner:'Owner',deadline:'Deadline'};const list=(arr)=>`<ul>${(arr?.length?arr:['—']).map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`;return `<h2>${L.summary}</h2><p>${esc(r.executiveSummary||'—')}</p><h2>${L.points}</h2>${list(r.keyPoints)}<h2>${L.decisions}</h2>${list(r.decisions)}<h2>${L.actions}</h2><table><thead><tr><th>${L.action}</th><th>${L.owner}</th><th>${L.deadline}</th></tr></thead><tbody>${(r.actions?.length?r.actions:[{action:'—',owner:'—',deadline:'—'}]).map(a=>`<tr><td>${esc(a.action)}</td><td>${esc(a.owner)}</td><td>${esc(a.deadline)}</td></tr>`).join('')}</tbody></table><h2>${L.risks}</h2>${list(r.risks)}<h2>${L.facts}</h2>${list(r.facts)}<h2>${L.unresolved}</h2>${list(r.unresolved)}<h2>${L.next}</h2>${list(r.nextSteps)}<h2>${L.moments}</h2>${list(r.importantMoments)}`}

function openReport(id){const m=data.meetings.find(x=>x.id===id);if(!m)return;state.activeReportId=id;$('reportTitle').textContent=m.title;$('reportEditor').innerHTML=m.reportHtml;ensureReportLanguageSwitcher(m);$('reportModal').classList.remove('hidden')}
function ensureReportLanguageSwitcher(m){let wrap=$('reportLangSwitcher');if(!wrap){wrap=document.createElement('div');wrap.id='reportLangSwitcher';wrap.className='segmented';wrap.style.margin='12px 0';wrap.innerHTML='<button type="button" data-report-lang="my">Burmese</button><button type="button" data-report-lang="en">English</button>';const toolbar=$('reportEditor').parentElement;toolbar.insertBefore(wrap,$('reportEditor'));wrap.querySelectorAll('[data-report-lang]').forEach(b=>b.onclick=()=>switchReportLanguage(b.dataset.reportLang));}wrap.querySelectorAll('[data-report-lang]').forEach(b=>b.classList.toggle('active',b.dataset.reportLang===m.lang));}
async function switchReportLanguage(lang){const m=data.meetings.find(x=>x.id===state.activeReportId);if(!m||m.lang===lang)return;try{const wrap=$('reportLangSwitcher');wrap.querySelectorAll('button').forEach(b=>b.disabled=true);toast(lang==='my'?'Generating Burmese from saved meeting…':'Generating English from saved meeting…');const result=await generateReport(m.transcript,lang,m.title,m.markers||[],m.contentType||'meeting',m.detailLevel||'standard');m.lang=lang;m.result=result;m.reportHtml=reportToHtml(result,lang);m.updatedAt=Date.now();save();$('reportEditor').innerHTML=m.reportHtml;ensureReportLanguageSwitcher(m);toast(lang==='my'?'Burmese report ready.':'English report ready.')}catch(e){toast(e.message||'Report language change failed.')}finally{$('reportLangSwitcher')?.querySelectorAll('button').forEach(b=>b.disabled=false)}}
function saveEditedReport(){const m=data.meetings.find(x=>x.id===state.activeReportId);if(!m)return;m.reportHtml=$('reportEditor').innerHTML;m.updatedAt=Date.now();save();toast('Edited report saved.')}
function reportPlain(m){const tmp=document.createElement('div');tmp.innerHTML=m.reportHtml;return `${m.title}\n${fmtDate(m.createdAt)}\n\n${tmp.innerText}`}
function exportTxt(){const m=data.meetings.find(x=>x.id===state.activeReportId);if(m)downloadBlob(`${safeName(m.title)}.txt`,reportPlain(m),'text/plain;charset=utf-8')}
function exportWord(){const m=data.meetings.find(x=>x.id===state.activeReportId);if(!m)return;const html=`<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,'Noto Sans Myanmar',sans-serif;line-height:1.6;margin:40px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:8px}h2{margin-top:24px}</style></head><body><h1>${esc(m.title)}</h1><p>${esc(fmtDate(m.createdAt))}</p>${m.reportHtml}</body></html>`;downloadBlob(`${safeName(m.title)}.doc`,html,'application/msword')}
function safeName(s){return (s||'meeting-report').replace(/[\\/:*?"<>|]/g,'-').slice(0,80)}
function downloadBlob(name,content,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},200)}

function renderAll(){renderMeetings();renderTasks();$('meetingCount')&&($('meetingCount').textContent=data.meetings.length);$('openTaskCount')&&($('openTaskCount').textContent=data.tasks.filter(t=>!t.done).length)}
function renderMeetings(){if(!$('recentMeetings'))return;const row=(m)=>`<article class="meeting-row"><div class="meeting-meta"><h4>${esc(m.title)}</h4><p>${fmtDate(m.createdAt)} · ${m.lang==='my'?'Burmese':'English'} · ${esc(m.sourceType)}</p></div><div class="row-actions"><span class="pill">STANDARD</span><button class="ghost" data-open-report="${m.id}">Open report</button>${state.role==='ADMIN'?`<button class="ghost" data-delete-meeting="${m.id}">Delete</button>`:''}</div></article>`;const q=($('quickSearch')?.value||'').toLowerCase(),q2=($('meetingSearch')?.value||'').toLowerCase();const filter=(term)=>data.meetings.filter(m=>!term||`${m.title} ${m.transcript}`.toLowerCase().includes(term));$('recentMeetings').innerHTML=filter(q).slice(0,data.prefs.recentLimit||20).map(row).join('')||empty('No meetings yet. Start with Live Meeting.');$('allMeetings').innerHTML=filter(q2).map(row).join('')||empty('No matching meetings.');$('reportList').innerHTML=data.meetings.map(row).join('')||empty('Reports will appear here after a meeting is processed.');qsa('[data-open-report]').forEach(b=>b.onclick=()=>openReport(b.dataset.openReport));qsa('[data-delete-meeting]').forEach(b=>b.onclick=()=>deleteMeeting(b.dataset.deleteMeeting))}
function deleteMeeting(id){if(!confirm('Delete this meeting and its linked tasks?'))return;data.meetings=data.meetings.filter(m=>m.id!==id);data.tasks=data.tasks.filter(t=>t.meetingId!==id);save();toast('Meeting deleted.')}
function renderTasks(){if(!$('taskList'))return;const f=$('taskFilter')?.value||'open';let tasks=data.tasks;if(f==='open')tasks=tasks.filter(t=>!t.done);if(f==='done')tasks=tasks.filter(t=>t.done);$('taskList').innerHTML=tasks.map(t=>{const m=data.meetings.find(x=>x.id===t.meetingId);return `<article class="task-row ${t.done?'done':''}"><input class="task-check" type="checkbox" data-task="${t.id}" ${t.done?'checked':''}><div><b>${esc(t.title||'Untitled action')}</b><small>${esc(m?.title||'Meeting')} · Owner: ${esc(t.owner||'Not specified')} · Due: ${esc(t.deadline||'Not specified')}</small></div>${state.role==='ADMIN'?`<button class="ghost" data-delete-task="${t.id}">Delete</button>`:''}</article>`}).join('')||empty('No tasks in this view.');qsa('[data-task]').forEach(c=>c.onchange=()=>{const t=data.tasks.find(x=>x.id===c.dataset.task);if(t){t.done=c.checked;save()}});qsa('[data-delete-task]').forEach(b=>b.onclick=()=>{data.tasks=data.tasks.filter(t=>t.id!==b.dataset.deleteTask);save()})}
function empty(t){return `<div class="panel muted">${esc(t)}</div>`}

boot().catch(e=>{console.error('MEETWISE_BOOT_ERROR',e);const login=$('loginView'),setup=$('setupView');if(login)login.classList.remove('hidden');const t=$('toast');if(t){t.textContent='MEETWISE startup error. Reload once. If it repeats, send a screenshot.';t.classList.add('show')}});
