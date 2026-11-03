import assert from "node:assert/strict";
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
const args=process.argv.slice(2),at=args.indexOf('--rom');
assert.ok(args.length && (at<0 || at>0 && args[at+1] && args[at+2]), 'Supply source directories, optionally followed by --rom RGBDS binjgb.');
const temp=await mkdtemp(join('node_modules','.move-behavior-check-'));
try{
 const out=join(temp,'tests.mjs');await build({entryPoints:[at>=0?'tests/moveBehaviorGameplay.ts':'tests/moveBehaviors.test.ts'],outfile:out,bundle:true,packages:'external',platform:'node',format:'esm',target:'node22'});
 const sets=at>=0?args.slice(0,at).map(root=>[root,resolve(args[at+1]),resolve(args[at+2])]):[args];
 for(const input of sets){const status=await new Promise(r=>{const child=spawn(process.execPath,[out,...input],{stdio:'inherit'});child.on('error',()=>r(1));child.on('exit',r);});if(status){process.exitCode=status;break;}}
}finally{await rm(temp,{recursive:true,force:true});}
