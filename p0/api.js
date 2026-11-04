import express from 'express';
import QRCode from 'qrcode';
import { emptyProfile, FIELD_PATHS, TASK_TYPES, PROFILE_DEPENDENCIES, aiStatus, analyze as defaultAnalyze } from './analysis.js';
import { openCareerStore, check, failure, digest, id, opaque, stable, passwordMatches } from './store.js';

export const NOTICE_VERSION = 'p0-v1';
const FIELD_SET = new Set(FIELD_PATHS);
const QUESTION_FIELDS = new Set([...FIELD_PATHS,'experience.personal_action','task.compare_options','task.priority','task.target_role','task.constraints']);
const DEPENDENCIES = PROFILE_DEPENDENCIES;
const text = (value, max = 20000, allowEmpty = true) => { check(typeof value === 'string' && value.length <= max && (allowEmpty || value.trim())); return value.trim(); };
const key = value => { check(typeof value === 'string' && /^[\w-]{8,120}$/.test(value), '缺少有效的请求标识。'); return value; };
const parse = value => JSON.parse(value);
const cookie = (req, name) => (req.headers.cookie || '').split(';').map(v => v.trim().split('=')).find(v => v[0] === name)?.[1];

export function createCareerRouter(options = {}) {
  const env = options.env || process.env;
  check(env.NODE_ENV !== 'production' || !!env.CAREER_DB_PATH, '生产环境必须显式设置持久磁盘上的 CAREER_DB_PATH。');
  const store = options.store || openCareerStore(env.CAREER_DB_PATH);
  const router = express.Router(), now = options.now || Date.now, analyze = options.analyze || defaultAnalyze;
  const days = Math.max(1, Math.min(3650, Number(env.CAREER_RETENTION_DAYS) || 90));
  const stamp = () => new Date(now()).toISOString();
  const future = ms => new Date(now() + ms).toISOString();
  const limits = new Map(), activeTurns = new Map();
  const secure = env.NODE_ENV === 'production';
  const ttl = Math.max(1, Number(env.CAREER_SESSION_DAYS) || 30) * 86400000;
  const setCookie = (res, name, token, maxAge) => res.cookie(name, token, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge });
  const clearCookie = (res, name) => res.clearCookie(name, { httpOnly: true, secure, sameSite: 'lax', path: '/' });
  function rate(name, limit, window = 60000) {
    const last = limits.get(name);
    if (!last || last.until <= now()) { limits.set(name, { count: 1, until: now() + window }); return; }
    check(++last.count <= limit, '操作过于频繁，请稍后重试。', 'RATE_LIMITED', 429);
    if (limits.size > 5000) for (const [k,v] of limits) if (v.until <= now()) limits.delete(k);
  }
  function guest(req) {
    const row = store.get('SELECT * FROM guests WHERE token_hash=? AND expires_at>?', digest(cookie(req, 'career_guest') || ''), stamp());
    check(row, '请先确认资料处理说明并建立访客会话。', 'UNAUTHENTICATED', 401); return row;
  }
  function admin(req) {
    const row = store.get('SELECT a.*,s.csrf FROM admin_sessions s JOIN admins a ON a.id=s.admin_id WHERE token_hash=? AND expires_at>?', digest(cookie(req,'career_admin') || ''), stamp());
    check(row, '请先登录管理员账号。', 'UNAUTHENTICATED', 401); return row;
  }
  function csrf(req, identity) { check(req.headers['x-csrf-token'] === identity.csrf, '会话校验失败，请刷新后重试。', 'CSRF_REJECTED', 403); }
  function profile(owner) { return parse(store.get('SELECT data FROM profiles WHERE owner_id=?', owner).data); }
  function intake(owner, intakeId) { const row = store.get('SELECT * FROM intakes WHERE id=? AND owner_id=?', intakeId, owner); check(row, '记录不存在。', 'NOT_FOUND',404); return { row, data: parse(row.data) }; }
  function saveIntake(owner, data) {
    const changed = store.run('UPDATE intakes SET data=?,updated_at=? WHERE id=? AND owner_id=?', JSON.stringify(data), stamp(), data.id, owner).changes;
    check(changed === 1, '会话或记录已失效。', 'NOT_FOUND',404);
    return data;
  }
  function view(data) { return { ...data, result_stale: !!data.result && data.based_on_input_revision !== data.input_revision }; }
  function expected(actual, wanted) { check(Number.isInteger(wanted) && actual === wanted, '资料已发生变化，请重新加载后合并修改。', 'VERSION_CONFLICT',409); }
  function values(p, type) { return Object.fromEntries(DEPENDENCIES[type].map(k => [k, p.fields[k]?.value ?? null])); }
  function saveProfile(owner, next, previous, excludeIntake) {
    store.run('UPDATE profiles SET data=? WHERE owner_id=?', JSON.stringify(next), owner);
    for (const row of store.all('SELECT * FROM intakes WHERE owner_id=?', owner)) {
      if (row.id === excludeIntake) continue;
      if (stable(values(previous, row.task_type)) !== stable(values(next, row.task_type))) {
        const data = parse(row.data); data.input_revision++; saveIntake(owner, data);
      }
    }
  }
  function conditions(raw) {
    if (raw === undefined) return {};
    check(raw && typeof raw === 'object' && !Array.isArray(raw));
    check(Object.keys(raw).every(k => ['jd','options','city','time'].includes(k)));
    return Object.fromEntries(Object.entries(raw).map(([k,v]) => [k, text(v, k === 'jd' ? 12000 : 2000)]));
  }
  function campaign(slug) { const c = store.get('SELECT * FROM campaigns WHERE slug=?', slug); check(c, '活动不存在。','NOT_FOUND',404); return c; }
  function publicCampaign(row) { const a = store.get('SELECT display_name FROM admins WHERE id=?', row.admin_id); return { id:row.id, slug:row.slug, ...parse(row.data), open:!!row.open, organizer:a.display_name }; }
  function receipt(row) { const c=store.get('SELECT data FROM campaigns WHERE id=?',row.campaign_id),i=store.get('SELECT task_type FROM intakes WHERE id=?',row.intake_id); return { id: row.id, intake_id:row.intake_id, campaign_id:row.campaign_id, campaign_name:c?parse(c.data).name:null, task_type:i?.task_type || null, chain_id:row.chain_id, version:row.version, status:row.status, created_at:row.created_at, withdrawn_at:row.withdrawn_at }; }
  function payload(owner, intakeId) {
    const {row,data} = intake(owner,intakeId);
    check(row.campaign_id, '请先从明确的活动链接进入，再预览提交。', 'CAMPAIGN_REQUIRED',409);
    const c = store.get('SELECT * FROM campaigns WHERE id=?', row.campaign_id);
    check(c?.open, '活动已关闭，你的个人进度仍然保留。', 'CAMPAIGN_CLOSED',409);
    check(data.result && data.based_on_input_revision === data.input_revision, '请先生成基于当前资料的结果，再预览提交。', 'RESULT_STALE',409);
    const p = profile(owner);
    const included = Object.fromEntries(DEPENDENCIES[data.task_type].filter(k => p.fields[k]?.value_state !== 'unknown').map(k => [k,p.fields[k]]));
    return { notice_version:NOTICE_VERSION, scope:parse(c.data).scope, campaign:publicCampaign(c), guest_id:owner, intake_id:intakeId, task_type:data.task_type,
      profile:{schema_version:p.schema_version,fields:included}, input:data.input, input_source_type:data.input_source_type || 'user_text', conditions:data.conditions, answers:data.answers,
      result:data.result, input_revision:data.input_revision, based_on_input_revision:data.based_on_input_revision, mode:data.mode, provenance:data.provenance, generated_at:data.generated_at };
  }
  function cleanup() {
    store.transaction(() => {
      store.run('DELETE FROM guests WHERE created_at<?', new Date(now() - days * 86400000).toISOString());
      store.run('DELETE FROM admin_sessions WHERE expires_at<=?', stamp());
      store.run('DELETE FROM previews WHERE expires_at<=?', stamp());
    });
    store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }
  cleanup();
  const cleaner = setInterval(() => { try { cleanup(); } catch { /* Never log document contents or credentials. */ } }, 15*60000); cleaner.unref();
  router.locals = { store, cleanup, close() { clearInterval(cleaner); if (!options.store) store.close(); } };
  router.use(express.json({ limit:'256kb' }));
  router.use((req,res,next) => {
    res.set('Cache-Control','no-store'); res.set('X-Content-Type-Options','nosniff');
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      const allowed = env.CAREER_PUBLIC_URL ? new URL(env.CAREER_PUBLIC_URL).origin : `${req.protocol}://${req.get('host')}`;
      if ((origin && origin !== allowed) || req.headers['sec-fetch-site'] === 'cross-site') return next(failure(403,'ORIGIN_REJECTED','请求来源无效。'));
      if (!req.is('application/json')) return next(failure(415,'JSON_REQUIRED','请使用 JSON 提交。'));
    }
    next();
  });
  router.get('/career/status', (_req,res) => res.json({schema_version:1,notice_version:NOTICE_VERSION,retention_days:days,storage:'sqlite',ai_configured:aiStatus(env).configured}));
  router.post('/guest-session', (req,res) => {
    rate(`guest:${req.ip}`,60);
    let g;
    try { g = guest(req); } catch { /* Establish only after explicit notice consent. */ }
    if (!g) {
      check(req.body?.consent === true && req.body.notice_version === NOTICE_VERSION, '请先阅读并确认资料处理说明。','NOTICE_REQUIRED');
      if(cookie(req,'career_guest')) { clearCookie(res,'career_guest'); throw failure(401,'SESSION_EXPIRED','原会话已失效，请确认说明后重新开始。'); }
      const token = opaque();
      g = {id:id('guest'),token_hash:digest(token),csrf:opaque(),created_at:stamp(),expires_at:future(ttl),notice_version:NOTICE_VERSION};
      store.transaction(() => { store.run('INSERT INTO guests VALUES(?,?,?,?,?,?)',g.id,g.token_hash,g.csrf,g.created_at,g.expires_at,g.notice_version); store.run('INSERT INTO profiles VALUES(?,?)',g.id,JSON.stringify(emptyProfile())); });
      setCookie(res,'career_guest',token,ttl);
    }
    res.json({guest_id:g.id,csrf_token:g.csrf,profile:profile(g.id),retention_days:days,ai_configured:aiStatus(env).configured});
  });
  router.get('/campaigns/:slug/public',(req,res) => res.json(publicCampaign(campaign(req.params.slug))));
  router.get('/me/profile',(req,res) => res.json(profile(guest(req).id)));
  router.patch('/me/profile',(req,res) => {
    const g=guest(req); csrf(req,g);
    const next=store.transaction(() => {
      const p=profile(g.id), previous=structuredClone(p); expected(p.profile_revision,req.body.expected_revision);
      check(Array.isArray(req.body.patch) && req.body.patch.length > 0 && req.body.patch.length <= FIELD_PATHS.length);
      const seen = new Set();
      for (const patch of req.body.patch) {
        check(patch && FIELD_SET.has(patch.field_path) && !seen.has(patch.field_path)); seen.add(patch.field_path);
        check(Object.keys(patch).every(k => ['field_path','value','confirm'].includes(k)));
        const value=patch.value === null ? null : text(patch.value,patch.field_path === 'experience.text' ? 20000 : 2000);
        const old=p.fields[patch.field_path];
        const changed=old.value !== value;
        p.fields[patch.field_path] = changed ? {value,value_state:value === null ? 'unknown':'known',source_type:'user_form',source_refs:[{source_id:id('edit'),quote:value ?? ''}],previous_source_refs:old.source_refs,confirmation_state:'corrected',updated_at:stamp()} : {...old,confirmation_state:patch.confirm === true ? 'confirmed':old.confirmation_state,updated_at:stamp()};
      }
      p.profile_revision++; saveProfile(g.id,p,previous); return p;
    }); res.json(next);
  });
  router.post('/me/profile/import',(req,res) => {
    const g=guest(req); csrf(req,g); const importId=key(req.body.import_id), fingerprint=digest(req.body.records);
    const out=store.transaction(() => {
      const old=store.get('SELECT * FROM imports WHERE owner_id=? AND import_id=?',g.id,importId);
      if (old) { check(old.fingerprint===fingerprint,'相同导入标识不能用于不同内容。','IDEMPOTENCY_CONFLICT',409); return {...profile(g.id),conflicts:[]}; }
      const p=profile(g.id), previous=structuredClone(p), conflicts=[]; expected(p.profile_revision,req.body.expected_revision);
      check(Array.isArray(req.body.records) && req.body.records.length<=20);
      const allowed={careerPredictor:['education.stage','education.degree','education.major','education.school','experience.text'],careerPredictorPrep:['experience.text','preferences.long_term_goal']};
      for (const record of req.body.records) {
        check(record && allowed[record.source_key]?.includes(record.field_path),'旧资料字段不在允许导入范围内。');
        const value=text(record.value,record.field_path==='experience.text'?20000:2000,false), prior=p.fields[record.field_path];
        if (prior.value === value) continue;
        if (prior.value_state==='known') { conflicts.push({field_path:record.field_path,current:prior.value,incoming:value}); continue; }
        p.fields[record.field_path]={value,value_state:'known',source_type:'legacy_import',source_refs:[{source_id:`legacy:${record.source_key}:${digest(value).slice(0,12)}`,quote:value,imported_at:stamp(),source_version:'legacy-v1'}],confirmation_state:'unconfirmed',updated_at:stamp()};
      }
      p.profile_revision++; saveProfile(g.id,p,previous); store.run('INSERT INTO imports VALUES(?,?,?)',g.id,importId,fingerprint); return {...p,conflicts};
    }); res.json(out);
  });
  router.get('/intakes',(req,res) => {const g=guest(req); res.json({items:store.all('SELECT data FROM intakes WHERE owner_id=? ORDER BY updated_at DESC',g.id).map(r=>view(parse(r.data)))});});
  router.post('/intakes',(req,res) => {
    const g=guest(req); csrf(req,g); check(TASK_TYPES.includes(req.body.task_type),'请选择有效任务。');
    const c=req.body.campaign_slug ? campaign(text(req.body.campaign_slug,80,false)) : null;
    check(req.body.input_source_type===undefined || ['user_text','document_extract'].includes(req.body.input_source_type));
    const data={id:id('intake'),task_type:req.body.task_type,campaign_slug:c?.slug || null,input:text(req.body.input || ''),input_source_type:req.body.input_source_type || 'user_text',conditions:conditions(req.body.conditions),input_revision:0,result:null,based_on_input_revision:null,question:null,question_count:0,asked_fields:[],skipped_fields:[],answers:[],sources:[],mode:null,provenance:null,created_at:stamp()};
    store.run('INSERT INTO intakes VALUES(?,?,?,?,?,?)',data.id,g.id,c?.id || null,data.task_type,JSON.stringify(data),stamp()); res.status(201).json(view(data));
  });
  router.get('/intakes/:id',(req,res) => {
    const g=guest(req),data=intake(g.id,req.params.id).data;
    const pending=store.get('SELECT idempotency_key,prepared_data FROM turn_requests WHERE owner_id=? AND intake_id=? AND response IS NULL',g.id,data.id);
    const request=pending?.prepared_data?parse(pending.prepared_data)._request:null;
    res.json({...view(data),pending_turn:request?{idempotency_key:pending.idempotency_key,body:request}:null});
  });
  router.patch('/intakes/:id/draft',(req,res) => {
    const g=guest(req); csrf(req,g);
    const data=store.transaction(() => { const {data}=intake(g.id,req.params.id); expected(data.input_revision,req.body.expected_revision); const input=text(req.body.input), cond=req.body.conditions===undefined?data.conditions:conditions(req.body.conditions); check(req.body.input_source_type===undefined || ['user_text','document_extract'].includes(req.body.input_source_type)); if(input!==data.input || stable(cond)!==stable(data.conditions)){data.input=input;data.conditions=cond;data.input_revision++;} if(req.body.input_source_type)data.input_source_type=req.body.input_source_type; return saveIntake(g.id,data); });
    res.json(view(data));
  });
  router.post('/intakes/:id/turns', async (req,res) => {
    const g=guest(req); csrf(req,g); const requestKey=key(req.body.idempotency_key), fp=digest({intake_id:req.params.id,...req.body});
    const action=req.body.action; check(['generate','answer','skip','direct','reanalyze'].includes(action));
    let prior=store.get('SELECT * FROM turn_requests WHERE owner_id=? AND idempotency_key=?',g.id,requestKey), resume;
    if (prior) {
      check(prior.fingerprint===fp,'相同请求标识不能用于不同操作。','IDEMPOTENCY_CONFLICT',409);
      if(prior.response) return res.json(parse(prior.response));
      const running=activeTurns.get(`${g.id}:${requestKey}`);
      if (running) return res.json(await running);
      // Recover the post-answer snapshot, without applying the answer or budget twice.
      check(prior.prepared_data,'分析中断，请重新加载后主动重新分析。','ANALYSIS_INTERRUPTED',409);
      resume=parse(prior.prepared_data);delete resume._request;intake(g.id,prior.intake_id);
    }
    rate(`ai:${g.id}`,Number(env.CAREER_AI_REQUESTS_PER_MINUTE)||12);
    const before=resume || store.transaction(() => {
      const {data}=intake(g.id,req.params.id); expected(data.input_revision,req.body.expected_revision);
      check(!store.get('SELECT 1 FROM turn_requests WHERE owner_id=? AND intake_id=? AND response IS NULL',g.id,req.params.id),'本任务正在分析，请稍候。','ANALYSIS_PENDING',409);
      if(['answer','skip'].includes(action)) check(data.question && data.question.question_id===req.body.question_id,'问题已变化，请重新加载。','QUESTION_CONFLICT',409);
      if(action==='answer') {
        const answer=text(req.body.answer,4000,false), field=data.question.field_path;
        data.answers.push({question_id:data.question.question_id,field_path:field,question:data.question.question,answer}); data.input_revision++;
      }
      if(action==='skip') data.skipped_fields=[...new Set([...data.skipped_fields,data.question.field_path])];
      if(['skip','direct'].includes(action)) data.finished_questions=true;
      if(data.result && !data.question && !['reanalyze','direct'].includes(action)) data.finished_questions=true;
      data.question=null;
      saveIntake(g.id,data);
      store.run('INSERT INTO turn_requests(owner_id,idempotency_key,intake_id,fingerprint,response,created_at,prepared_data) VALUES(?,?,?,?,?,?,?)',g.id,requestKey,data.id,fp,null,stamp(),JSON.stringify({...data,_request:req.body}));
      return structuredClone(data);
    });
    const work=(async () => {
      try {
        const inputSource={id:`${before.id}:input:${before.input_revision}`,text:before.input,source_type:before.input_source_type || 'user_text'};
        const sources=[inputSource,...before.answers.map(a=>({id:a.question_id,text:a.answer,source_type:'user_text',field_path:a.field_path}))];
        const p=profile(g.id), usedValues=values(p,before.task_type);
        const analysis=await analyze({...before,sources,profile:p,force_result:!!before.finished_questions || before.question_count>=2}, {env});
        return store.transaction(() => {
          check(store.get('SELECT 1 FROM guests WHERE id=? AND expires_at>?',g.id,stamp()),'会话已失效。','UNAUTHENTICATED',401);
          const {data}=intake(g.id,before.id);
          if(data.input_revision!==before.input_revision || stable(values(profile(g.id),data.task_type))!==stable(usedValues)) {
            const response={...view(data),error:{code:'STALE_ANALYSIS',message:'分析期间资料已改变，请重新分析。'}};
            store.run('UPDATE turn_requests SET response=? WHERE owner_id=? AND idempotency_key=?',JSON.stringify(response),g.id,requestKey); return response;
          }
          const current=profile(g.id), previous=structuredClone(current); let changed=false; data.conflicts=[];
          for(const patch of analysis.profile_patch || []) {
            if(!FIELD_SET.has(patch.field_path) || patch.claim_type!=='explicit') continue;
            const source=sources.find(s=>s.id===patch.source_id);
            if(!source || typeof patch.evidence_quote!=='string' || !patch.evidence_quote.trim() || !source.text.includes(patch.evidence_quote) || typeof patch.value!=='string') continue;
            const old=current.fields[patch.field_path];
            if(old.value===patch.value) continue;
            if(['confirmed','corrected'].includes(old.confirmation_state)) {data.conflicts.push({field_path:patch.field_path,current:old.value,incoming:patch.value});continue;}
            current.fields[patch.field_path]={value:patch.value,value_state:'known',source_type:source.source_type,source_refs:[{source_id:source.id,quote:patch.evidence_quote}],confirmation_state:'unconfirmed',updated_at:stamp()}; changed=true;
          }
          if(changed){current.profile_revision++;saveProfile(g.id,current,previous,data.id);}
          data.result=analysis.result; data.based_on_input_revision=data.input_revision; data.mode=analysis.mode; data.provenance=analysis.provenance;data.generated_at=stamp();data.error=analysis.error || null;
          data.used_profile_values=values(current,data.task_type);
          const q=analysis.next_question;
          if(q && QUESTION_FIELDS.has(q.field_path) && !data.finished_questions && data.question_count<2 && !data.asked_fields.includes(q.field_path) && !data.skipped_fields.includes(q.field_path) && current.fields[q.field_path]?.value_state!=='known') {
            data.question={...q,question_id:id('question'),allow_skip:true}; data.question_count++;data.asked_fields.push(q.field_path);
          }
          if(!data.question) data.finished_questions=true;
          const response=view(saveIntake(g.id,data));
          store.run('UPDATE turn_requests SET response=? WHERE owner_id=? AND idempotency_key=?',JSON.stringify(response),g.id,requestKey); return response;
        });
      } catch(error) {
        // Deletion/session expiry prevents every late result from recreating data.
        // Leave a durable prepared snapshot for a same-key retry, unless deletion
        // has already removed it by cascade. Do not replay a persisted answer.
        throw error;
      }
    })();
    activeTurns.set(`${g.id}:${requestKey}`,work);
    try {res.json(await work);} finally {activeTurns.delete(`${g.id}:${requestKey}`);}
  });
  router.post('/intakes/:id/submission-preview',(req,res) => {
    const g=guest(req);csrf(req,g);const data=payload(g.id,req.params.id),previewId=id('preview'),expires=future(15*60000);
    store.run('INSERT INTO previews VALUES(?,?,?,?,?,?)',previewId,g.id,req.params.id,JSON.stringify(data),digest(data),expires);res.json({preview_id:previewId,payload:data,expires_at:expires});
  });
  router.post('/submissions',(req,res) => {
    const g=guest(req);csrf(req,g);const requestKey=key(req.body.idempotency_key),previewId=text(req.body.preview_id,100,false),fp=digest({preview_id:previewId});
    const row=store.transaction(() => {
      const prior=store.get('SELECT * FROM submissions WHERE owner_id=? AND idempotency_key=?',g.id,requestKey);
      if(prior){check(prior.request_fingerprint===fp,'相同提交标识不能用于不同内容。','IDEMPOTENCY_CONFLICT',409);return prior;}
      const preview=store.get('SELECT * FROM previews WHERE id=? AND owner_id=?',previewId,g.id);
      check(preview && preview.expires_at>stamp(),'预览已失效，请重新预览。','PREVIEW_EXPIRED',409);
      const fresh=payload(g.id,preview.intake_id);
      check(digest(fresh)===preview.fingerprint,'共享内容已发生变化，请重新预览。','PREVIEW_CONFLICT',409);
      const priorVersion=store.get('SELECT * FROM submissions WHERE owner_id=? AND intake_id=? AND campaign_id=? ORDER BY version DESC LIMIT 1',g.id,preview.intake_id,fresh.campaign.id);
      const newId=id('submission'),chain=priorVersion && priorVersion.status==='submitted'?priorVersion.chain_id:id('chain');
      store.run('INSERT INTO submissions(id,owner_id,intake_id,campaign_id,chain_id,version,previous_id,status,snapshot,created_at,idempotency_key,request_fingerprint) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',newId,g.id,preview.intake_id,fresh.campaign.id,chain,(priorVersion?.version || 0)+1,priorVersion?.id || null,'submitted',preview.payload,stamp(),requestKey,fp);
      return store.get('SELECT * FROM submissions WHERE id=?',newId);
    });res.status(201).json(receipt(row));
  });
  router.get('/me/submissions',(req,res)=>{const g=guest(req);res.json({items:store.all('SELECT * FROM submissions WHERE owner_id=? ORDER BY created_at DESC,version DESC',g.id).map(receipt)});});
  router.post('/me/submissions/:id/withdraw',(req,res)=>{
    const g=guest(req);csrf(req,g);
    const out=store.transaction(()=>{const row=store.get('SELECT * FROM submissions WHERE id=? AND owner_id=?',req.params.id,g.id);check(row,'记录不存在。','NOT_FOUND',404);store.run("UPDATE submissions SET status='withdrawn',snapshot=NULL,withdrawn_at=? WHERE owner_id=? AND chain_id=?",stamp(),g.id,row.chain_id);return store.get('SELECT * FROM submissions WHERE id=?',row.id);});
    store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');res.json(receipt(out));
  });
  router.delete('/me/data',(req,res)=>{const g=guest(req);csrf(req,g);store.transaction(()=>store.run('DELETE FROM guests WHERE id=?',g.id));store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');clearCookie(res,'career_guest');res.json({deleted:true});});

  router.post('/admin/login',(req,res)=>{
    rate(`login:${req.ip}`,8,15*60000);const username=text(req.body.username,80,false);check(typeof req.body.password==='string' && req.body.password.length>0 && req.body.password.length<=200);const password=req.body.password;
    const a=store.get('SELECT * FROM admins WHERE username=?',username);
    const valid=passwordMatches(password,a?.password_hash || '00000000000000000000000000000000:00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000');
    check(a && valid,'账号或密码不正确。','INVALID_CREDENTIALS',401);
    const token=opaque(),csrfToken=opaque();store.run('INSERT INTO admin_sessions VALUES(?,?,?,?)',digest(token),a.id,csrfToken,future(8*3600000));setCookie(res,'career_admin',token,8*3600000);res.json({username:a.username,csrf_token:csrfToken});
  });
  router.get('/admin/session',(req,res)=>{const a=admin(req);res.json({username:a.username,csrf_token:a.csrf});});
  router.post('/admin/logout',(req,res)=>{const a=admin(req);csrf(req,a);store.run('DELETE FROM admin_sessions WHERE token_hash=?',digest(cookie(req,'career_admin')||''));clearCookie(res,'career_admin');res.json({logged_out:true});});
  router.get('/admin/campaigns',(req,res)=>{const a=admin(req);res.json({items:store.all('SELECT * FROM campaigns WHERE admin_id=? ORDER BY created_at DESC',a.id).map(publicCampaign)});});
  router.get('/admin/campaigns/:id/qr.svg',async(req,res)=>{
    const a=admin(req),c=store.get('SELECT * FROM campaigns WHERE id=? AND admin_id=?',req.params.id,a.id);check(c,'活动不存在。','NOT_FOUND',404);
    const base=env.CAREER_PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    const url=new URL('/start',base);url.searchParams.set('campaign',c.slug);
    res.type('image/svg+xml').send(await QRCode.toString(url.href,{type:'svg',width:240,margin:2}));
  });
  router.post('/admin/campaigns',(req,res)=>{
    const a=admin(req);csrf(req,a);const data={name:text(req.body.name,120,false),description:text(req.body.description || '',1000),scope:text(req.body.scope || '当前任务相关资料、原始输入及分析结果',1000,false)};
    const campaignId=id('campaign'),slug=opaque().slice(0,16);store.run('INSERT INTO campaigns VALUES(?,?,?,?,?,?)',campaignId,a.id,slug,1,JSON.stringify(data),stamp());res.status(201).json(publicCampaign(campaign(slug)));
  });
  router.patch('/admin/campaigns/:id',(req,res)=>{
    const a=admin(req);csrf(req,a);const c=store.get('SELECT * FROM campaigns WHERE id=? AND admin_id=?',req.params.id,a.id);check(c,'活动不存在。','NOT_FOUND',404);
    check(Object.keys(req.body).every(k=>['open','name','description','scope'].includes(k)));
    const data=parse(c.data);for(const field of ['name','description','scope']) if(req.body[field]!==undefined)data[field]=text(req.body[field],field==='name'?120:1000,field==='description');
    if(req.body.open!==undefined)check(typeof req.body.open==='boolean');
    store.run('UPDATE campaigns SET open=?,data=? WHERE id=?',req.body.open===undefined?c.open:Number(req.body.open),JSON.stringify(data),c.id);res.json(publicCampaign(campaign(c.slug)));
  });
  router.get('/admin/submissions',(req,res)=>{
    const a=admin(req), page=Math.max(1,Math.floor(Number(req.query.page)||1)), size=20;
    const rows=store.all('SELECT s.*,c.data campaign_data FROM submissions s JOIN campaigns c ON c.id=s.campaign_id WHERE c.admin_id=? ORDER BY s.created_at DESC,s.version DESC',a.id);
    const latest=new Map();for(const row of rows){const chainKey=`${row.owner_id}:${row.intake_id}:${row.campaign_id}`;if(!latest.has(chainKey))latest.set(chainKey,row);}
    const filtered=[...latest.values()].filter(row=>{
      const snap=row.snapshot?parse(row.snapshot):null;
      return (!req.query.campaign || row.campaign_id===req.query.campaign) && (!req.query.task_type || snap?.task_type===req.query.task_type) && (!req.query.stage || (snap?.profile.fields['education.stage']?.value || 'unknown')===req.query.stage) && (!req.query.major || (snap?.profile.fields['education.major']?.value || 'unknown').includes(req.query.major)) && (!req.query.from || row.created_at>=req.query.from) && (!req.query.to || row.created_at<=`${req.query.to}T23:59:59.999Z`);
    });
    const items=filtered.slice((page-1)*size,page*size).map(row=>{const s=row.snapshot?parse(row.snapshot):null;return {...receipt(row),guest_id:row.owner_id,campaign_name:parse(row.campaign_data).name,task_type:s?.task_type || null,stage:s?.profile.fields['education.stage']?.value || null,major:s?.profile.fields['education.major']?.value || null,summary:s?.result.summary || null,confirmation:s?Object.fromEntries(Object.entries(s.profile.fields).map(([k,v])=>[k,v.confirmation_state])):null};});
    res.json({items,total:filtered.length,page,page_size:size});
  });
  router.get('/admin/submissions/:id',(req,res)=>{
    const a=admin(req);const row=store.get('SELECT s.* FROM submissions s JOIN campaigns c ON c.id=s.campaign_id WHERE s.id=? AND c.admin_id=?',req.params.id,a.id);check(row,'记录不存在。','NOT_FOUND',404);
    if(row.status!=='submitted')return res.json({...receipt(row),snapshot:null,history:[]});
    const history=store.all("SELECT * FROM submissions WHERE owner_id=? AND chain_id=? AND status='submitted' ORDER BY version DESC",row.owner_id,row.chain_id).map(receipt);
    res.json({...receipt(row),snapshot:parse(row.snapshot),history});
  });
  router.use((error,_req,res,_next)=>{
    const databaseError=String(error?.code || '').startsWith('SQLITE') || /database|sqlite/i.test(error?.message || '');
    const status=error.status || (databaseError?503:500);
    res.status(status).json({error:{code:error.code && !databaseError?error.code:databaseError?'DATABASE_UNAVAILABLE':'INTERNAL_ERROR',message:status<500 && error.message?error.message:databaseError?'资料存储暂不可用，输入仍保留在页面，请稍后重试。':'服务暂不可用，请保留输入后重试。'}});
  });
  return router;
}
