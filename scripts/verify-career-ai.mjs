import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { analyze, emptyProfile } from '../p0/analysis.js';
if(existsSync('.env') && process.env.JOURNEY_LOAD_ENV !== 'false') process.loadEnvFile('.env');
// A fictional sample. Report metadata only, never credentials or student input.
const start=Date.now();
const result=await analyze({task_type:'explore_direction',sources:[{id:'synthetic-live-check',text:'大一，能源专业，没有项目和实习，不知道做什么。会一点 Python。',source_type:'user_text'}],profile:emptyProfile(),skipped_fields:[],asked_fields:[],force_result:false});
const report={checked_at:new Date().toISOString(),duration_ms:Date.now()-start,mode:result.mode,provenance:result.provenance,error:result.error || null,options_count:result.result?.options?.length || 0,extracted_fields:result.profile_patch.map(p=>p.field_path),status:result.mode==='online_ai'?'passed':'not_verified'};
mkdirSync('artifacts/p0',{recursive:true});writeFileSync('artifacts/p0/ai-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
if(result.mode!=='online_ai')process.exitCode=1;
