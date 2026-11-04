const $ = id => document.getElementById(id);
const TASKS = {
  explore_direction: ['我还不知道以后做什么', '说说专业、接触过的领域和当前困惑。例：大一，能源专业，没有项目和实习，不知道做什么。'],
  build_experience: ['我想知道现在可以做什么', '说说当前阶段和做过的事。没有经历也可以，我们可以从一项小任务开始。'],
  find_opportunity: ['我想找实习或工作', '粘贴简历、经历或目标岗位。已有资料会复用，不必重复填写。岗位 JD 可选。'],
  compare_options: ['我在几个选择之间犹豫', '写下正在比较的选项，例如储能和光伏；也可以说说你最在意的条件。']
};
const LABELS = {'education.stage':'年级 / 阶段','education.degree':'学历','education.major':'专业','education.school':'学校','experience.text':'经历原文','skills.self_report':'技能自述','preferences.long_term_goal':'长期目标','preferences.city':'长期城市偏好'};
const SOURCES = {user_form:'本人填写',user_text:'材料中明确提及',document_extract:'文件文字整理',legacy_import:'旧资料导入',ai_inference:'AI 推断'};
const CONFIRMATIONS = {confirmed:'已确认',corrected:'本人已修改',unconfirmed:'待确认整理'};
const NOTICE = 'careerP0Notice', CACHE = 'careerP0DraftCache', LAST = 'careerP0LastIntake';
const state = {csrf:'',guest:null,profile:null,intake:null,campaign:null,campaignSlug:new URLSearchParams(location.search).get('campaign')||'',requestedTask:new URLSearchParams(location.search).get('task'),saving:null,timer:null,busy:false,deleted:false,conflict:false,preview:null,turn:null,submission:null,legacy:[],primary:[],inputSource:'user_text'};
function text(parent,tag,value,className) { const node=document.createElement(tag);node.textContent=value??'';if(className)node.className=className;parent.append(node);return node; }
function status(id,message,isError=false) { $(id).textContent=message||'';$(id).classList.toggle('error',isError); }
function storage(kind,method,key,value) { try { return window[kind][method](key,...(value===undefined?[]:[value])); } catch { return null; } }
function jsonStorage(kind,key) { try { return JSON.parse(storage(kind,'getItem',key)||'null'); } catch { return null; } }
function key() { return crypto.randomUUID(); }
async function api(path,method='GET',body) {
  const response=await fetch('/api'+path,{method,credentials:'same-origin',cache:'no-store',headers:{...(method!=='GET'?{'Content-Type':'application/json'}:{}),...(state.csrf&&method!=='GET'?{'X-CSRF-Token':state.csrf}:{})},...(method!=='GET'?{body:JSON.stringify(body??{})}:{})});
  let payload;try { payload=await response.json(); } catch { throw new Error('服务器返回无法读取的响应，请保留输入后重试。'); }
  if(!response.ok) { const error=new Error(payload.error?.message||'操作未完成，请稍后重试。');error.code=payload.error?.code;error.status=response.status;throw error; }
  if(state.deleted&&path!=='/guest-session') throw new Error('本会话已删除，请重新开始。');
  return payload;
}
function setBusy(busy) { state.busy=busy;['generateBtn','saveBtn','answerBtn','skipBtn','directBtn','reanalyzeBtn','retryTurnBtn','previewBtn','importLegacyBtn','confirmVisibleBtn'].forEach(id=>$(id).disabled=busy);document.querySelectorAll('[data-task]').forEach(button=>button.disabled=busy);renderShareState(); }
function conditions() { return {jd:$('jdInput').value.trim(),options:$('optionsInput').value.trim(),time:$('constraintsInput').value.trim()}; }
function cacheDraft() { if(!state.intake||state.deleted)return;storage('localStorage','setItem',CACHE,JSON.stringify({guest_id:state.guest,intake_id:state.intake.id,input:$('mainInput').value,input_source_type:state.inputSource,conditions:conditions(),saved_at:Date.now()})); }
function clearCache() { storage('localStorage','removeItem',CACHE); }
function isDirty() { return state.intake&&($('mainInput').value.trim()!==state.intake.input||JSON.stringify(conditions())!==JSON.stringify({jd:state.intake.conditions?.jd||'',options:state.intake.conditions?.options||'',time:state.intake.conditions?.time||''})); }
function changed() { if(!state.intake||state.deleted)return;cacheDraft();status('saveStatus','尚未保存到服务器；当前输入仅缓存在此设备。');clearTimeout(state.timer);state.timer=setTimeout(()=>flushDraft().catch(()=>{}),650);renderShareState(); }
async function flushDraft() {
  clearTimeout(state.timer);
  if(state.saving) await state.saving;
  if(!state.intake||state.deleted||!isDirty())return;
  if(state.conflict)throw new Error('资料存在版本冲突。请保留当前文字，重新载入云端版本后合并。');
  state.saving=(async()=>{
    while(isDirty()&&!state.deleted) {
      const id=state.intake.id, input=$('mainInput').value, currentConditions=conditions();
      status('saveStatus','正在保存…');
      try { const saved=await api(`/intakes/${encodeURIComponent(id)}/draft`,'PATCH',{expected_revision:state.intake.input_revision,input,input_source_type:state.inputSource,conditions:currentConditions});if(state.intake?.id!==id||state.deleted)return;state.intake=saved;status('saveStatus','已保存到服务器 · 仅供本人继续');if(!isDirty())clearCache();renderResult(); }
      catch(error) { cacheDraft();status('saveStatus',`保存失败：${error.message} 当前输入仅保存在此设备。`,true);if(error.status===409){state.conflict=true;$('reloadBtn').hidden=false;}throw error; }
    }
  })();
  try { await state.saving; } finally { state.saving=null;renderShareState(); }
}
function fillEditor(intake) { state.intake=intake;state.inputSource=intake.input_source_type||'user_text';state.conflict=false;$('reloadBtn').hidden=true;$('editor').hidden=false;$('taskTitle').textContent=TASKS[intake.task_type]?.[0]||'当前任务';$('taskHelp').textContent=TASKS[intake.task_type]?.[1]||'';$('mainInput').value=intake.input||'';$('mainInput').placeholder=TASKS[intake.task_type]?.[1]||'';$('jdInput').value=intake.conditions?.jd||'';$('optionsInput').value=intake.conditions?.options||'';$('constraintsInput').value=intake.conditions?.time||'';document.querySelectorAll('[data-task]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.task===intake.task_type)));storage('sessionStorage','setItem',LAST,intake.id);status('saveStatus','已保存到服务器 · 仅供本人继续');renderResult();renderProfile(); }
async function loadIntake(id) { if(state.busy)return;try { await flushDraft();setBusy(true);fillEditor(await api(`/intakes/${encodeURIComponent(id)}`));restoreCache(); }catch(error){status('globalStatus',error.message,true);}finally{setBusy(false);} }
function restoreCache() { const cache=jsonStorage('localStorage',CACHE);if(cache?.guest_id===state.guest&&cache.intake_id===state.intake?.id&&Date.now()-cache.saved_at<7*86400000){$('mainInput').value=cache.input||'';state.inputSource=cache.input_source_type||'user_text';for(const [id,path] of [['jdInput','jd'],['optionsInput','options'],['constraintsInput','time']])$(id).value=cache.conditions?.[path]||'';if(isDirty()){status('saveStatus','已恢复此设备中尚未上传的文字，点击“保存我的进度”重试。',true);renderShareState();}} }
async function createTask(taskType) { if(state.busy)return;if(state.intake?.task_type===taskType&&state.intake.campaign_slug===(state.campaignSlug||null)){$('mainInput').focus();return;}try { await flushDraft();setBusy(true);status('globalStatus','');const intake=await api('/intakes','POST',{task_type:taskType,...(state.campaignSlug?{campaign_slug:state.campaignSlug}:{})});fillEditor(intake);await refreshLists();$('mainInput').focus(); }catch(error){status('globalStatus',error.message,true);}finally{setBusy(false);} }
async function refreshProfile() { state.profile=await api('/me/profile');storage('localStorage','setItem','careerP0ProfileRevision',String(state.profile.profile_revision));renderProfile();window.dispatchEvent(new CustomEvent('career-profile-updated',{detail:state.profile})); }
function pendingTurn(){const saved=state.turn||jsonStorage('sessionStorage','careerP0Turn');if(saved?.intake_id===state.intake?.id)return saved;const pending=state.intake?.pending_turn;if(pending?.idempotency_key&&pending.body)return{...pending,intake_id:state.intake.id};return null;}
function renderResult() {
  const intake=state.intake;if(!intake)return;$('pendingCard').hidden=!pendingTurn();$('resultCard').hidden=!intake.result;$('profileCard').hidden=false;if(!intake.result){renderShareState();return;}
  $('modeLabel').textContent=intake.mode==='online_ai'?'AI 建议 · 在线生成':'规则建议 · 未调用在线 AI';
  $('staleWarning').hidden=!intake.result_stale;$('modelWarning').hidden=!intake.error;if(intake.error)$('modelWarning').textContent=(intake.error.message||intake.error.code||'在线分析暂不可用')+' 以下为规则建议，可稍后主动重新分析。';
  const box=$('resultContent');box.replaceChildren();text(box,'p',intake.result.summary||'以下建议基于当前提供的信息。');
  (intake.result.options||[]).forEach(option=>{const item=text(box,'article','','option');text(item,'h3',option.title||'可以尝试的方向');if(option.reason)text(item,'p',option.reason);if(option.unknowns?.length)text(item,'p','尚待了解：'+option.unknowns.join('；'),'muted');if(option.next_action)text(item,'p','下一步：'+option.next_action,'next');});
  if(intake.result.unknowns?.length)text(box,'p','仍未知：'+intake.result.unknowns.join('；'),'muted small');
  for(const conflict of intake.conflicts||[]){text(box,'p',`${LABELS[conflict.field_path]||conflict.field_path}存在差异：你已填写“${conflict.current??'未知'}”，本次材料整理为“${conflict.incoming??'未知'}”。已保留你修正的内容，可在下方资料卡中修改。`,'warning');}
  const question=intake.question;$('questionBox').hidden=!question;if(question){$('questionBudget').textContent=`关键追问 ${intake.question_count||1} / 2`;$('questionTitle').textContent=question.question;$('questionReason').textContent=question.reason||'';$('questionOptions').replaceChildren();(question.options||[]).forEach(option=>{const button=text($('questionOptions'),'button',option,'pill');button.type='button';button.onclick=()=>{$('questionAnswer').value=option;$('questionAnswer').focus();};});}
  renderShareState();
}
function renderShareState() { const intake=state.intake;const noCampaign=!intake?.campaign_slug&&!state.campaign?.slug;const closed=state.campaign&&!state.campaign.open;$('previewBtn').disabled=state.busy||!intake?.result||!!intake?.result_stale||isDirty()||noCampaign||!!closed;$('shareHelp').textContent=noCampaign?'当前为个人使用。通过明确的活动链接进入后，可把该活动任务提交给管理员。':closed?'活动已关闭，无法新增提交；你的个人进度仍可使用。':'保存进度只供本人使用。下一步先预览接收方与共享内容，再明确提交。'; }
async function runTurn(action) {
  if(state.busy||!state.intake)return;
  try {
    await flushDraft();const previous=pendingTurn();const answer=action==='answer'?$('questionAnswer').value.trim():undefined;if(!previous&&action==='answer'&&!answer){status('globalStatus','可以写一句话回答，也可以选择先跳过。',true);return;}
    const request={action,expected_revision:state.intake.input_revision,...(state.intake.question?{question_id:state.intake.question.question_id||state.intake.question.id}:{}),...(answer?{answer}:{})};
    const signature=JSON.stringify({intake_id:state.intake.id,...request});const pending=previous||{signature,idempotency_key:key(),body:request,intake_id:state.intake.id};state.turn=pending;storage('sessionStorage','setItem','careerP0Turn',JSON.stringify(pending));
    setBusy(true);status('globalStatus','正在分析，输入和草稿会保留。');const result=await api(`/intakes/${encodeURIComponent(pending.intake_id)}/turns`,'POST',{...pending.body,idempotency_key:pending.idempotency_key});
    if(result.input_revision>=state.intake.input_revision)state.intake=result;else state.intake=await api(`/intakes/${encodeURIComponent(pending.intake_id)}`);
    state.turn=null;storage('sessionStorage','removeItem','careerP0Turn');$('questionAnswer').value='';await refreshProfile();renderResult();await refreshLists();status('globalStatus','初步结果已生成，可直接查看；资料确认不是前置条件。');
  }catch(error){status('globalStatus',`${error.message} 输入仍保留。可再次点击原操作重试。`,true);if(error.status>=400&&error.status<500&&error.status!==429){state.turn=null;storage('sessionStorage','removeItem','careerP0Turn');}renderResult();}
  finally{setBusy(false);}
}
function renderProfile() {
  if(!state.profile)return;const fields=state.profile.fields||{};const preferred={explore_direction:['education.stage','education.major','experience.text','skills.self_report','preferences.long_term_goal'],build_experience:['education.stage','education.major','experience.text','skills.self_report'],find_opportunity:['education.stage','education.degree','education.major','experience.text','skills.self_report'],compare_options:['education.stage','education.major','experience.text','preferences.long_term_goal','preferences.city']}[state.intake?.task_type]||['education.stage','education.major','experience.text','skills.self_report'];state.primary=preferred;$('profilePrimary').replaceChildren();$('profileOther').replaceChildren();
  for(const path of Object.keys(LABELS)){const field=fields[path]||{value:null,value_state:'unknown',confirmation_state:'unconfirmed',source_refs:[]};const container=state.primary.includes(path)?$('profilePrimary'):$('profileOther');const row=text(container,'div','','profile-row');const meta=text(row,'div','','profile-meta');text(meta,'strong',LABELS[path]);text(meta,'small',(field.value_state==='unknown'?'未知':CONFIRMATIONS[field.confirmation_state]||'待确认整理'));text(row,'p',field.value==null||field.value===''?'尚未提供':field.value,'value');text(row,'small',(SOURCES[field.source_type]||'尚无来源')+(field.source_refs?.length?' · 原文：'+field.source_refs.map(ref=>ref.quote||ref.source_id).join('；'):''));const edit=text(row,'details');text(edit,'summary','修改这一项');const label=text(edit,'label','','field');text(label,'span',LABELS[path]);const input=text(label,'textarea');input.rows=path==='experience.text'?5:2;input.maxLength=path==='experience.text'?20000:2000;input.value=field.value||'';const button=text(edit,'button','保存这一项','secondary');button.type='button';button.onclick=()=>updateFields([{field_path:path,value:input.value.trim()||null}]);}
  $('confirmVisibleBtn').disabled=state.busy||!state.primary.some(path=>fields[path]?.value!=null);
}
async function updateFields(patch) { if(state.busy)return;try{setBusy(true);state.profile=await api('/me/profile','PATCH',{expected_revision:state.profile.profile_revision,patch});storage('localStorage','setItem','careerP0ProfileRevision',String(state.profile.profile_revision));renderProfile();if(state.intake)state.intake=await api(`/intakes/${encodeURIComponent(state.intake.id)}`);renderResult();status('profileStatus','资料已更新，来源信息保留。');}catch(error){status('profileStatus',error.message,true);if(error.status===409)await refreshProfile().catch(()=>{});}finally{setBusy(false);} }
const SNAPSHOT_LABELS={campaign:'接收活动',name:'名称',organizer:'接收管理员 / 组织者',scope:'共享范围',fields:'本次相关资料',profile:'个人资料',input:'本人原始输入',sources:'本次材料片段',text:'原始文字',source_type:'资料来源',source_refs:'来源与原文',confirmation_state:'确认情况',value:'内容',value_state:'是否已提供',quote:'依据原文',result:'分析结果',summary:'本次摘要',options:'建议方向',reason:'依据',unknowns:'待核实信息',next_action:'下一步',mode:'生成模式',provenance:'生成追溯信息',task_type:'本次任务',input_revision:'本次输入版本',based_on_input_revision:'结果使用的输入版本',notice_version:'告知版本',conditions:'本次条件',jd:'岗位 JD',constraints:'城市 / 时间条件',material:'本次材料',materials:'本次材料',profile_fields:'本次相关资料',version:'版本',created_at:'时间'};
export function renderSnapshot(parent,value) {
  if(value==null){text(parent,'p','未知','muted small');return;}
  if(typeof value!=='object'){text(parent,'p',SOURCES[value]||CONFIRMATIONS[value]||TASKS[value]?.[0]||(value==='online_ai'?'在线 AI 建议':value==='rules'?'规则建议':String(value)),'small');return;}
  if(Array.isArray(value)){if(!value.length)text(parent,'p','无','muted small');value.forEach(item=>renderSnapshot(text(parent,'div','','array-item'),item));return;}
  const dl=text(parent,'dl');for(const [name,item]of Object.entries(value)){text(dl,'dt',LABELS[name]||SNAPSHOT_LABELS[name]||name);const dd=text(dl,'dd');if(item&&typeof item==='object')renderSnapshot(text(dd,'div','','object'),item);else dd.textContent=SOURCES[item]||CONFIRMATIONS[item]||TASKS[item]?.[0]||(item==null?'未知':String(item));}
}
async function previewSubmission() { if(state.busy)return;if(jsonStorage('sessionStorage','careerP0Submit')?.attempted){await recoverSubmission();return;}try{await flushDraft();setBusy(true);const preview=await api(`/intakes/${encodeURIComponent(state.intake.id)}/submission-preview`,'POST',{});state.preview=preview;state.submission={preview_id:preview.preview_id,idempotency_key:key()};storage('sessionStorage','setItem','careerP0Submit',JSON.stringify(state.submission));$('previewContent').replaceChildren();renderSnapshot($('previewContent'),preview.payload);status('submitStatus','只有点击确认提交后，管理员才能查看。');$('previewDialog').showModal();}catch(error){status('globalStatus',error.message,true);}finally{setBusy(false);} }
async function recoverSubmission(){const pending=jsonStorage('sessionStorage','careerP0Submit');if(!pending?.attempted)return;try{setBusy(true);const {preview_id,idempotency_key}=pending;const receipt=await api('/submissions','POST',{preview_id,idempotency_key});storage('sessionStorage','removeItem','careerP0Submit');state.submission=null;await refreshLists();status('globalStatus',`已找回上次提交回执 ${receipt.id} · ${receipt.status==='withdrawn'?'已撤回':'已提交'}。`);}catch(error){if(error.status>=400&&error.status<500&&error.status!==429)storage('sessionStorage','removeItem','careerP0Submit');status('globalStatus',error.message+' 可重新检查提交记录，或再次预览。',true);}finally{setBusy(false);}}
async function submitPreview() { if(!state.submission)return;$('submitBtn').disabled=true;status('submitStatus','正在提交…');state.submission.attempted=true;storage('sessionStorage','setItem','careerP0Submit',JSON.stringify(state.submission));try{const {preview_id,idempotency_key}=state.submission;const receipt=await api('/submissions','POST',{preview_id,idempotency_key});state.submission=null;storage('sessionStorage','removeItem','careerP0Submit');$('previewDialog').close();status('globalStatus',`提交成功 · 回执 ${receipt.id} · 版本 ${receipt.version}。后续编辑不会改变此次快照。`);await refreshLists();}catch(error){status('submitStatus',error.message+(error.status===409?' 请返回后重新预览。':' 可点击确认重试，沿用同一提交回执。'),true);}finally{$('submitBtn').disabled=false;} }
async function refreshLists() {
  const [drafts,submissions]=await Promise.all([api('/intakes'),api('/me/submissions')]);
  const list=$('draftList');list.replaceChildren();if(!drafts.items?.length)text(list,'p','还没有任务，先选择上方的一项。','empty');for(const item of drafts.items||[]){const button=text(list,'button',TASKS[item.task_type]?.[0]||item.task_type,'draft-button');button.type='button';text(button,'small',(item.input||'使用已有资料').slice(0,55)+(item.result_stale?' · 建议待更新':''));button.onclick=()=>loadIntake(item.id);}
  const box=$('submissionList');box.replaceChildren();if(jsonStorage('sessionStorage','careerP0Submit')?.attempted){const retry=text(box,'button','查询上次提交回执','secondary');retry.type='button';retry.onclick=recoverSubmission;}if(!submissions.items?.length)text(box,'p','尚无提交记录。','empty');for(const item of submissions.items||[]){const record=text(box,'div','','record');text(record,'strong',item.campaign_name||item.campaign?.name||'收集活动');text(record,'p',`${TASKS[item.task_type]?.[0]||''} · 版本 ${item.version} · ${item.status==='withdrawn'?'已撤回':'已提交'}`);text(record,'p','回执：'+item.id,'muted small');text(record,'p',formatDate(item.created_at),'muted small');if(item.status!=='withdrawn'){const withdraw=text(record,'button','撤回此任务的全部共享版本','link-button');withdraw.type='button';withdraw.onclick=async()=>{if(!confirm('撤回后，管理员将无法查看此任务在该活动中的全部历史正文。个人草稿继续保留。'))return;withdraw.disabled=true;try{await api(`/me/submissions/${encodeURIComponent(item.id)}/withdraw`,'POST',{});await refreshLists();status('globalStatus','已撤回共享，全部历史版本停止对管理员可见。');}catch(error){status('globalStatus',error.message,true);withdraw.disabled=false;}};}}
  return drafts.items||[];
}
function formatDate(value){if(!value)return'';const date=new Date(value);return Number.isNaN(date.getTime())?String(value):date.toLocaleString('zh-CN');}
function legacyRecords() {const records=[];const add=(field_path,value,source_key)=>{if(typeof value==='string'&&value.trim())records.push({field_path,value:value.trim().slice(0,field_path==='experience.text'?20000:2000),source_key});};const core=jsonStorage('localStorage','careerPredictor');if(core&&typeof core==='object'){add('education.major',core.studentProfile?.major,'careerPredictor');const degree={undergraduate:'本科',graduate:'研究生'}[core.studentProfile?.education];add('education.degree',degree,'careerPredictor');add('experience.text',core.experienceText,'careerPredictor');}const prep=jsonStorage('localStorage','careerPredictorPrep');if(prep&&typeof prep==='object'){if(!records.some(item=>item.field_path==='experience.text'))add('experience.text',prep.resume,'careerPredictorPrep');if(prep.confirmed===true)add('preferences.long_term_goal',prep.role,'careerPredictorPrep');}return records;}
function showLegacy() {state.legacy=legacyRecords();$('legacyCard').hidden=!state.legacy.length;$('legacyPreview').replaceChildren();for(const record of state.legacy){const row=text($('legacyPreview'),'div','','profile-row');text(row,'strong',LABELS[record.field_path]);text(row,'p',record.value,'value');text(row,'small','来源：'+record.source_key);const current=state.profile?.fields?.[record.field_path]?.value;if(current!=null&&current!==record.value)text(row,'p','与云端资料不同，将保留云端值：'+current,'warning');}}
async function importLegacy(){if(state.busy)return;try{setBusy(true);const canonical=JSON.stringify(state.legacy);const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical));const importId='legacy-'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');const result=await api('/me/profile/import','POST',{expected_revision:state.profile.profile_revision,import_id:importId,records:state.legacy});state.profile=result.profile||result;await refreshProfile();status('legacyStatus','允许的旧资料已导入，来源标记为旧资料导入。已有云端值和原始本地资料保留。');$('importLegacyBtn').disabled=true;}catch(error){status('legacyStatus',error.message,true);}finally{setBusy(false);}}
async function startSession(explicit=false) {
  $('consentBtn').disabled=true;status('noticeStatus','正在建立个人会话…');
  try{
    const session=await api('/guest-session','POST',{consent:true,notice_version:'p0-v1'});
    state.deleted=false;state.csrf=session.csrf_token;state.guest=session.guest_id;state.profile=session.profile||await api('/me/profile');
    storage('localStorage','setItem',NOTICE,'p0-v1');$('notice').hidden=true;$('workspace').hidden=false;
    $('sessionInfo').textContent=`${session.ai_configured?'已配置在线 AI；生成建议时使用。':'当前使用规则建议，未配置在线 AI。'} 资料按项目配置保存 ${session.retention_days||'规定'} 天；可在“我的提交”中撤回或删除。`;
    renderProfile();showLegacy();const drafts=await refreshLists();const last=storage('sessionStorage','getItem',LAST);
    const requested=TASKS[state.requestedTask]?state.requestedTask:null;
    const matching=item=>item.campaign_slug===(state.campaignSlug||null)&&(!requested||item.task_type===requested);
    const chosen=drafts.find(item=>item.id===last&&matching(item))||drafts.find(matching);
    if(chosen){fillEditor(await api(`/intakes/${encodeURIComponent(chosen.id)}`));restoreCache();}
    else if(requested)await createTask(requested);
    if(explicit)status('globalStatus',chosen||requested?'已进入当前任务，已有资料会自动复用。':'已建立个人进度，请选择当前任务。');
  }catch(error){$('notice').hidden=false;status('noticeStatus',error.message,true);}
  finally{$('consentBtn').disabled=false;}
}
async function loadCampaign(){if(!state.campaignSlug)return;try{state.campaign=await api(`/campaigns/${encodeURIComponent(state.campaignSlug)}/public`);const box=$('campaignBanner');box.replaceChildren();text(box,'strong',state.campaign.name);text(box,'p',state.campaign.description||'本次活动');text(box,'p','接收方：'+(state.campaign.organizer||'活动管理员'));text(box,'p','共享范围：'+state.campaign.scope);if(!state.campaign.open)text(box,'p','活动已关闭：可以继续个人体验，无法新增提交。','error');}catch(error){status('campaignBanner','活动无法读取：'+error.message,true);}}
async function deleteData(){if(!confirm('确认删除本人全部云端资料、任务和提交正文？会话将失效，无法恢复。'))return;try{state.deleted=false;await api('/me/data','DELETE');state.deleted=true;clearTimeout(state.timer);for(const item of [NOTICE,CACHE,'careerP0Profile'])storage('localStorage','removeItem',item);for(const item of [LAST,'careerP0Turn','careerP0Submit'])storage('sessionStorage','removeItem',item);state.csrf='';state.intake=null;state.profile=null;$('workspace').hidden=true;$('notice').hidden=false;status('noticeStatus','本人云端资料已删除，会话已失效。旧本地测评资料未自动上传。');window.dispatchEvent(new CustomEvent('career-profile-updated',{detail:null}));}catch(error){status('globalStatus',error.message,true);}}
async function syncCloud(){
  if(!state.profile||state.deleted||state.busy)return;
  try{
    await refreshProfile();if(!state.intake)return;
    const prior=state.intake,dirty=isDirty(),fresh=await api(`/intakes/${encodeURIComponent(prior.id)}`);
    if(dirty&&fresh.input_revision!==prior.input_revision&&(fresh.input!==prior.input||JSON.stringify(fresh.conditions)!==JSON.stringify(prior.conditions))){state.conflict=true;$('reloadBtn').hidden=false;status('saveStatus','另一处修改了此任务，请保留当前输入后重新载入、合并。',true);return;}
    state.intake=fresh;renderResult();
  }catch(error){status('globalStatus',error.message,true);}
}
document.querySelectorAll('[data-task]').forEach(button=>button.addEventListener('click',()=>createTask(button.dataset.task)));
['mainInput','jdInput','optionsInput','constraintsInput'].forEach(id=>$(id).addEventListener('input',()=>{if(id==='mainInput')state.inputSource='user_text';changed();}));
$('consentBtn').onclick=()=>startSession(true);$('generateBtn').onclick=()=>runTurn('generate');$('answerBtn').onclick=()=>runTurn('answer');$('skipBtn').onclick=()=>runTurn('skip');$('directBtn').onclick=()=>runTurn('direct');$('reanalyzeBtn').onclick=()=>runTurn('reanalyze');$('saveBtn').onclick=()=>flushDraft().catch(error=>status('globalStatus',error.message,true));$('previewBtn').onclick=previewSubmission;$('submitBtn').onclick=submitPreview;$('closePreviewBtn').onclick=()=>$('previewDialog').close();$('deleteDataBtn').onclick=deleteData;$('importLegacyBtn').onclick=importLegacy;$('dismissLegacyBtn').onclick=()=>$('legacyCard').hidden=true;$('leaveUnconfirmedBtn').onclick=()=>status('profileStatus','可以保持待确认状态，继续查看或使用结果。');
$('retryTurnBtn').onclick=()=>runTurn('generate');
$('confirmVisibleBtn').onclick=()=>{const fields=state.profile.fields;updateFields(state.primary.filter(path=>fields[path]?.value!=null).map(path=>({field_path:path,value:fields[path].value,confirm:true})));};
$('reloadBtn').onclick=async()=>{if(!confirm('重新载入将用云端版本替换编辑区。请先复制希望保留的未保存文字，再手动合并。'))return;try{fillEditor(await api(`/intakes/${encodeURIComponent(state.intake.id)}`));clearCache();}catch(error){status('globalStatus',error.message,true);}};
$('useProfileBtn').onclick=()=>{const known=Object.values(state.profile?.fields||{}).some(field=>field.value!=null);status('saveStatus',known?'已保存的统一资料会自动用于本次分析，无需粘贴或重复填写。':'当前还没有已保存资料，也可以从一句话开始。');$('profileCard').hidden=false;$('profileCard').scrollIntoView({behavior:'smooth',block:'nearest'});};
$('documentFile').onchange=async()=>{const file=$('documentFile').files?.[0];if(!file)return;try{status('saveStatus','正在本地提取文件文字…');const {parseDocumentFile}=await import('/journey/documents.js');const document=await parseDocumentFile(file,message=>status('saveStatus',message));if($('mainInput').value.trim()&&!confirm('用文件提取的文字替换当前输入？取消会保留当前输入。'))return;$('mainInput').value=document.text;state.inputSource='document_extract';changed();status('globalStatus','已在本地提取文件文字，请核对后生成建议。');}catch(error){status('saveStatus',error.message,true);}finally{$('documentFile').value='';}};
document.querySelector('.file-label').onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();$('documentFile').click();}};
window.addEventListener('online',()=>{if(state.intake&&isDirty()&&!state.conflict)flushDraft().catch(()=>{});});
window.addEventListener('pagehide',()=>{if(isDirty())cacheDraft();});
window.addEventListener('focus',syncCloud);
window.addEventListener('storage',event=>{if(event.key==='careerP0ProfileRevision')syncCloud();if(event.key===NOTICE&&event.newValue===null&&state.profile){state.deleted=true;clearTimeout(state.timer);state.intake=null;state.profile=null;state.csrf='';$('workspace').hidden=true;$('notice').hidden=false;status('noticeStatus','本人云端资料已在另一页面删除，此页面已停止上传。');}});
await loadCampaign();if(storage('localStorage','getItem',NOTICE)==='p0-v1')await startSession();
