import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { chromium } from 'playwright';
import { startPanel } from '../../src/server/panel';
import type { RecorderSession } from '../../src/recorder/session';
import type { Step } from '../../src/types';

it('panel API refreshes modules, names/previews/saves a test and runs the saved file', {timeout:60000}, async () => {
  const project=path.resolve(__dirname,'../..');
  fs.mkdirSync(path.join(project,'.tmp'),{recursive:true});
  const root=fs.mkdtempSync(path.join(project,'.tmp','panel-verification-'));
  fs.mkdirSync(path.join(root,'tests','initial'),{recursive:true});
  const config=path.relative(root,path.join(project,'playwright.config')).replace(/\\/g,'/');
  fs.writeFileSync(path.join(root,'playwright.config.ts'),`import base from '${config}'; export default {...base,testDir:'./tests',outputDir:'./reports/artifacts',reporter:[['json',{outputFile:'./reports/results.json'}]]};`);
  const page={url:'https://example.test/',title:'',heading:null,tab:0};
  const common={page,target:null,preAssert:false,clickStyle:'locator' as const,suggestions:[],warnings:[],createdAt:0};
  const steps: Step[]=[{...common,id:'s1',kind:'goto',value:page.url},{...common,id:'s2',kind:'assert',assertion:{type:'urlMatches',expected:'example',regex:true,target:null}}];
  const session=Object.assign(new EventEmitter(),{steps,currentPage:()=>null,flushPending:async()=>{},pages:[],mode:'record',busy:false,lastError:null,lastSettle:null,defaultClickStyle:'locator'}) as unknown as RecorderSession;
  const panel=await startPanel(session,{frameworkRoot:root,cwd:root,outDir:path.join(root,'tests'),port:0,overwrite:false,gen:{flowName:'recorded flow',viewport:{width:1280,height:720},style:'pom',keepSecrets:false}});
  const post=async (route:string,body={})=>fetch(new URL(route,panel.url),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  try {
    const html=await (await fetch(panel.url)).text();
    assert.match(html,/id="module"/); assert.match(html,/Run saved test/);
    assert.equal((await post('/api/save')).status,500);
    fs.renameSync(path.join(root,'tests','initial'),path.join(root,'tests','renamed'));
    const state=await (await post('/api/modules')).json() as any;
    assert.deepEqual(state.framework.modules,['renamed']);
    assert.equal((await post('/api/module',{module:'../outside'})).status,500);
    await post('/api/module',{module:'renamed'});
    await post('/api/options',{flowName:'Panel verification'});
    const saved=await (await post('/api/save')).json() as any;
    assert.ok(saved.entries.length);
    const file=saved.state.framework.savedFile;
    assert.ok(fs.existsSync(file));
    assert.equal((await post('/api/save')).status,500);
    // Editing a saved script is supported. This isolated runner check needs no application or browser.
    fs.writeFileSync(file,"import {test,expect} from '@playwright/test';test('panel runner verification',()=>expect(true).toBe(true));");
    assert.equal((await post('/api/run')).status,202);
    while(panel.state().framework!.run.running) await new Promise(r=>setTimeout(r,100));
    assert.equal(panel.state().framework!.run.code,0,panel.state().framework!.run.output);
    const browser=await chromium.launch({headless:true});
    try {
      const page=await browser.newPage();
      await page.goto(panel.url);
      await page.locator('#module').selectOption('renamed');
      await page.locator('#flowName').fill('Panel UI verification');
      await page.getByRole('button',{name:'Save files',exact:true}).click();
      await page.locator('#savedPath').filter({hasText:'panel-ui-verification.spec.ts'}).waitFor();
      const uiFile=panel.state().framework!.savedFile!;
      assert.ok(fs.existsSync(uiFile));
      fs.writeFileSync(uiFile,"import {test,expect} from '@playwright/test';test('panel UI runner verification',()=>expect(true).toBe(true));");
      await page.getByRole('button',{name:'Run saved test',exact:true}).click();
      await page.waitForFunction(()=>document.getElementById('runOutput')!.textContent!.includes('Runner exit code: 0'));
    } finally { await browser.close(); }
  } finally { await panel.close(); }
});
