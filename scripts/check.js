import { readdir,readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
async function check(dir){for(const entry of await readdir(dir,{withFileTypes:true})){
 const path=dir+'/'+entry.name;
 if(entry.isDirectory()) await check(path);
 else if(path.endsWith('.js')){const result=spawnSync(process.execPath,['--check',path],{encoding:'utf8'});if(result.status)throw new Error(result.stderr);}
 else if(path.endsWith('.html')){const text=await readFile(path,'utf8');for(const match of text.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(match[1],{filename:path});}
}}
for(const folder of ['src','public','scripts','tests'])await check(folder);
if(spawnSync(process.execPath,['--check','server.js']).status)process.exit(1);
console.log('JavaScript and inline HTML scripts checked');
