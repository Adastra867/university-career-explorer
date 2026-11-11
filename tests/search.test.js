import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { DeepSeekSearchClient, buildSearchQuery } from '../src/search.js';

test('search query respects Unicode length and keeps role/domain restrictions', () => {
 const result=buildSearchQuery('数据分析师 '+ '岗位'.repeat(150),'zhipin.com,career.huawei.com,jobs.bytedance.com,invalid/path');
 assert.ok(Array.from(result).length<=128);assert.ok(result.startsWith('数据分析师'));assert.ok(result.includes('site:zhipin.com'));assert.ok(!result.includes('invalid/path'));
 assert.equal(Array.from(buildSearchQuery('😀'.repeat(200))).length,128);
});

test('search requires credentials and can be disabled without disabling the model', () => {
 assert.throws(()=>new DeepSeekSearchClient({apiKey:''}), {code:'SEARCH_NOT_CONFIGURED'});
 assert.throws(()=>new DeepSeekSearchClient({apiKey:'key',enabled:false}), {code:'SEARCH_NOT_CONFIGURED'});
});

test('DeepSeek adapter maps search metadata, reads actual pages and handles provider failures',async t=>{
 const requests=[];
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part;
  const body=JSON.parse(raw);requests.push({path:req.url,body,auth:req.headers.authorization});
  if(body.query==='unauthorized'){res.writeHead(401);res.end('{}');return;}
  if(body.query==='balance'){res.writeHead(402);res.end('{}');return;}
  if(body.query==='limited'){res.writeHead(429);res.end('{}');return;}
  if(body.query==='invalid'){res.end('not JSON');return;}
  if(body.query==='malformed'){res.end('{"other":[]}');return;}
  if(body.query==='timeout'){setTimeout(()=>res.end('{}'),200);return;}
  if(body.query==='empty'){res.end('{"results":[]}');return;}
  if(req.url==='/v1/tools/fetch'){
   if(body.url.includes('blocked')){res.writeHead(404);res.end('{}');return;}
   res.end(JSON.stringify({title:'岗位详情',content:'# JD\n要求SQL'}));return;
  }
  res.end(JSON.stringify({results:[{title:'数据分析师',url:'https://example.com/job',snippet:'岗位摘要',summary:'长摘要',content:'真实JD正文',site_name:'企业官网',date:'2026-11-04T00:00:00Z',authority:3},{title:'unsafe',url:'javascript:alert(1)'},null]}));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{server.closeAllConnections();server.close();});
 const config={apiKey:'test-search-key',baseUrl:`http://127.0.0.1:${server.address().port}`,timeout:1000};
 const client=new DeepSeekSearchClient(config);
 const data=await client.advancedSearch('数据分析',{count:5,needContent:true,sites:'example.com'});
 assert.equal(data.web_items.length,1);assert.equal(data.web_items[0].publish_time,'2026-11-04T00:00:00Z');assert.equal(data.web_items[0].content,'真实JD正文');assert.equal(data.web_items[0].auth_info_level,3);
 assert.deepEqual(requests[0],{path:'/v1/tools/search',body:{query:'数据分析 site:example.com',count:5,need_content:true},auth:'Bearer test-search-key'});
 assert.equal((await client.fetchPage('https://example.com/job')).content,'# JD\n要求SQL');
 assert.equal((await client.webSearch('empty')).web_items.length,0);
 for(const [query,code] of [['unauthorized','SEARCH_AUTH_FAILED'],['balance','SEARCH_BALANCE_REQUIRED'],['limited','SEARCH_RATE_LIMITED'],['invalid','SEARCH_UNAVAILABLE'],['malformed','SEARCH_INVALID_OUTPUT']])await assert.rejects(client.webSearch(query),{code});
 await assert.rejects(client.fetchPage('file:///etc/passwd'),{code:'SEARCH_INVALID_URL'});
 await assert.rejects(client.fetchPage('https://user:password@example.com'),{code:'SEARCH_INVALID_URL'});
 await assert.rejects(client.fetchPage('https://example.com/blocked'),{code:'SEARCH_CONTENT_UNAVAILABLE'});
 await assert.rejects(new DeepSeekSearchClient({...config,timeout:30}).webSearch('timeout'),{code:'SEARCH_UNAVAILABLE'});
});
