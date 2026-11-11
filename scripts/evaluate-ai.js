import { readFile,mkdir,writeFile } from 'node:fs/promises';
import { ask,extract,matchJD } from '../src/ai.js';
if(!process.env.LLM_API_KEY)throw new Error('Configure LLM_API_KEY first. This evaluation makes 30 real, potentially billable model calls.');
const cases=JSON.parse(await readFile(new URL('../tests/ai-evaluation.json',import.meta.url),'utf8'));
const results=[];
for(const item of cases){
 const started=Date.now();
 try{
  const output=item.type==='extract'?await extract(item.text):item.type==='match'?await matchJD(item.jd,item.text):await ask([],item.question);
  results.push({id:item.id,status:'schema_and_evidence_valid',durationMs:Date.now()-started,output,humanReview:null});
 }catch(e){results.push({id:item.id,status:'failed',code:e.code||'UNKNOWN',durationMs:Date.now()-started,humanReview:null});}
 console.log(item.id,results.at(-1).status);
}
await mkdir('artifacts',{recursive:true});const path=`artifacts/ai-evaluation-${Date.now()}.json`;
await writeFile(path,JSON.stringify({createdAt:new Date().toISOString(),model:process.env.LLM_MODEL,total:results.length,structurallyValid:results.filter(x=>x.status==='schema_and_evidence_valid').length,notice:'Schema and literal evidence checks do not prove semantic correctness. Human review required.',results},null,2));
console.log('Saved',path);
