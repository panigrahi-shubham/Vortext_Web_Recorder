// Framework verification on local files: no company application or business test cases.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { it } from 'node:test';
import { RecorderSession } from '../../src/recorder/session';
import { saveRecording } from '../../src/framework/saving';
import { runTests } from '../../src/framework/runner';

it('records local interactions, iframe, shadow DOM and popup; compiles, discovers and executes the saved POM', { timeout: 120000 }, async () => {
  const project = path.resolve(__dirname, '../..');
  fs.mkdirSync(path.join(project, '.tmp'), {recursive:true});
  const root = fs.mkdtempSync(path.join(project,'.tmp','browser-verification-'));
  fs.mkdirSync(path.join(root,'tests','verification'), {recursive:true});
  const base = path.relative(root,path.join(project,'playwright.config')).replace(/\\/g,'/');
  fs.writeFileSync(path.join(root,'playwright.config.ts'), `import base from '${base}';\nexport default {...base,testDir:'./tests',outputDir:'./reports/artifacts',reporter:[['list'],['json',{outputFile:'./reports/results.json'}],['html',{outputFolder:'./reports/html',open:'never'}]]};`);
  fs.writeFileSync(path.join(root,'popup.html'), '<h1>Help center</h1><button onclick="this.textContent=\'Contacted\'">Contact support</button>');
  fs.writeFileSync(path.join(root,'index.html'), `<!doctype html><title>Recorder verification</title>
    <h1>Verification page</h1><label>Name<input name="name"></label>
    <button data-test="add" onclick="document.querySelector('[data-test=count]').textContent='1'">Add item</button><span data-test="count">0</span>
    <iframe title="Payment" srcdoc="<button onclick=&quot;this.textContent='Paid'&quot;>Pay now</button>"></iframe>
    <qa-widget></qa-widget><script>const button=document.createElement('button');button.textContent='Expand details';button.onclick=()=>button.textContent='Expanded';document.querySelector('qa-widget').attachShadow({mode:'open'}).append(button);</script>
    <a href="popup.html" target="_blank">Open help center</a>`);
  const session = await RecorderSession.launch({url:pathToFileURL(path.join(root,'index.html')).href,viewport:{width:1280,height:800},testIdAttr:'data-test',headless:true,ui:true});
  try {
    await session.start();
    const page=session.pages[0];
    await page.getByLabel('Name').fill('Recorder verification');
    await page.getByRole('button',{name:'Add item'}).click(); await session.idle();
    await page.frameLocator('iframe').getByRole('button',{name:'Pay now'}).click(); await session.idle();
    await page.locator('qa-widget').getByRole('button',{name:'Expand details'}).click(); await session.idle();
    await page.getByRole('link',{name:'Open help center'}).click(); await session.idle();
    assert.equal(session.pages.length,2);
    await session.pages[1].getByRole('button',{name:'Contact support'}).click(); await session.idle();
    assert.equal(session.lastError,null);
    assert.ok(session.steps.some(s=>s.kind==='fill'));
    assert.ok(session.steps.some(s=>s.target?.chain.frames.length));
    assert.ok(session.steps.some(s=>s.popup));
    assert.ok(session.steps.some(s=>s.target?.name==='Expand details'));
    const saved=saveRecording(root,'verification',session.steps,{flowName:'Recorder verification',viewport:{width:1280,height:800},style:'pom',keepSecrets:false,testIdAttr:'data-test'});
    assert.equal((await runTests(root,{file:saved.file,list:true})).code,0);
    await session.close();
    const result=await runTests(root,{file:saved.file});
    assert.equal(result.code,0,result.output);
  } finally { await session.close(); }
});
