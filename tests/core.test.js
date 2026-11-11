import test from 'node:test';
import assert from 'node:assert/strict';
import { matchEvidence } from '../public/js/matching.js';
import { hashPassword,verifyPassword,digest,readCookie } from '../src/security.js';
import { retrieve,matchEvidenceErrors } from '../src/ai.js';
import { workspace,credentials } from '../src/schemas.js';
test('coverage is deterministic, case insensitive and deduplicated',()=>{
 const catalog={tools:['SQL','Python','sql']};
 const first=matchEvidence('需要SQL及Python','使用sql编写报表',catalog);
 assert.equal(first.matchScore,50);assert.equal(first.totalKeywords,2);
 assert.deepEqual(first,matchEvidence('需要SQL及Python','使用sql编写报表',catalog));
});
test('missing evidence or requirements gives null instead of random scores',()=>{
 assert.equal(matchEvidence('未知岗位','经历',{tools:['SQL']}).matchScore,null);
 assert.equal(matchEvidence('SQL','',{tools:['SQL']}).matchScore,null);
 assert.equal(matchEvidence('SQL','做过设计',{tools:['SQL']}).matchScore,0);
});
test('passwords use salted scrypt hashes and constant length comparisons',async()=>{
 const a=await hashPassword('secure password 123');const b=await hashPassword('secure password 123');
 assert.notEqual(a,b);assert.ok(await verifyPassword('secure password 123',a));assert.equal(await verifyPassword('wrong password',a),false);
});
test('session parser and token hash',()=>{
 assert.equal(readCookie({headers:{cookie:'x=1; career_session=abc'}}),'abc');assert.equal(digest('abc').length,64);
});
test('knowledge retrieval never invents unmatched sources',()=>{
 assert.equal(retrieve('unknownword').length,0);assert.ok(retrieve('如何写简历').some(x=>x.id==='resume-evidence'));
});
test('workspace rejects duplicate and invalid report ids; email normalized',()=>{
 assert.equal(workspace.safeParse({version:0,appData:{},history:[{id:'a'},{id:'a'}],prep:{}}).success,false);
 assert.equal(credentials.parse({email:'TEST@example.com',password:'longpassword'}).email,'test@example.com');
});

test('JD quotes cannot add repeated verbs that are absent in the source',()=>{
 const jd='熟悉SQL和Excel';const text='使用Excel完成报表';
 assert.equal(matchEvidenceErrors([{requirement:'熟悉Excel',evidence:'使用Excel',status:'supported'}],jd,text).length,1);
 assert.equal(matchEvidenceErrors([{requirement:'Excel',evidence:'使用Excel',status:'supported'}],jd,text).length,0);
 assert.equal(matchEvidenceErrors([{requirement:'SQL',evidence:'',status:'supported'}],jd,text).length,1);
});
