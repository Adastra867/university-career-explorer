import { Router } from 'express';
import jobs from './routes/jobs.js';
import { loadWorkspace, saveWorkspace, exportAccount } from './services/workspace.js';
import { searchConfigured } from './search.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { pool, transaction, assertSchemaReady } from './db.js';
import { credentials, workspace, uuid, chat, experience, matchInput } from './schemas.js';
import { digest, hashPassword, verifyPassword, readCookie, sessionToken, setCookie, sameOrigin } from './security.js';
import { ask, extract, matchJD, knowledge } from './ai.js';
const error=(status,code,message)=>Object.assign(new Error(message),{status,code});
const parse=(schema,value)=>schema.parse(value);
const router=Router();
router.use(sameOrigin);
router.get('/health',async(req,res)=>{
 let database='not_configured';
 if(pool) { try {await assertSchemaReady();database='ready';}catch(error){database=['42P01','42703','DATABASE_SCHEMA_OUTDATED'].includes(error.code)?'schema_outdated':'unavailable';} }
 res.status(database==='ready'?200:503).json({database,ai:!!(process.env.LLM_API_KEY&&process.env.LLM_API_URL&&process.env.LLM_MODEL),search:searchConfigured(),searchProvider:'deepseek'});
});
router.use((req,res,next)=>{
 if(!pool) return next(error(503,'DATABASE_NOT_CONFIGURED','数据库尚未配置，请联系管理员'));
 next();
});
const authLimit=rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:'draft-8',legacyHeaders:false,message:{code:'RATE_LIMITED',error:'操作频繁，请稍后重试'}});
router.post('/auth/register',authLimit,async(req,res)=>{
 const {email,password}=parse(credentials,req.body);
 const id=randomUUID(); const hash=await hashPassword(password); const token=sessionToken();
 await transaction(async c=>{
  try {await c.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)',[id,email,hash]);}
  catch(e){if(e.code==='23505')throw error(409,'EMAIL_EXISTS','该邮箱已注册');throw e;}
  await c.query('INSERT INTO user_state(user_id) VALUES($1)',[id]);
  await c.query("INSERT INTO sessions VALUES($1,$2,now()+interval '7 days')",[digest(token),id]);
 });
 setCookie(res,token);res.status(201).json({user:{id,email}});
});
router.post('/auth/login',authLimit,async(req,res)=>{
 const {email,password}=parse(credentials,req.body);
 const user=(await pool.query('SELECT * FROM users WHERE email=$1',[email])).rows[0];
 // Always perform password derivation, even for unknown accounts.
 const valid=await verifyPassword(password,user?.password_hash || ('0'.repeat(32)+':'+ '0'.repeat(128)));
 if(!user||!valid)throw error(401,'INVALID_CREDENTIALS','邮箱或密码错误');
 const token=sessionToken();
 await pool.query('DELETE FROM sessions WHERE expires_at < now()');
 await pool.query("INSERT INTO sessions VALUES($1,$2,now()+interval '7 days')",[digest(token),user.id]);
 setCookie(res,token);res.json({user:{id:user.id,email:user.email}});
});
router.use(async(req,res,next)=>{
 const token=readCookie(req);
 const user=token?(await pool.query('SELECT u.id,u.email FROM users u JOIN sessions s ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()',[digest(token)])).rows[0]:null;
 if(!user)throw error(401,'AUTH_REQUIRED','请先登录');
 if(req.get('x-career-user') && req.get('x-career-user')!==user.id)throw error(409,'SESSION_CHANGED','登录账号已在其他页面改变，请刷新并重新确认资料来源');
 req.user=user;next();
});
router.get('/auth/me',(req,res)=>res.json({user:req.user}));
router.post('/auth/logout',async(req,res)=>{
 await pool.query('DELETE FROM sessions WHERE token_hash=$1',[digest(readCookie(req))]);
 res.clearCookie('career_session',{path:'/'});res.json({success:true});
});
router.delete('/auth/account',authLimit,async(req,res)=>{
 const password=parse(credentials.shape.password,req.body?.password);
 const user=(await pool.query('SELECT password_hash FROM users WHERE id=$1',[req.user.id])).rows[0];
 if(!await verifyPassword(password,user.password_hash))throw error(401,'INVALID_CREDENTIALS','密码错误');
 await pool.query('DELETE FROM users WHERE id=$1',[req.user.id]);res.clearCookie('career_session',{path:'/'});res.json({success:true});
});
router.get('/workspace', async (req, res) => res.json(await loadWorkspace(req.user.id)));
router.get('/export', async (req, res) => res.json(await exportAccount(req.user.id)));
router.put('/workspace', async (req, res) => res.json({ version: await saveWorkspace(req.user.id, parse(workspace, req.body)) }));
router.get('/conversations',async(req,res)=>res.json({conversations:(await pool.query('SELECT id,title,created_at FROM conversations WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[req.user.id])).rows}));
router.post('/conversations',async(req,res)=>{
 const title=typeof req.body?.title==='string'?req.body.title.trim().slice(0,80):'职业答疑';
 const conversation=(await pool.query('INSERT INTO conversations(id,user_id,title) VALUES($1,$2,$3) RETURNING id,title,created_at',[randomUUID(),req.user.id,title||'职业答疑'])).rows[0];
 res.status(201).json({conversation});
});
async function owned(id,userId,c=pool,lock=false) {
 parse(uuid,id);
 const result=await c.query('SELECT id FROM conversations WHERE id=$1 AND user_id=$2'+(lock?' FOR UPDATE':''),[id,userId]);
 if(!result.rowCount)throw error(404,'NOT_FOUND','会话不存在');
}
router.get('/conversations/:id/messages',async(req,res)=>{
 await owned(req.params.id,req.user.id);
 const before=req.query.before;
 if(before !== undefined && (typeof before !== 'string' || !/^\d{1,19}$/.test(before) || BigInt(before)>9223372036854775807n))throw error(400,'INVALID_INPUT','分页参数无效');
 const messages=(await pool.query('SELECT id,role,content,metadata,created_at FROM messages WHERE conversation_id=$1 AND ($2::bigint IS NULL OR id<$2::bigint) ORDER BY id DESC LIMIT 50',[req.params.id,before||null])).rows.reverse();
 res.json({messages,nextBefore:messages.length===50?messages[0].id:null});
});
router.delete('/conversations/:id',async(req,res)=>{
 await owned(req.params.id,req.user.id);
 await pool.query('DELETE FROM conversations WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);res.json({success:true});
});
const aiLimit=rateLimit({windowMs:60000,limit:10,keyGenerator:req=>req.user.id,standardHeaders:'draft-8',legacyHeaders:false,message:{code:'RATE_LIMITED',error:'AI请求频繁，请稍后重试'}});
async function aiBudget(req,res,next) {
 // Invalid requests must not consume the shared daily budget.
 if(req.params.id) parse(chat,req.body);
 else if(req.path==='/extract') parse(experience,req.body);
 else parse(matchInput,req.body);
 if(!process.env.LLM_API_KEY||!process.env.LLM_API_URL||!process.env.LLM_MODEL) throw error(503,'AI_NOT_CONFIGURED','在线模型尚未配置，请联系管理员');
 await transaction(async c=>{
  await c.query('SELECT pg_advisory_xact_lock(8672027)');
  const total=Number((await c.query('SELECT COALESCE((SELECT requests FROM ai_service_usage WHERE day=CURRENT_DATE),0) AS n')).rows[0].n);
  const own=Number((await c.query('SELECT requests AS n FROM ai_daily_usage WHERE user_id=$1 AND day=CURRENT_DATE',[req.user.id])).rows[0]?.n||0);
  if(total>=Number(process.env.AI_DAILY_TOTAL_LIMIT||500)||own>=Number(process.env.AI_DAILY_USER_LIMIT||50)) throw error(429,'AI_DAILY_LIMIT','今日AI调用额度已用完，请明日重试');
  await c.query('INSERT INTO ai_service_usage(requests) VALUES(1) ON CONFLICT(day) DO UPDATE SET requests=ai_service_usage.requests+1');
  await c.query('INSERT INTO ai_daily_usage(user_id,requests) VALUES($1,1) ON CONFLICT(user_id,day) DO UPDATE SET requests=ai_daily_usage.requests+1',[req.user.id]);
 });
 next();
}
router.post('/conversations/:id/messages',aiLimit,aiBudget,async(req,res)=>{
 const input=parse(chat,req.body);
 const result=await transaction(async c=>{
  await owned(req.params.id,req.user.id,c,true);
  const existing=(await c.query('SELECT id,role,content,metadata,created_at FROM messages WHERE conversation_id=$1 AND request_id=$2 ORDER BY id',[req.params.id,input.requestId])).rows;
  if(existing.length){
   if(existing.find(message=>message.role==='user')?.content!==input.content)throw error(409,'REQUEST_ID_CONFLICT','同一请求ID不能用于不同的提问');
   return existing;
  }
  const history=(await c.query('SELECT role,content FROM messages WHERE conversation_id=$1 ORDER BY id DESC LIMIT 12',[req.params.id])).rows.reverse();
  const reply=await ask(history,input.content);
  const saved=[];
  for(const [role,content,metadata] of [['user',input.content,{}],['assistant',reply.content,reply.metadata]])saved.push((await c.query('INSERT INTO messages(conversation_id,role,content,metadata,request_id) VALUES($1,$2,$3,$4,$5) RETURNING id,role,content,metadata,created_at',[req.params.id,role,content,metadata,input.requestId])).rows[0]);
  return saved;
 });
 res.status(201).json({messages:result});
});
router.post('/extract',aiLimit,aiBudget,async(req,res)=>{
 const input=parse(experience,req.body);res.json(await extract(input.text));
});
router.post('/match',aiLimit,aiBudget,async(req,res)=>{
 const input=parse(matchInput,req.body);res.json(await matchJD(input.jd,input.text));
});
router.get('/knowledge',(req,res)=>res.json({items:knowledge}));
router.use(['/search-jobs','/recommend-jobs','/fetch-jd'],(req,res,next)=>{
 if(req.method!=='POST')return next();
 const location=z.string().trim().max(80).optional();
 const count=z.number().int().min(1).max(20).optional();
 if(req.baseUrl.endsWith('/search-jobs'))req.body=z.object({query:z.string().trim().min(1).max(200),location,count}).parse(req.body);
 else if(req.baseUrl.endsWith('/fetch-jd'))req.body=z.object({url:z.string().url().max(2000).refine(value=>['https:','http:'].includes(new URL(value).protocol))}).parse(req.body);
 else req.body=z.object({directions:z.array(z.object({id:z.string().max(100).optional(),industry:z.string().max(100).optional(),direction:z.string().max(100).optional(),jobs:z.array(z.string().max(100)).max(10).optional(),skills:z.array(z.string().max(100)).max(20).optional()})).min(1).max(3),location,count}).parse(req.body);
 next();
});
router.use(['/search-jobs','/recommend-jobs','/fetch-jd'],rateLimit({windowMs:60000,limit:10,keyGenerator:req=>req.user.id,standardHeaders:'draft-8',legacyHeaders:false,message:{code:'RATE_LIMITED',error:'搜索请求频繁，请稍后重试'}}));
router.use(jobs);
export default router;
