import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createCareerRouter } from '../p0/api.js';
import { openCareerStore, passwordHash } from '../p0/store.js';

const uuid=()=>randomUUID();
const advice=async input=>({profile_patch:[],result:{summary:'按当前阶段先做一次真实体验。',options:[{title:'探索实验工作',reason:'先核实实际任务',unknowns:['具体职责未知'],next_action:'阅读一份公开JD'}]},next_question:null,mode:'rules',provenance:{rule_version:'fixture-v1'}});
async function setup(t,options={}) {
  const directory=mkdtempSync(join(tmpdir(),'career-p0-')),path=join(directory,'test.sqlite');
  const store=openCareerStore(path);
  store.run('INSERT INTO admins VALUES(?,?,?,?)','admin_a','organizer',passwordHash('fixture-password-123'),'测试组织者');
  store.run('INSERT INTO admins VALUES(?,?,?,?)','admin_b','other',passwordHash('fixture-password-456'),'另一组织者');
  const router=createCareerRouter({store,env:{},analyze:advice,...options}),app=express();app.use('/api',router);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));router.locals.close();store.close();rmSync(directory,{recursive:true,force:true});});
  function client() {
    const jar=new Map();let csrf;
    return {async call(method,url,body,headers={}) {
      const r=await fetch(`${origin}/api${url}`,{method,headers:{'Content-Type':'application/json',Cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),...(csrf?{'X-CSRF-Token':csrf}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
      for(const c of r.headers.getSetCookie()){const pair=c.split(';')[0],at=pair.indexOf('=');jar.set(pair.slice(0,at),pair.slice(at+1));}
      const type=r.headers.get('content-type')||'';const value=type.includes('json')?await r.json():await r.text();if(value?.csrf_token)csrf=value.csrf_token;
      return {status:r.status,body:value,headers:r.headers};
    }};
  }
  const a=client(),b=client(),admin=client(),other=client();
  await a.call('POST','/guest-session',{consent:true,notice_version:'p0-v1'});await b.call('POST','/guest-session',{consent:true,notice_version:'p0-v1'});
  await admin.call('POST','/admin/login',{username:'organizer',password:'fixture-password-123'});
  await other.call('POST','/admin/login',{username:'other',password:'fixture-password-456'});
  const campaign=(await admin.call('POST','/admin/campaigns',{name:'虚构测试活动',description:'仅测试',scope:'当前任务输入、相关资料与结果'})).body;
  async function intake(c=a,extra={}) {return (await c.call('POST','/intakes',{task_type:'explore_direction',campaign_slug:campaign.slug,input:'大一，能源专业，没有项目和实习，不知道做什么',...extra})).body;}
  async function generate(c,data,extra={}) {return (await c.call('POST',`/intakes/${data.id}/turns`,{idempotency_key:uuid(),expected_revision:data.input_revision,action:'generate',...extra})).body;}
  async function preview(c,data) {return (await c.call('POST',`/intakes/${data.id}/submission-preview`,{})).body;}
  async function submit(c,p,key=uuid()) {return c.call('POST','/submissions',{preview_id:p.preview_id,idempotency_key:key});}
  return {a,b,admin,other,campaign,intake,generate,preview,submit,store,path,router,client};
}

test('direct API: consent, owner isolation, CSRF, admin boundaries and private drafts',async t=>{
  const s=await setup(t),anonymous=s.client();
  assert.equal((await anonymous.call('POST','/guest-session',{})).status,400);
  assert.equal((await anonymous.call('GET','/me/profile')).status,401);
  const i=await s.intake();
  for(const [method,path,body] of [['GET',`/intakes/${i.id}`],['PATCH',`/intakes/${i.id}/draft`,{expected_revision:0,input:'窃改'}],['POST',`/intakes/${i.id}/submission-preview`,{}]]) assert.equal((await s.b.call(method,path,body)).status,404);
  assert.equal((await s.a.call('PATCH',`/intakes/${i.id}/draft`,{expected_revision:0,input:'x'},{'X-CSRF-Token':'wrong'})).status,403);
  assert.equal((await s.a.call('PATCH',`/intakes/${i.id}/draft`,{expected_revision:0,input:'x'},{Origin:'https://evil.invalid'})).status,403);
  assert.equal((await s.admin.call('GET','/admin/submissions')).body.total,0);
  assert.equal((await s.admin.call('GET',`/admin/submissions/${i.id}`)).status,404);
  assert.equal((await s.a.call('GET','/admin/submissions')).status,401);
  const done=await s.generate(s.a,i),p=await s.preview(s.a,done),submitted=await s.submit(s.a,p);
  assert.equal(submitted.status,201);
  assert.equal((await s.b.call('POST',`/me/submissions/${submitted.body.id}/withdraw`,{})).status,404);
  assert.equal((await s.other.call('GET',`/admin/submissions/${submitted.body.id}`)).status,404);
  assert.equal((await s.other.call('PATCH',`/admin/campaigns/${s.campaign.id}`,{open:false})).status,404);
  const publicData=(await s.b.call('GET',`/campaigns/${s.campaign.slug}/public`)).body;
  assert.equal(publicData.name,s.campaign.name);assert.equal('submissions' in publicData,false);assert.equal('owner_id' in publicData,false);
  const qr=await s.admin.call('GET',`/admin/campaigns/${s.campaign.id}/qr.svg`);assert.equal(qr.status,200);assert.match(qr.body,/<svg/);
  assert.equal((await s.other.call('GET',`/admin/campaigns/${s.campaign.id}/qr.svg`)).status,404);
});

test('preview binds confirmation metadata; confirmation is field-specific; stale results cannot be submitted',async t=>{
  const s=await setup(t);
  let p=(await s.a.call('GET','/me/profile')).body;
  p=(await s.a.call('PATCH','/me/profile',{expected_revision:p.profile_revision,patch:[{field_path:'education.stage',value:'大一'},{field_path:'education.major',value:'能源专业'}]})).body;
  const i=await s.generate(s.a,await s.intake()),preview=await s.preview(s.a,i);
  const updated=(await s.a.call('PATCH','/me/profile',{expected_revision:p.profile_revision,patch:[{field_path:'education.stage',value:'大一',confirm:true}]})).body;
  assert.equal(updated.fields['education.stage'].confirmation_state,'confirmed');assert.equal(updated.fields['education.major'].confirmation_state,'corrected');
  assert.equal(updated.fields['education.stage'].source_type,'user_form');
  assert.equal((await s.submit(s.a,preview)).body.error.code,'PREVIEW_CONFLICT');
  const still=(await s.a.call('GET',`/intakes/${i.id}`)).body;assert.equal(still.result_stale,false);
  await s.a.call('PATCH','/me/profile',{expected_revision:updated.profile_revision,patch:[{field_path:'education.major',value:'数学'}]});
  assert.equal((await s.a.call('GET',`/intakes/${i.id}`)).body.result_stale,true);
  assert.equal((await s.a.call('POST',`/intakes/${i.id}/submission-preview`,{})).body.error.code,'RESULT_STALE');
  assert.equal((await s.a.call('PATCH','/me/profile',{expected_revision:0,patch:[{field_path:'education.major',value:'x'}]})).status,409);
  assert.equal((await s.a.call('PATCH','/me/profile',{expected_revision:3,patch:[{field_path:'admin',value:'true'}]})).status,400);
});

test('immutable snapshots, durable SQLite and idempotent receipt after closure/draft edits',async t=>{
  const s=await setup(t),i=await s.generate(s.a,await s.intake()),p=await s.preview(s.a,i),k=uuid();
  const first=await s.submit(s.a,p,k);assert.equal(first.status,201);
  await s.a.call('PATCH',`/intakes/${i.id}/draft`,{expected_revision:i.input_revision,input:'新输入'});
  await s.admin.call('PATCH',`/admin/campaigns/${s.campaign.id}`,{open:false});
  const retry=await s.submit(s.a,p,k);assert.equal(retry.body.id,first.body.id);assert.equal((await s.admin.call('GET','/admin/submissions')).body.total,1);
  assert.equal((await s.submit(s.a,{preview_id:'preview_different'},k)).status,409);
  const snapshot=(await s.admin.call('GET',`/admin/submissions/${first.body.id}`)).body.snapshot;assert.equal(snapshot.input,i.input);
  const reopened=openCareerStore(s.path);assert.equal(reopened.get('SELECT count(*) n FROM submissions').n,1);assert.equal(JSON.parse(reopened.get('SELECT snapshot FROM submissions').snapshot).input,i.input);reopened.close();
  const fresh=await s.intake();assert.equal((await s.a.call('POST',`/intakes/${fresh.id}/submission-preview`,{})).body.error.code,'CAMPAIGN_CLOSED');
});

test('withdrawal revokes all chain versions; new authorization never reopens withdrawn history',async t=>{
  const s=await setup(t);let i=await s.generate(s.a,await s.intake());const p1=await s.preview(s.a,i),k1=uuid(),v1=(await s.submit(s.a,p1,k1)).body;
  i=(await s.a.call('PATCH',`/intakes/${i.id}/draft`,{expected_revision:i.input_revision,input:'大二，补充了实验经历'})).body;
  i=await s.generate(s.a,i,{action:'reanalyze'});const v2=(await s.submit(s.a,await s.preview(s.a,i))).body;assert.equal(v2.version,2);assert.equal(v2.chain_id,v1.chain_id);
  const withdrawn=await s.a.call('POST',`/me/submissions/${v2.id}/withdraw`,{});assert.equal(withdrawn.body.status,'withdrawn');
  for(const v of [v1,v2])assert.equal((await s.admin.call('GET',`/admin/submissions/${v.id}`)).body.snapshot,null);
  assert.equal((await s.submit(s.a,p1,k1)).body.status,'withdrawn');
  const v3=(await s.submit(s.a,await s.preview(s.a,i))).body;assert.equal(v3.version,3);assert.notEqual(v3.chain_id,v1.chain_id);
  assert.equal((await s.admin.call('GET',`/admin/submissions/${v1.id}`)).body.snapshot,null);
  const detail=(await s.admin.call('GET',`/admin/submissions/${v3.id}`)).body;assert.equal(detail.history.length,1);assert.ok(detail.snapshot);
  await s.a.call('DELETE','/me/data',{});assert.equal((await s.admin.call('GET',`/admin/submissions/${v3.id}`)).status,404);assert.equal(s.store.get('SELECT count(*) n FROM profiles').n,1);assert.equal((await s.a.call('GET','/me/profile')).status,401);
});

test('at most two stable questions across retries, refresh and answers; skip/direct finish immediately',async t=>{
  const qfields=['education.stage','skills.self_report','education.major'];
  const s=await setup(t,{analyze:async input=>({...await advice(input),next_question:{field_path:qfields[input.asked_fields.length]||'education.major',question:'请补充一项资料',reason:'调整当前建议',options:[],allow_skip:true}})});
  let i=await s.intake();const req={idempotency_key:uuid(),action:'generate',expected_revision:0};
  i=(await s.a.call('POST',`/intakes/${i.id}/turns`,req)).body;
  assert.equal(i.question_count,1);assert.ok(i.question.question_id);
  assert.equal((await s.a.call('POST',`/intakes/${i.id}/turns`,req)).body.question.question_id,i.question.question_id);
  assert.equal((await s.a.call('GET',`/intakes/${i.id}`)).body.question_count,1);
  i=await s.generate(s.a,i,{action:'answer',answer:'大一',question_id:i.question.question_id});assert.equal(i.question_count,2);
  i=await s.generate(s.a,i,{action:'answer',answer:'会一点Python',question_id:i.question.question_id});assert.equal(i.question_count,2);assert.equal(i.question,null);
  i=await s.generate(s.a,i,{action:'reanalyze'});assert.equal(i.question_count,2);assert.equal(i.question,null);
  let skip=await s.generate(s.a,await s.intake());skip=await s.generate(s.a,skip,{action:'skip',question_id:skip.question.question_id});assert.equal(skip.question,null);assert.deepEqual(skip.skipped_fields,['education.stage']);assert.ok(skip.result);
  let direct=await s.generate(s.a,await s.intake());direct=await s.generate(s.a,direct,{action:'direct'});assert.equal(direct.question,null);assert.equal(direct.question_count,1);
});

test('late AI cannot overwrite edited draft; deletion prevents late writeback and old-cookie resurrection',async t=>{
  let release,started;const ready=new Promise(r=>started=r);
  const s=await setup(t,{analyze:async input=>{started();await new Promise(r=>release=r);return advice(input);}});
  const i=await s.intake(),pending=s.generate(s.a,i);await ready;
  await s.a.call('PATCH',`/intakes/${i.id}/draft`,{expected_revision:0,input:'分析期间的新资料'});release();const late=await pending;
  assert.equal(late.error.code,'STALE_ANALYSIS');assert.equal(late.input,'分析期间的新资料');assert.equal(late.result,null);
  let release2,started2;const ready2=new Promise(r=>started2=r);
  const s2=await setup(t,{analyze:async input=>{started2();await new Promise(r=>release2=r);return advice(input);}});
  const j=await s2.intake(),pending2=s2.generate(s2.a,j);await ready2;await s2.a.call('DELETE','/me/data',{});release2();
  const gone=await pending2;assert.equal(gone.error.code,'UNAUTHENTICATED');assert.equal(s2.store.get('SELECT count(*) n FROM intakes').n,0);
});

test('legacy import has explicit allowlist, provenance, deduplication and conflict preservation',async t=>{
  const s=await setup(t),records=[{source_key:'careerPredictor',field_path:'experience.text',value:'做过太阳能电池实验'}],request={expected_revision:0,import_id:uuid(),records};
  const p=(await s.a.call('POST','/me/profile/import',request)).body;assert.equal(p.fields['experience.text'].source_type,'legacy_import');
  assert.equal((await s.a.call('POST','/me/profile/import',request)).body.profile_revision,p.profile_revision);
  const again=(await s.a.call('POST','/me/profile/import',{...request,expected_revision:p.profile_revision,import_id:uuid()})).body;assert.equal(again.fields['experience.text'].value,records[0].value);
  const conflict=(await s.a.call('POST','/me/profile/import',{...request,expected_revision:again.profile_revision,import_id:uuid(),records:[{...records[0],value:'不同经历'}]})).body;assert.equal(conflict.conflicts.length,1);assert.equal(conflict.fields['experience.text'].value,records[0].value);
  assert.equal((await s.a.call('POST','/me/profile/import',{expected_revision:conflict.profile_revision,import_id:uuid(),records:[{source_key:'API_KEY',field_path:'skills.self_report',value:'secret'}]})).status,400);
});

test('explicitly cleared fields stay unknown when old text is reanalyzed',async t=>{
  const s=await setup(t,{analyze:async input=>({...await advice(input),profile_patch:[{field_path:'education.major',value:'能源专业',claim_type:'explicit',source_id:input.sources[0].id,evidence_quote:'能源专业'}]})});
  const done=await s.generate(s.a,await s.intake());let p=(await s.a.call('GET','/me/profile')).body;
  assert.equal(p.fields['education.major'].value,'能源专业');
  p=(await s.a.call('PATCH','/me/profile',{expected_revision:p.profile_revision,patch:[{field_path:'education.major',value:null}]})).body;
  const current=(await s.a.call('GET',`/intakes/${done.id}`)).body;
  await s.generate(s.a,current,{action:'reanalyze'});
  p=(await s.a.call('GET','/me/profile')).body;assert.equal(p.fields['education.major'].value,null);assert.equal(p.fields['education.major'].confirmation_state,'corrected');
});

test('retention removes content independently of session expiry, admin logout revokes access',async t=>{
  let time=Date.parse('2026-11-04T00:00:00Z');const s=await setup(t,{now:()=>time,env:{CAREER_RETENTION_DAYS:'2'}});
  const i=await s.generate(s.a,await s.intake());await s.submit(s.a,await s.preview(s.a,i));
  await s.admin.call('POST','/admin/logout',{});assert.equal((await s.admin.call('GET','/admin/submissions')).status,401);
  time+=3*86400000;s.router.locals.cleanup();assert.equal(s.store.get('SELECT count(*) n FROM guests').n,0);assert.equal(s.store.get('SELECT count(*) n FROM submissions').n,0);
});
