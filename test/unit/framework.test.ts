import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { generate } from '../../src/codegen';
import { discoverModules, EMPTY_SUITE, moduleDirectory } from '../../src/framework/modules';
import { saveRecording } from '../../src/framework/saving';
import { runTests, selectionArgs } from '../../src/framework/runner';
import { validateGenerated } from '../../src/framework/validate';
import type { Step, GenerateOptions } from '../../src/types';

const project = path.resolve(__dirname, '../..');
function temporaryProject() {
  fs.mkdirSync(path.join(project, '.tmp'), { recursive: true });
  const root = fs.mkdtempSync(path.join(project, '.tmp', 'framework-verification-'));
  for (const name of ['alpha', 'empty', 'beta[1]']) fs.mkdirSync(path.join(root, 'tests', name), { recursive: true });
  const base = path.relative(root, path.join(project, 'playwright.config')).replace(/\\/g, '/');
  fs.writeFileSync(path.join(root, 'playwright.config.ts'), `import base from '${base}';\nexport default { ...base, testDir:'./tests', outputDir:'./reports/artifacts', reporter:[['json',{outputFile:'./reports/results.json'}],['html',{outputFolder:'./reports/html',open:'never'}]] };`);
  return root;
}
function writeTest(root: string, module: string, name: string, body: string) {
  const file = path.join(root, 'tests', module, name + '.spec.ts');
  fs.writeFileSync(file, `import {test,expect} from '@playwright/test';\n${body}`);
  return file;
}
function steps(): Step[] {
  const page = { url: 'https://example.test/', title: '', heading: null, tab: 0 };
  const base = { page, target: null, preAssert: false, clickStyle: 'locator' as const, suggestions: [], warnings: [], createdAt: 0 };
  return [
    { ...base, id:'s1', kind:'goto', value:page.url },
    { ...base, id:'s2', kind:'assert', assertion:{ type:'urlMatches', target:null, expected:'example', regex:true } },
  ];
}
const options: GenerateOptions = { flowName:'Verify journey', viewport:{width:1280,height:720}, style:'pom', keepSecrets:false, testIdAttr:'data-test' };

describe('framework saving and discovery', () => {
  it('discovers empty, added, renamed and removed modules; rejects traversal', () => {
    const root = temporaryProject();
    assert.deepEqual(discoverModules(root), ['alpha','beta[1]','empty']);
    fs.renameSync(path.join(root,'tests','alpha'), path.join(root,'tests','renamed'));
    fs.mkdirSync(path.join(root,'tests','future'));
    fs.rmdirSync(path.join(root,'tests','empty'));
    assert.deepEqual(discoverModules(root), ['beta[1]','future','renamed']);
    assert.throws(() => moduleDirectory(root, '../outside'), /Unknown module/);
  });
  it('compiles at final paths, saves independently per module and refuses overwrites', async () => {
    const root = temporaryProject();
    const first = saveRecording(root, 'alpha', steps(), options);
    const second = saveRecording(root, 'beta[1]', steps(), options);
    assert.ok(fs.existsSync(first.file) && fs.existsSync(second.file));
    assert.match(fs.readFileSync(first.file,'utf8'), /testIdAttribute: 'data-test'/);
    assert.throws(() => saveRecording(root,'alpha',steps(),options), /already exists/);
    assert.throws(() => saveRecording(root,'alpha',steps().slice(0,1),options), /Record an action/);
    assert.equal((await runTests(root,{file:first.file,list:true})).code, 0);
  });
  it('rejects syntax errors and broken imports before saving', () => {
    const root = temporaryProject();
    assert.throws(() => validateGenerated([{path:'bad.spec.ts',content:'const x = ;'}],root), /validation failed/);
    assert.throws(() => validateGenerated([{path:'bad.spec.ts',content:"import {missing} from './missing'; missing();"}],root), /validation failed/);
  });
  it('emits an explicit error for unsupported coordinate-only scrolls', () => {
    const input = steps();
    input[1] = {...input[1],kind:'scrollIntoView',assertion:undefined,target:{ kind:'coords',chain:{frames:[],parts:[]},score:10,code:'',warnings:[],role:null,name:'',tag:'div',text:'',inputType:null,label:null,placeholder:null,testId:null,nameAttr:null,anchor:null,describe:'point' }};
    const text = generate(input, options).files.map(f=>f.content).join('\n');
    assert.match(text, /throw new Error\('Unsupported recorded scrollIntoView/);
  });
});

describe('framework native Playwright execution (verification fixtures, no business tests)', () => {
  it('rejects empty suites, empty modules and unmatched titles', async () => {
    const root = temporaryProject();
    for (const selection of [{},{module:'empty'}]) {
      const result = await runTests(root,selection);
      assert.notEqual(result.code,0); assert.equal(result.output,EMPTY_SUITE);
    }
    writeTest(root,'alpha','passing',"test('verification pass',async()=>expect(1).toBe(1));");
    assert.notEqual((await runTests(root,{title:'missing'})).code,0);
  });
  it('runs a literal selected file and module, preserves failure exit codes and writes native reports', async () => {
    const root = temporaryProject();
    const pass = writeTest(root,'beta[1]','passing',"test('verification pass',async()=>expect(1).toBe(1));");
    writeTest(root,'alpha','failing',"test('verification deliberate failure',async()=>expect(1).toBe(2));");
    assert.equal((await runTests(root,{file:pass})).code,0);
    assert.equal((await runTests(root,{module:'beta[1]'})).code,0);
    const result = await runTests(root,{});
    assert.equal(result.code,1);
    const report = JSON.parse(fs.readFileSync(path.join(root,'reports/results.json'),'utf8'));
    assert.equal(report.stats.expected,1); assert.equal(report.stats.unexpected,1);
    assert.ok(fs.existsSync(path.join(root,'reports/html/index.html')));
    assert.equal(fs.existsSync(path.join(root,'.framework-run.lock')),false);
    assert.throws(() => selectionArgs(root,{file:'../bad.spec.ts'}), /existing/);
  });
  it('blocks overlapping runs and preserves discovery syntax errors', async () => {
    const root=temporaryProject();
    fs.writeFileSync(path.join(root,'.framework-run.lock'),'verification');
    await assert.rejects(runTests(root,{}), /Another framework run/);
    fs.unlinkSync(path.join(root,'.framework-run.lock'));
    writeTest(root,'alpha','broken','const bad = ;');
    const result=await runTests(root,{});
    assert.notEqual(result.code,0); assert.notEqual(result.output,EMPTY_SUITE);
  });
});
