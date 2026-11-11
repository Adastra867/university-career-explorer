import { matchEvidence } from './matching.js';
window.careerMatchEvidence=matchEvidence;
const keys=['careerPredictor','careerPredictorHistory','careerPredictorPrep'];
let user=null,version=0,syncEnabled=false,saveTimer,saving=false,pending=false,conversationId=null,aiBusy=false,loadedMessages=[],beforeMessage=null,pendingChat=null;
const $=id=>document.getElementById(id);
async function api(path,options={}){
 const response=await fetch('/api'+path,{...options,headers:{'Content-Type':'application/json',...(user?{'X-Career-User':user.id}:{}),...options.headers}});
 const body=await response.json();
 if(!response.ok){const e=new Error(body.error||'请求失败');e.status=response.status;e.code=body.code;throw e;}
 return body;
}
const post=(path,data)=>api(path,{method:'POST',body:JSON.stringify(data)});
function notice(text){$('cloud-status').textContent=text;}
function guard(fn){return async(...args)=>{try{return await fn(...args);}catch(error){notice(error.message);if(error.status===401){syncEnabled=false;user=null;renderAuth();}}};}
function readLocal(){
 const current=JSON.parse(localStorage.getItem(keys[0])||'{}');
 const history=JSON.parse(localStorage.getItem(keys[1])||'{}');
 return {version,appData:current,history:Array.isArray(history)?history:history.records||[],prep:JSON.parse(localStorage.getItem(keys[2])||'{}')};
}
function download(name,data){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function clearLocal(){keys.forEach(k=>localStorage.removeItem(k));sessionStorage.removeItem('careerConversation');sessionStorage.removeItem('careerCloudSync');}
function applyWorkspace(data){
 const app=data.appData||{};
 if(typeof normalizeAppData==='function') normalizeAppData(app); // Validate before touching stored data.
 localStorage.setItem(keys[0],JSON.stringify(app));
 localStorage.setItem(keys[1],JSON.stringify({schemaVersion:1,legacyImported:true,records:data.history||[]}));
 localStorage.setItem(keys[2],JSON.stringify(data.prep||{}));
 localStorage.setItem('careerLocalOwner',user.id);
 sessionStorage.setItem('careerCloudSync',user.id);
 sessionStorage.setItem('careerCloudVersion',String(data.version));
 location.reload();
}
async function saveCloud(){
 if(!user||!syncEnabled)return;
 if(saving){pending=true;return;}
 saving=true;
 try{
  const saved=await api('/workspace',{method:'PUT',body:JSON.stringify(readLocal())});version=saved.version;sessionStorage.setItem('careerCloudVersion',String(version));notice('已保存到云端');
 }catch(e){syncEnabled=false;sessionStorage.removeItem('careerCloudSync');notice(e.message+'；本地资料仍保留，请备份后处理。');}
 finally{saving=false;if(pending){pending=false;await saveCloud();}}
}
function changed(){if(syncEnabled){clearTimeout(saveTimer);saveTimer=setTimeout(saveCloud,1000);notice('本地已保存，等待同步…');}}
const style=document.createElement('style');style.textContent=`
#account-open{position:fixed;bottom:18px;left:18px;z-index:45;border:1px solid #c7d2fe;border-radius:24px;padding:10px 16px;background:#fff;color:#4338ca;box-shadow:0 3px 16px #0002;font-size:13px;cursor:pointer}
#account-panel{border:1px solid #ddd;border-radius:16px;max-width:580px;width:calc(100% - 24px);max-height:90vh;overflow:auto;padding:24px;color:#1e293b;background:#fff;font:14px/1.6 system-ui}#account-panel::backdrop{background:#0f172a80}#account-panel h2{font-size:22px;font-weight:700;margin:0 0 12px}#account-panel label{display:block;margin:10px 0}#account-panel input:not([type=checkbox]),#account-panel select{display:block;width:100%;padding:9px;border:1px solid #cbd5e1;border-radius:8px}#account-panel button{border:1px solid #c7d2fe;background:#eef2ff;color:#4338ca;border-radius:8px;padding:8px 12px;margin:5px;cursor:pointer}#account-panel button:disabled{opacity:.5;cursor:wait}#account-panel .account-actions{display:flex;flex-wrap:wrap;gap:4px;margin:12px 0}#account-panel [hidden]{display:none!important}#cloud-status{color:#0f766e;white-space:pre-wrap;margin:12px 0}#cloud-ai-status{font-size:12px;background:#f8fafc;padding:10px;border-radius:8px}.cloud-source{display:block;font-size:11px;color:#4338ca}.cloud-evidence{font-size:12px;border-left:3px solid #14b8a6;padding:8px;margin-top:8px}
`;document.head.append(style);
const host=document.createElement('div');host.innerHTML=`<button id="account-open" type="button">账号与云端</button>
<dialog id="account-panel" aria-labelledby="account-title"><button id="account-close" type="button" style="float:right">关闭</button><h2 id="account-title">账号与云端</h2>
<p>测评可在本地使用。登录后可保存档案、报告和求职练习，使用 AI 经历解析与多轮答疑。</p>
<form id="account-form"><label>邮箱<input id="account-email" type="email" autocomplete="username" maxlength="254" required></label><label>密码（10–128位）<input id="account-password" type="password" autocomplete="current-password" minlength="10" maxlength="128" required></label><div class="account-actions"><button type="submit">登录</button><button id="account-register" type="button">注册并登录</button></div></form>
<section id="account-user" hidden><p id="account-identity"></p><p>首次登录请选择资料来源。上传本地资料将替换云端档案；加载云端将替换本机资料。请先下载备份。</p><div class="account-actions"><button id="cloud-upload">上传本地并开启同步</button><button id="cloud-load">加载云端并开启同步</button><button id="cloud-save">立即保存</button><button id="cloud-export">下载云端完整备份</button><button id="account-logout">退出登录</button><button id="account-delete">删除账号与全部云端资料</button></div>
<h3>AI 会话</h3><div class="account-actions"><select id="cloud-conversations" aria-label="选择会话"></select><button id="cloud-new">新建会话</button><button id="cloud-delete-chat">删除所选会话</button><button id="cloud-older" hidden>加载更早消息</button></div><p>主页面“星轨答疑”使用所选会话。每轮问题与回答保存在数据库；删除会话会同时删除消息。</p>
</section><label><input id="cloud-ai-consent" type="checkbox"> 我同意把主动提交的提问、经历或 JD 发给配置的 AI 服务进行分析。发送前可删除敏感信息；测评问卷不会自动发送。</label><p id="cloud-ai-status">正在检查服务状态…</p>
<div class="account-actions"><button id="local-export">下载本地备份</button><button id="local-import">恢复备份文件</button><input id="local-file" type="file" accept="application/json" hidden></div><p id="cloud-status" role="status" aria-live="polite"></p></dialog>`;document.body.append(host);
$('account-open').onclick=()=>$('account-panel').showModal();$('account-close').onclick=()=>$('account-panel').close();
function renderAuth(){
 $('account-form').hidden=!!user;$('account-user').hidden=!user;
 $('account-open').textContent=user?'账号与云端 · 已登录':'账号与云端';
 if(user)$('account-identity').textContent=user.email;
}
async function authenticated(kind){
 const data=await post('/auth/'+kind,{email:$('account-email').value,password:$('account-password').value});user=data.user;$('account-password').value='';renderAuth();
 version=(await api('/workspace')).version;
 notice('登录成功。请先备份，再选择上传本地资料或加载云端资料。');await listConversations();
}
$('account-form').onsubmit=event=>{event.preventDefault();guard(()=>authenticated('login'))();};
$('account-register').onclick=guard(()=>{if($('account-form').reportValidity())return authenticated('register');});
$('cloud-upload').onclick=guard(async()=>{
 if(!confirm('将当前浏览器档案上传到此账号，替换该账号云端档案并开启自动同步？'))return;
 // Read version from login, not silently refresh it: concurrent edits must surface as conflicts.
 syncEnabled=true;await saveCloud();if(syncEnabled){localStorage.setItem('careerLocalOwner',user.id);sessionStorage.setItem('careerCloudSync',user.id);}
});
$('cloud-load').onclick=guard(async()=>{if(confirm('加载云端将替换本地档案，确定已备份？'))applyWorkspace(await api('/workspace'));});
$('cloud-save').onclick=guard(async()=>{if(!syncEnabled)throw new Error('请先选择资料来源开启同步');await saveCloud();});
$('local-export').onclick=guard(()=>download('职途星轨-本地备份.json',{schemaVersion:1,...readLocal()}));
$('cloud-export').onclick=guard(async()=>download('职途星轨-云端备份.json',await api('/export')));
$('local-import').onclick=()=>$('local-file').click();
$('local-file').onchange=guard(async()=>{
 const file=$('local-file').files[0];if(!file)return;if(file.size>1000000)throw new Error('文件超过1MB');
 const data=JSON.parse(await file.text());
 if(data.schemaVersion!==1||!data.appData||typeof data.appData!=='object'||Array.isArray(data.appData)||!Array.isArray(data.history)||data.history.length>100||!data.prep||typeof data.prep!=='object'||Array.isArray(data.prep)||data.history.some(x=>!x||typeof x.id!=='string'||!x.snapshot))throw new Error('备份格式无效');
 if(!confirm('恢复备份将替换本机资料；不会导入账号和聊天记录。确定继续？'))return;
 syncEnabled=false;sessionStorage.removeItem('careerCloudSync');
 localStorage.setItem(keys[0],JSON.stringify(data.appData));localStorage.setItem(keys[1],JSON.stringify({schemaVersion:1,legacyImported:true,records:data.history}));localStorage.setItem(keys[2],JSON.stringify(data.prep));location.reload();
});
$('account-logout').onclick=guard(async()=>{
 if(!confirm('退出会清除本机测评、历史和练习缓存，请先确认资料已同步或下载备份。继续？'))return;
 clearTimeout(saveTimer);syncEnabled=false;await post('/auth/logout',{});clearLocal();localStorage.removeItem('careerLocalOwner');location.reload();
});
$('account-delete').onclick=guard(async()=>{
 if(!confirm('永久删除账号、测评、报告和所有对话？此操作不可撤销，请先下载云端备份。'))return;
 const password=prompt('请输入当前密码确认删除：');if(!password)return;
 await api('/auth/account',{method:'DELETE',body:JSON.stringify({password})});clearLocal();localStorage.removeItem('careerLocalOwner');location.reload();
});
async function listConversations(){
 const data=await api('/conversations');const select=$('cloud-conversations');select.replaceChildren();
 const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='新对话（首次发送时创建）';select.append(placeholder);
 for(const item of data.conversations){const opt=document.createElement('option');opt.value=item.id;opt.textContent=item.title;select.append(opt);}
 const stored=sessionStorage.getItem('careerConversation');conversationId=data.conversations.some(c=>c.id===stored)?stored:null;select.value=conversationId||'';
 if(conversationId)await loadConversation();
}
function renderMessages(messages,append=false){
 const area=$('chatArea');if(!area)return;if(!append)area.replaceChildren();
 for(const message of messages){const row=document.createElement('div');row.className=message.role==='user'?'flex justify-end':'flex justify-start';const bubble=document.createElement('div');bubble.className=message.role==='user'?'chat-bubble chat-user':'chat-bubble chat-bot';const content=document.createElement('p');content.style.whiteSpace='pre-wrap';content.textContent=message.content;bubble.append(content);
  for(const source of message.metadata?.citations||[]){const link=document.createElement('a');link.className='cloud-source';link.textContent=source.title+' · '+source.source;try{const url=new URL(source.url);if(url.protocol!=='https:')continue;link.href=url.href;}catch{continue;}link.target='_blank';link.rel='noopener noreferrer';bubble.append(link);}
  row.append(bubble);area.append(row);
 }area.scrollTop=area.scrollHeight;
}
async function loadConversation(){
 if(conversationId){const data=await api('/conversations/'+conversationId+'/messages');loadedMessages=data.messages;beforeMessage=data.nextBefore;renderMessages(loadedMessages);}else{loadedMessages=[];beforeMessage=null;renderMessages([]);}
 $('cloud-older').hidden=!beforeMessage;
}
$('cloud-older').onclick=guard(async()=>{
 if(!conversationId||!beforeMessage)return;
 const data=await api('/conversations/'+conversationId+'/messages?before='+encodeURIComponent(beforeMessage));loadedMessages=[...data.messages,...loadedMessages];beforeMessage=data.nextBefore;renderMessages(loadedMessages);$('cloud-older').hidden=!beforeMessage;
});
$('cloud-conversations').onchange=guard(async()=>{conversationId=$('cloud-conversations').value||null;sessionStorage.setItem('careerConversation',conversationId||'');await loadConversation();});
$('cloud-new').onclick=()=>{conversationId=null;sessionStorage.removeItem('careerConversation');$('cloud-conversations').value='';renderMessages([]);notice('新会话将在首次提问时创建');};
$('cloud-delete-chat').onclick=guard(async()=>{if(conversationId&&confirm('永久删除这个会话和全部消息？')){await api('/conversations/'+conversationId,{method:'DELETE'});sessionStorage.removeItem('careerConversation');conversationId=null;await listConversations();renderMessages([]);}});
function requireAI(){
 if(!user||!$('cloud-ai-consent').checked){$('account-panel').showModal();notice(!user?'请先登录，再使用在线 AI':'请先勾选 AI 数据发送同意项');return false;}return true;
}
if(typeof window.sendChat==='function')window.sendChat=async()=>{
 if(aiBusy||!requireAI())return;
 const input=$('chatInput'),content=input.value.trim();if(!content)return;
 aiBusy=true;input.disabled=true;const progress=document.createElement('p');progress.textContent='AI 正在检索资料并回答…';progress.setAttribute('role','status');$('chatArea').append(progress);
 try{
  if(!conversationId){const data=await post('/conversations',{title:content.slice(0,50)});conversationId=data.conversation.id;sessionStorage.setItem('careerConversation',conversationId);await listConversations();}
  if(!pendingChat||pendingChat.content!==content||pendingChat.conversationId!==conversationId)pendingChat={content,conversationId,requestId:crypto.randomUUID()};
  const data=await post('/conversations/'+conversationId+'/messages',{content,consent:true,requestId:pendingChat.requestId});pendingChat=null;input.value='';loadedMessages.push(...data.messages);renderMessages(data.messages,true);
 }catch(error){const node=document.createElement('p');node.textContent=error.message+'；提问已保留，可重试。';$('chatArea').append(node);}
 finally{progress.remove();input.disabled=false;aiBusy=false;}
};
if(typeof window.analyzeExperience==='function')window.analyzeExperience=async()=>{
 if(aiBusy||!requireAI())return;
 const text=$('experienceInput').value.trim();if(text.length<10){alert('请输入至少10字的真实经历');return;}
 aiBusy=true;const result=$('experienceResult');result.textContent='AI 正在提取经历证据…';
 try{
  const data=await post('/extract',{text,consent:true});
  if($('experienceInput').value.trim()!==text){result.textContent='经历已修改，请重新分析';return;}
  const local=extractSkills(text);
  const group=cat=>data.skills.filter(s=>s.category===cat).map(s=>s.name);
  const analysis={...local,keywords:data.skills.map(s=>s.name),skills:group('skill'),tools:group('tool'),domains:group('domain'),starItems:data.starItems,evidence:data.skills,questions:data.questions,metadata:data.metadata};
  appData.experienceText=text;appData.experienceAnalysis=analysis;saveToLocalStorage();renderExperienceResult(analysis);

 }catch(error){result.textContent=error.message;}
 finally{aiBusy=false;}
};
// Matching deliberately remains explainable and deterministic; no model-generated score.
if(typeof window.matchJD==='function')window.matchJD=async()=>{
 const jd=$('jdInput').value.trim();if(!jd){alert('请粘贴目标岗位JD');return;}
 if(aiBusy)return;
 let result;
 if(user&&$('cloud-ai-consent').checked){
  aiBusy=true;$('matchResultContent').textContent='AI 正在核对JD与经历原文…';
  try{
   const data=await post('/match',{jd,text:appData.experienceText||'',consent:true});
   result={source:'manual',matchScore:data.matchScore,totalKeywords:data.requirements.length,matched:data.requirements.filter(x=>x.status==='supported').map(x=>({word:x.requirement,cat:'domain'})),gaps:data.requirements.filter(x=>x.status!=='supported').map(x=>({word:x.requirement,cat:'domain'})),jdKeywords:[],evidenceAnalysis:data};
  }catch(error){$('matchResultContent').textContent=error.message;return;}
  finally{aiBusy=false;}
 }else result=matchEvidence(jd,appData.experienceText,skillKW);
 appData.manualJDText=jd;appData.jdMode='manual';appData.selectedRecommendedJob=null;appData.jdMatchResult=result;saveToLocalStorage();renderJDResult(result);

};
if(typeof window.calculateMatchScore==='function')window.calculateMatchScore=job=>{
 if(!userProfile)return null;
 return matchEvidence(job.title+' '+job.snippet,[...(userProfile.keywords||[]),...(userProfile.skills||[]),...(userProfile.tools||[]),...(userProfile.domains||[])].join(' '),skillKW).matchScore;
};
window.addEventListener('career-data-changed',changed);
window.addEventListener('storage',event=>{if(keys.includes(event.key)&&syncEnabled){syncEnabled=false;sessionStorage.removeItem('careerCloudSync');notice('另一标签页修改了本地资料，已暂停本页同步，请确认后重新选择资料来源');}});
async function init(){
 try{const health=await api('/health');$('cloud-ai-status').textContent=`数据库：${health.database==='ready'?'已连接':'未连接'}；在线 AI：${health.ai?'已配置，实际调用仍需验证':'未配置'}；DeepSeek岗位搜索：${health.search?'已配置':'未配置，可手动粘贴JD'}`;}catch(e){$('cloud-ai-status').textContent=e.message;}
 try{
  user=(await api('/auth/me')).user;renderAuth();version=(await api('/workspace')).version;
  syncEnabled=sessionStorage.getItem('careerCloudSync')===user.id&&localStorage.getItem('careerLocalOwner')===user.id&&sessionStorage.getItem('careerCloudVersion')===String(version);
  notice(syncEnabled?'云端同步已开启':'请备份后选择资料来源以开启云端同步');await listConversations();
 }catch(e){if(e.status!==401)notice(e.message);}
}
await init();
