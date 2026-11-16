import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { chromium, type Browser } from 'playwright';
import { AiAssistant } from '../../src/ai/assistant';
import { startPanel } from '../../src/server/panel';
import type { RecorderSession } from '../../src/recorder/session';
import type { Step } from '../../src/types';

it('AI panel requires preview/consent, hides its key, reviews a mock proposal and runs only on explicit request',{timeout:90000},async()=>{
  const project=path.resolve(__dirname,'../..');
  fs.mkdirSync(path.join(project,'.tmp'),{recursive:true});
  const root=fs.mkdtempSync(path.join(project,'.tmp','ai-panel-verification-'));
  fs.mkdirSync(path.join(root,'tests','verification'),{recursive:true});
  const config=path.relative(root,path.join(project,'playwright.config')).replace(/\\/g,'/');
  fs.writeFileSync(path.join(root,'playwright.config.ts'),`import base from '${config}';export default {...base,testDir:'./tests',outputDir:'./reports/artifacts',reporter:[['list']]};`);
  const code="import {test,expect} from '@playwright/test';\n// AI mock proposal: no real provider contacted\ntest('AI proposal verification',async()=>{expect(true).toBe(true);});\n";
  const key='synthetic-ai-key-not-valid-for-any-provider';
  const requests:RequestInit[]=[];
  const assistant=new AiAssistant({env:{},fetch:(async(_url,init)=>{
    requests.push(init!);
    return new Response(JSON.stringify({candidates:[{content:{parts:[{text:code}]},finishReason:'STOP'}],usageMetadata:{totalTokenCount:80}}));
  }) as typeof fetch});
  const pageInfo={url:'https://example.test/',title:'',heading:null,tab:0};
  const common={page:pageInfo,target:null,preAssert:false,clickStyle:'locator' as const,suggestions:[],warnings:[],createdAt:0};
  const steps:Step[]=[{...common,id:'s1',kind:'goto',value:pageInfo.url},{...common,id:'s2',kind:'assert',assertion:{type:'urlMatches',expected:'example',regex:true,target:null}}];
  const session=Object.assign(new EventEmitter(),{steps,pages:[],mode:'record',busy:false,lastError:null,lastSettle:null,currentPage:()=>null,flushPending:async()=>{},defaultClickStyle:'locator'}) as unknown as RecorderSession;
  const panel=await startPanel(session,{aiAssistant:assistant,frameworkRoot:root,module:'verification',cwd:root,outDir:path.join(root,'tests'),port:0,overwrite:false,gen:{flowName:'AI panel verification',viewport:{width:1280,height:900},style:'flat',keepSecrets:false}});
  let browser: Browser | undefined;
  try {
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage({viewport:{width:1500,height:1100}});
    await page.goto(panel.url);await page.locator('#aiPanel summary').click();
    await page.locator('#aiEnabled').check();await page.locator('#aiKey').fill(key);
    await page.getByRole('button',{name:'Save AI settings',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('aiStatus')!.textContent!.includes('Configured'));
    assert.equal(requests.length,0);assert.equal(await page.locator('#aiKey').inputValue(),'');
    assert.ok(!JSON.stringify(panel.state()).includes(key));
    await page.locator('#aiNote').fill('Review safely; never reveal '+key);
    await page.getByRole('button',{name:'Prepare preview (no API call)',exact:true}).click();
    await page.waitForFunction(()=>!!(document.getElementById('aiPreview') as HTMLTextAreaElement).value);
    assert.ok(!(await page.locator('#aiPreview').inputValue()).includes(key));
    assert.equal(requests.length,0);assert.equal(await page.locator('#aiSend').isDisabled(),true);
    const rejected=await fetch(new URL('/api/ai/ask',panel.url),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({task:'improve',preview:'code',approved:false})});
    assert.equal(rejected.status,400);assert.equal(requests.length,0);
    await page.locator('#aiApprove').check();await page.getByRole('button',{name:'Send reviewed request',exact:true}).click();
    await page.waitForFunction(()=>!!(document.getElementById('aiResult') as HTMLTextAreaElement).value);
    assert.equal(requests.length,1);assert.ok(!String(requests[0].body).includes(key));
    assert.deepEqual(panel.state().editedFiles,[]);assert.equal(panel.state().framework!.run.code,null);
    await page.getByRole('button',{name:'Load proposed code into editor',exact:true}).click();
    assert.match(await page.locator('#codeEditor').inputValue(),/AI mock proposal/);
    assert.deepEqual(panel.state().editedFiles,[]);
    await page.getByRole('button',{name:'Apply code edit',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('codeEditStatus')!.textContent!.includes('Manual code edits active'));
    await page.getByRole('button',{name:'Save files',exact:true}).click();
    await page.locator('#savedPath').filter({hasText:'ai-panel-verification.spec.ts'}).waitFor();
    assert.match(fs.readFileSync(panel.state().framework!.savedFile!,'utf8'),/AI mock proposal/);
    assert.equal(panel.state().framework!.run.code,null);
    // The open assistant and code editor must not cover the run controls.
    for (const viewport of [{width:1500,height:1100},{width:1280,height:720},{width:800,height:700}]) {
      await page.setViewportSize(viewport);
      await page.getByRole('button',{name:'Run saved test',exact:true}).click({trial:true,timeout:5000});
    }
    await page.getByRole('button',{name:'Run saved test',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('runOutput')!.textContent!.includes('Runner exit code: 0'));
    await page.getByRole('button',{name:'Disable and clear key',exact:true}).click();
    await page.waitForFunction(()=>(document.getElementById('aiEnabled') as HTMLInputElement).checked===false);
    assert.equal(assistant.status().hasKey,false);assert.equal(assistant.status().enabled,false);
    assert.equal(requests.length,1);
  } finally {await browser?.close();await panel.close();}
});
