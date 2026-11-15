import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { it } from 'node:test';
import { RecorderSession } from '../../src/recorder/session';
import { generate } from '../../src/codegen';
import { saveFiles } from '../../src/codegen/save';
import { validateGenerated } from '../../src/framework/validate';
import { recordingFile } from '../../src/commands/recording';
import { runTests } from '../../src/framework/runner';
import { startPanel } from '../../src/server/panel';
import type { Page } from 'playwright';

async function ui(page: Page, kind: string, value='') {
  const rect=await page.evaluate(([kind,value])=>(window as any).__tphub.uiRect(kind,value),[kind,value]);
  assert.ok(rect, `Missing UI control ${kind}:${value}`);
  await page.mouse.click(rect.x,rect.y);
}

it('authors text, sequential typing, append, copy/paste, keys and selections; replays POM and flat output', {timeout:180000}, async()=>{
  const project=path.resolve(__dirname,'../..');
  fs.mkdirSync(path.join(project,'.tmp'),{recursive:true});
  const root=fs.mkdtempSync(path.join(project,'.tmp','authoring-verification-'));
  fs.mkdirSync(path.join(root,'tests','verification'),{recursive:true});
  const config=path.relative(root,path.join(project,'playwright.config')).replace(/\\/g,'/');
  fs.writeFileSync(path.join(root,'playwright.config.ts'),`import base from '${config}';export default {...base,testDir:'./tests',outputDir:'./reports/artifacts',reporter:[['list'],['json',{outputFile:'./reports/results.json'}]]};`);
  fs.writeFileSync(path.join(root,'input.html'),`<!doctype html><title>Authoring verification</title>
    <label>Source<input id="source" value="Runtime identifier"></label>
    <label>Destination<textarea id="destination"></textarea></label>
    <label>Category<select multiple id="category"><option value="one">First choice</option><option value="two">Second choice</option></select></label>
    <label>Enabled<input type="checkbox" id="enabled"></label>
    <label>Password<input type="password" id="password"></label>
    <button id="submit" onclick="document.querySelector('#result').textContent=document.querySelector('#destination').value">Submit</button><div id="result"></div>`);
  const session=await RecorderSession.launch({url:pathToFileURL(path.join(root,'input.html')).href,viewport:{width:1400,height:1000},testIdAttr:'data-testid',headless:true,ui:true});
  let panel: Awaited<ReturnType<typeof startPanel>> | undefined;
  try {
    await session.start();const page=session.pages[0];
    await ui(page,'mode','actions'); await session.idle();
    await page.getByLabel('Destination').click();
    await ui(page,'authorText');await page.keyboard.insertText('स्टील पाइप & Valve\nSecond line');
    await ui(page,'menu','Apply text');await session.idle();
    assert.equal(await page.getByLabel('Destination').inputValue(),'स्टील पाइप & Valve\nSecond line');
    const author=async(selector:string,extra:Record<string,unknown>)=>{
      const r=await page.evaluate(async({selector,extra})=>{
        const t=(window as any).__tphub;
        return await (window as any).__tphubCall('author',{target:t.describe(document.querySelector(selector),true),...extra});
      },{selector,extra});
      assert.equal(r.ok,true,JSON.stringify(r));await session.idle();
    };
    await author('#destination',{type:'fill',value:'Typed',inputMode:'type',typingDelay:1});
    assert.equal(await page.getByLabel('Destination').inputValue(),'Typed');
    await author('#destination',{type:'fill',value:' + appended',inputMode:'append'});
    assert.equal(await page.getByLabel('Destination').inputValue(),'Typed + appended');
    await author('#destination',{type:'fill',value:'',inputMode:'fill'});
    assert.equal(await page.getByLabel('Destination').inputValue(),'');
    await page.getByLabel('Source').click(); await ui(page,'menu','Copy value / text'); await session.idle();
    await page.getByLabel('Destination').click(); await ui(page,'menu','Paste recorder clipboard'); await session.idle();
    assert.equal(await page.getByLabel('Destination').inputValue(),'Runtime identifier');
    await author('#category',{type:'select',values:['one','two']});
    assert.deepEqual(await page.getByLabel('Category').evaluate((el:HTMLSelectElement)=>Array.from(el.selectedOptions).map(o=>o.value)),['one','two']);
    await author('#enabled',{type:'check'});assert.equal(await page.getByLabel('Enabled').isChecked(),true);
    await author('#enabled',{type:'uncheck'});assert.equal(await page.getByLabel('Enabled').isChecked(),false);
    await author('#destination',{type:'press',key:'ControlOrMeta+End'});
    await author('#password',{type:'fill',value:'verification-secret-only',secret:true});
    assert.equal(session.steps.at(-1)?.secret,true);
    assert.ok(!recordingFile(session.steps,{flowName:'verification',viewport:{width:1400,height:1000},style:'pom',keepSecrets:false}).content.includes('verification-secret-only'));
    const passwordStep=session.steps.at(-1)!;
    // Remove this secret verification step before replay: no credentials are needed for the fixture.
    session.deleteStep(passwordStep.id);
    assert.equal(session.lastError,null);
    const last=session.steps.at(-1)!;
    const duplicated=session.duplicateStep(last.id)!;
    assert.notEqual(duplicated.id,last.id); assert.equal(duplicated.kind,last.kind);
    session.deleteStep(duplicated.id);
    await page.evaluate(()=>{
      const t=(window as any).__tphub;
      t.emit({type:'assert',target:t.describe(document.querySelector('#destination'),true),assertType:'valueEquals',expected:'Runtime identifier'});
    });
    await session.idle();
    panel=await startPanel(session,{frameworkRoot:root,module:'verification',port:0,cwd:root,outDir:path.join(root,'tests'),overwrite:false,gen:{flowName:'Editable text',viewport:{width:1400,height:1000},style:'pom',keepSecrets:false}});
    const panelContext=await session.browser.newContext();const pp=await panelContext.newPage();await pp.goto(panel.url);
    const firstText=pp.locator('textarea[data-act="value"]').first();await firstText.waitFor();
    await firstText.fill('Edited in panel');await firstText.press('Tab');
    await pp.waitForFunction(()=>document.getElementById('preview')!.textContent!.length>0);
    await session.idle();assert.equal(session.steps.find(s=>s.kind==='fill')!.value,'Edited in panel');
    await pp.getByRole('button',{name:'Edit code',exact:true}).click();
    const editor=pp.getByRole('textbox',{name:'Editable generated code'});
    const originalCode=await editor.inputValue();
    await editor.fill('const broken = ;');
    await pp.getByRole('button',{name:'Apply code edit',exact:true}).click();
    await pp.waitForFunction(()=>document.getElementById('codeEditStatus')!.textContent!.includes('Manual code edits active'));
    panel.userNamed=true;
    let response=await fetch(new URL('/api/save',panel.url),{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    assert.equal(response.status,500);assert.match((await response.json() as any).error,/validation failed/);
    await editor.fill('// Edited and pasted in the built-in code editor\n'+originalCode);
    await pp.getByRole('button',{name:'Apply code edit',exact:true}).click();
    await pp.waitForFunction(()=>document.getElementById('codeEditStatus')!.textContent!.includes('Manual code edits active'));
    response=await fetch(new URL('/api/save',panel.url),{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    const saved=await response.json() as any;
    assert.equal(response.status,200,JSON.stringify(saved));
    assert.match(fs.readFileSync(saved.state.framework.savedFile,'utf8'),/Edited and pasted in the built-in code editor/);
    await panelContext.close(); await panel.close();panel=undefined;
    for(const style of ['pom','flat'] as const) {
      const dir=path.join(root,'tests','verification',style);
      const options={flowName:'Authoring '+style,viewport:{width:1400,height:1000},style,keepSecrets:false};
      const files=generate(session.steps,options).files;
      validateGenerated(files,dir);saveFiles(files,dir,{cwd:root});
      const code=files.map(f=>f.content).join('\n');assert.match(code,/pressSequentially/);assert.match(code,/copyText/);assert.match(code,/pasteText/);
      const result=await runTests(root,{file:path.join(dir,'specs',`authoring-${style}.spec.ts`)});
      assert.equal(result.code,0,result.output);
    }
  } finally {await panel?.close();await session.close();}
});
