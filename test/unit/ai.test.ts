import assert from 'node:assert/strict';
import { describe,it } from 'node:test';
import { AiAssistant,AiError,buildPreview,redact,INPUT_LIMIT } from '../../src/ai/assistant';

const KEY='test-key-not-a-real-provider-credential';
function setup(provider:'gemini'|'groq'|'compatible'='gemini', reply?: (input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>) {
  let now=100000;const requests:{url:string;init:RequestInit}[]=[];
  const transport=(async (input:RequestInfo|URL,init?:RequestInit)=>{
    requests.push({url:String(input),init:init!});
    return reply?reply(input,init):new Response(JSON.stringify(provider==='gemini'?{candidates:[{content:{parts:[{text:'Suggested output'}]},finishReason:'STOP'}],usageMetadata:{totalTokenCount:30}}:{choices:[{message:{content:'Suggested output'},finish_reason:'stop'}],usage:{total_tokens:30}}),{status:200});
  }) as typeof fetch;
  const ai=new AiAssistant({env:{},fetch:transport,now:()=>now});
  const configure=()=>ai.configure({enabled:true,provider,model:provider==='gemini'?'gemini-2.5-flash-lite':'test/model',baseUrl:'https://provider.example/v1',apiKey:KEY,maxRequests:20,maxOutputTokens:512});
  return {ai,requests,configure,tick:(ms=15000)=>{now+=ms;}};
}

describe('optional AI provider adapters and free-tier controls (mock HTTP only)',()=>{
  it('makes no requests when disabled, missing approval or input exceeds its budget',async()=>{
    const {ai,requests,configure}=setup();
    await assert.rejects(ai.ask('improve','code',true),/disabled/);
    configure();await assert.rejects(ai.ask('improve','code',false),/approve/);
    await assert.rejects(ai.ask('improve','x'.repeat(INPUT_LIMIT+1),true),/at most/);
    assert.equal(requests.length,0);
  });
  it('builds bounded, editable, masked previews and refuses incomplete-file improvement',()=>{
    const preview=buildPreview('failure',{path:'specs/test.spec.ts',content:'const password = "private-password"; const apiKey="private-key";'},'Explain this','Bearer private-token',[KEY]);
    assert.ok(!preview.includes('private-password'));assert.ok(!preview.includes('private-key'));assert.ok(!preview.includes('private-token'));
    assert.ok(preview.length<=INPUT_LIMIT);
    assert.throws(()=>buildPreview('improve',{path:'big.ts',content:'x'.repeat(7001)},'',''),/too large/);
    assert.throws(()=>buildPreview('toString' as any,{path:'x',content:''},'',''),/Choose/);
    assert.equal(redact('prefix '+KEY,[KEY]),'prefix [REDACTED]');
  });
  it('uses Gemini headers, bounded generation and actual usage metadata without exposing the key',async()=>{
    const {ai,requests,configure}=setup();configure();
    const result=await ai.ask('improve','const text = "hello";',true);
    assert.equal(requests.length,1);const req=requests[0];
    assert.equal(req.url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent');
    assert.equal((req.init.headers as any)['x-goog-api-key'],KEY);assert.ok(!req.url.includes(KEY));
    assert.equal(JSON.parse(String(req.init.body)).generationConfig.maxOutputTokens,512);
    assert.equal(req.init.redirect,'error');assert.ok(req.init.signal);
    assert.equal(result.tokens,30);assert.equal(result.text,'Suggested output');
    assert.ok(!JSON.stringify(ai.status()).includes(KEY));
  });
  it('supports Groq and compatible chat-completion endpoints without SDK dependencies',async()=>{
    for(const provider of ['groq','compatible'] as const){
      const {ai,requests,configure}=setup(provider);configure();
      const result=await ai.ask('assertions','code',true);
      assert.equal(result.provider,provider);
      assert.equal(requests[0].url,provider==='groq'?'https://api.groq.com/openai/v1/chat/completions':'https://provider.example/v1/chat/completions');
      const body=JSON.parse(String(requests[0].init.body));assert.equal(body.max_tokens,512);assert.equal(body.stream,false);
      assert.equal((requests[0].init.headers as any).authorization,'Bearer '+KEY);
    }
  });
  it('rejects insecure or credential-bearing custom endpoints and invalid budgets',()=>{
    const {ai}=setup();
    for(const baseUrl of ['http://provider.example/v1','https://user:pass@provider.example/v1','https://provider.example/v1?key=secret']){
      assert.throws(()=>ai.configure({enabled:true,provider:'compatible',model:'model',baseUrl,apiKey:KEY}),/HTTPS/);
    }
    assert.throws(()=>ai.configure({model:'model',maxOutputTokens:10000}),/integer/);
    assert.throws(()=>ai.configure({enabled:true,model:'model',apiKey:'line1\nline2'}),/single line/);
  });
  it('caches exact requests without consuming more budget and enforces the session cap',async()=>{
    const {ai,requests,configure,tick}=setup();configure();ai.configure({enabled:true,maxRequests:1});
    await ai.ask('failure','same input',true);
    const cached=await ai.ask('failure','same input',true);
    assert.equal(cached.cached,true);assert.equal(ai.status().requestsUsed,1);assert.equal(requests.length,1);
    tick();await assert.rejects(ai.ask('failure','different input',true),/budget reached/);assert.equal(requests.length,1);
    ai.configure({enabled:true,maxRequests:2});assert.equal(ai.status().requestsUsed,1);
  });
  it('enforces pacing and provider Retry-After without automatic retries or fallback',async()=>{
    const {ai,requests,configure,tick}=setup('gemini',async()=>new Response('quota response',{status:429,headers:{'retry-after':'120'}}));
    configure();await assert.rejects(ai.ask('failure','input',true),/quota\/rate/);
    assert.equal(requests.length,1);assert.equal(ai.status().retryAfterSeconds,120);
    await assert.rejects(ai.ask('failure','input 2',true),/wait/);assert.equal(requests.length,1);
    tick(120000);await assert.rejects(ai.ask('failure','input 2',true),/quota\/rate/);assert.equal(requests.length,2);
  });
  it('serializes requests and prevents settings or key changes during a request',async()=>{
    let finish!:(r:Response)=>void;
    const {ai,configure,requests}=setup('gemini',()=>new Promise(r=>{finish=r;}));configure();
    const first=ai.ask('failure','input',true);
    await assert.rejects(ai.ask('failure','second',true),/already running/);
    assert.throws(()=>ai.configure({enabled:false}),/current AI request/);assert.throws(()=>ai.clear(),/active request/);
    finish(new Response(JSON.stringify({candidates:[{content:{parts:[{text:'done'}]}}]})));
    await first;assert.equal(requests.length,1);assert.equal(ai.status().busy,false);
  });
  it('does not expose keys through errors or model output, and makes no network retries',async()=>{
    const failure=setup('gemini',async()=>{throw new Error('network details '+KEY);});failure.configure();
    await assert.rejects(failure.ai.ask('failure','input',true),(e:AiError)=>!e.message.includes(KEY)&&e.message.includes('timed out'));
    assert.equal(failure.requests.length,1);
    const echo=setup('gemini',async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{text:KEY}]}}]})));echo.configure();
    assert.equal((await echo.ai.ask('failure',KEY,true)).text,'[REDACTED]');
    assert.ok(!String(echo.requests[0].init.body).includes(KEY));
  });
  it('handles authentication, model, malformed JSON, empty and oversized responses explicitly',async()=>{
    for(const status of [400,401,403,404,500]){
      const {ai,configure,requests}=setup('gemini',async()=>new Response('private provider error '+KEY,{status}));configure();
      await assert.rejects(ai.ask('failure','input',true),(e:AiError)=>e.status===502&&!e.message.includes(KEY));assert.equal(requests.length,1);
    }
    for(const body of ['invalid-json','{}','x'.repeat(131073)]){
      const {ai,configure}=setup('gemini',async()=>new Response(body));configure();await assert.rejects(ai.ask('failure','input',true),AiError);
    }
  });
  it('flags token truncation and clears session credentials without persisting them',async()=>{
    const {ai,configure}=setup('gemini',async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{text:'partial code'}]},finishReason:'MAX_TOKENS'}]})));configure();
    assert.equal((await ai.ask('improve','input',true)).truncated,true);
    ai.clear();assert.equal(ai.status().enabled,false);assert.equal(ai.status().hasKey,false);
    assert.throws(()=>ai.configure({enabled:true,provider:'groq',model:'another-model'}),/API key/);
  });
});
