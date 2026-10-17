import assert from "node:assert/strict";
import { mkdtemp,readFile,readdir,rm } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";
const roots=process.argv.slice(2);assert.equal(roots.length,2,"Supply pinned Red and Yellow sources");
const temporary=await mkdtemp(join("node_modules",".pc-tutorial-ui-"));let browser;
const server=createServer((_req,res)=>{res.setHeader("Content-Type","text/html");res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>');});
try{
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const outfile=join(temporary,"fixture.js");await build({entryPoints:["tests/pcTutorialUiFixture.tsx"],outfile,bundle:true,platform:"browser",jsx:"automatic",loader:{".css":"empty"},plugins:[{name:"tutorial-session",setup(b){b.onResolve({filter:/platform\/compat$/},()=>({path:"tutorial-session",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"export const invoke=(command,args)=>window.tutorialInvoke(command,args);"}));}}]});
 const script=await readFile(outfile,"utf8"),styles=(await Promise.all(["App.css","TextEditor.css","editor/SearchableSelect.css"].map(p=>readFile(join("src",p),"utf8")))).join("\n");
 browser=await chromium.launch();
 for(const root of roots){
  const files={},bytes={};async function collect(folder=""){for(const e of await readdir(join(root,folder),{withFileTypes:true})){if(e.name.startsWith("."))continue;const p=join(folder,e.name);if(e.isDirectory())await collect(p);else if(p.endsWith(".asm"))files[p]=await readFile(join(root,p),"utf8");}}
  await collect();for(const path of ["maps/ViridianPokecenter.blk","gfx/blocksets/pokecenter.bst"])bytes[path]=Array.from(await readFile(join(root,path)));
  for(const width of [320,375,1280]){
   const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on("pageerror",e=>errors.push(e.message));
   await page.goto(`http://127.0.0.1:${server.address().port}`);await page.addStyleTag({content:styles});await page.evaluate(({files,bytes})=>{window.tutorialFiles=files;window.tutorialBytes=bytes;},{files,bytes});await page.addScriptTag({content:script});
   await page.getByRole("button",{name:"PC tutorial",exact:true}).click();const dialog=page.getByRole("dialog",{name:"PC tutorial",exact:true});
   const level=dialog.getByRole("spinbutton",{name:"Tutorial gift level"});await level.waitFor({timeout:30000});assert.equal(await level.inputValue(),"5");
   await level.fill("7");await dialog.getByRole("textbox",{name:"Introduction and offer"}).fill("<PLAYER>!\nA new PC lesson!");
   page.once("dialog",d=>d.dismiss());await dialog.getByRole("button",{name:"Close",exact:true}).click();assert.ok(await dialog.isVisible());
   await dialog.getByRole("button",{name:"Review tutorial",exact:true}).click();await dialog.getByText("DRATINI · Lv. 7",{exact:true}).waitFor();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${root} ${width}: wizard overflow`);
   await dialog.getByRole("button",{name:"Back",exact:true}).click();assert.equal(await level.inputValue(),"7");
   await dialog.getByRole("button",{name:"Review tutorial",exact:true}).click();await dialog.getByRole("button",{name:"Create tutorial",exact:true}).click();await dialog.waitFor({state:"hidden",timeout:30000});
   assert.equal(await page.evaluate(()=>window.tutorialWrites[0].length),8);
   await page.getByRole("button",{name:"PC tutorial",exact:true}).click();await level.waitFor({timeout:30000});assert.equal(await level.inputValue(),"7");
   assert.equal(await dialog.getByRole("textbox",{name:"Introduction and offer"}).inputValue(),"<PLAYER>!\nA new PC lesson!");
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${root} ${width}: edit wizard overflow`);
   await level.fill("8");await dialog.getByRole("button",{name:"Review tutorial",exact:true}).click();await dialog.getByRole("button",{name:"Save tutorial",exact:true}).click();await dialog.waitFor({state:"hidden",timeout:30000});
   assert.equal(await page.evaluate(()=>window.tutorialWrites[1].length),1);
   await page.getByRole("button",{name:"Undo tutorial",exact:true}).click();await page.getByRole("button",{name:"Undo tutorial",exact:true}).click();
   assert.deepEqual(await page.evaluate(()=>window.tutorialFiles),files,"Atomic undo must restore every source file");assert.deepEqual(errors,[]);await page.close();console.log(`${root} ${width}px: create/review/reopen/edit/atomic-undo and phone layout passed`);
  }
 }
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(temporary,{recursive:true,force:true});}
