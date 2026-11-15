// Local side-panel server: one static HTML page + JSON API + Server-Sent Events.
// Binds to 127.0.0.1 only and rejects foreign Host headers and non-JSON posts.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { generate } from '../codegen/index';
import { pageClassName } from '../codegen/naming';
import { formatSaveReport, saveFiles, type SaveEntry } from '../codegen/save';
import { recordingFile } from '../commands/recording';
import type { Mode, RecorderSession, StepPatch } from '../recorder/session';
import type { GeneratedFile, GenerateOptions } from '../types';
import { discoverModules, moduleDirectory } from '../framework/modules';
import { frameworkPreview, recordingDestination, saveRecording } from '../framework/saving';
import { runTests } from '../framework/runner';
import { AiAssistant, AiError, buildPreview, type AiTask, type Provider, type AiStatus } from '../ai/assistant';

export interface PanelOptions {
  aiAssistant?: AiAssistant; // injectable provider transport for isolated verification
  frameworkRoot?: string;
  module?: string;
  port: number;
  outDir: string;
  gen: GenerateOptions;
  overwrite: boolean;
  cwd: string;
  log?: (m: string) => void;
}

export interface Panel {
  url: string;
  gen: GenerateOptions;
  userNamed: boolean;
  port: number;
  save(): SaveEntry[];
  files(): GeneratedFile[];
  state(): PanelState;
  close(): Promise<void>;
}

export interface PanelState {
  ai: AiStatus;
  editedFiles: string[];
  framework?: { modules: string[]; module: string; savedFile: string | null; run: { running: boolean; code: number | null; output: string } };
  status: 'recording' | 'paused' | 'busy';
  mode: Mode;
  url: string;
  pageObject: string;
  settle: { ms: number; timedOut: boolean } | null;
  lastError: string | null;
  steps: unknown[];
  options: GenerateOptions;
  files: GeneratedFile[];
  genError: string | null;
  outDir: string;
  lastSave: { at: number; report: string } | null;
  clickStyle: string;
}

const PUBLIC = path.join(__dirname, 'public', 'index.html');

export class PortInUseError extends Error {}

export async function startPanel(session: RecorderSession, opts: PanelOptions): Promise<Panel> {
  const clients = new Set<http.ServerResponse>();
  let lastSave: PanelState['lastSave'] = null;
  const gen = { ...opts.gen };
  const codeEdits = new Map<string, string>();
  const ai = opts.aiAssistant ?? new AiAssistant();
  const knownSecrets = () => session.steps.filter(s => s.secret && s.value).map(s => s.value!);
  let selectedModule = opts.module ?? '';
  let savedFile: string | null = null;
  let run = { running: false, code: null as number | null, output: '' };
  const api = { gen, userNamed: false } as Panel;
  const log = opts.log ?? (() => {});
  const debugDirectory = opts.frameworkRoot ? path.join(opts.frameworkRoot, '.tmp', 'recorder-debug') : path.join(opts.outDir, 'assets');

  const generatedFiles = (): GeneratedFile[] => opts.frameworkRoot && selectedModule
    ? frameworkPreview(opts.frameworkRoot, selectedModule, session.steps, gen).files
    : generate(session.steps, gen).files;
  const files = (): GeneratedFile[] => generatedFiles().map(f => ({ ...f, content: codeEdits.get(f.path) ?? f.content }));

  const state = (): PanelState => {
    const page = session.currentPage();
    const url = page && !page.isClosed() ? page.url() : '';
    let genFiles: GeneratedFile[] = [];
    let genError: string | null = null;
    try {
      genFiles = files();
    } catch (e) {
      genError = e instanceof Error ? e.message : String(e);
    }
    return {
      ai: ai.status(),
      editedFiles: [...codeEdits.keys()],
      framework: opts.frameworkRoot ? { modules: discoverModules(opts.frameworkRoot), module: selectedModule, savedFile, run } : undefined,
      status: session.mode === 'pause' ? 'paused' : session.busy ? 'busy' : 'recording',
      mode: session.mode,
      url,
      pageObject: url ? pageClassName(url) : '',
      settle: session.lastSettle,
      lastError: session.lastError,
      steps: session.steps,
      options: gen,
      files: genFiles,
      genError,
      outDir: opts.frameworkRoot && selectedModule ? (() => { try { return recordingDestination(opts.frameworkRoot!, selectedModule, gen.flowName); } catch { return opts.outDir; } })() : path.resolve(opts.outDir),
      lastSave,
      clickStyle: session.defaultClickStyle,
    };
  };

  const save = (): SaveEntry[] => {
    if (session.busy) throw new Error('Wait for the current recording action to finish before saving.');
    let entries: SaveEntry[];
    if (opts.frameworkRoot) {
      if (!api.userNamed) throw new Error('Enter a test case name before saving.');
      const saved = saveRecording(opts.frameworkRoot, selectedModule, session.steps, gen, files());
      savedFile = saved.file;
      entries = saved.entries;
    } else entries = saveFiles([...files(), recordingFile(session.steps, gen)], opts.outDir, { overwrite: opts.overwrite, cwd: opts.cwd });
    lastSave = { at: Date.now(), report: formatSaveReport(entries) };
    log('Saved:\n' + lastSave.report);
    broadcast();
    return entries;
  };

  // ---- push state to panel (SSE) and to the in-page toolbar, debounced
  let timer: NodeJS.Timeout | null = null;
  function broadcast() {
    if (timer) return;
    timer = setTimeout(async () => {
      timer = null;
      const s = state();
      const payload = `event: state\ndata: ${JSON.stringify(s)}\n\n`;
      for (const c of clients) c.write(payload);
      const toolbar = JSON.stringify({ steps: session.steps.length, mode: session.mode, clickStyle: session.defaultClickStyle });
      for (const p of session.pages) {
        if (p.isClosed()) continue;
        await p.mainFrame().evaluate(`window.__tphub && window.__tphub.onState && window.__tphub.onState(${toolbar})`).catch(() => {});
      }
    }, 120);
  }
  session.on('update', broadcast);
  session.on('save-request', () => {
    void session.flushPending().then(() => save()).catch(e => log('Save failed: ' + (e instanceof Error ? e.message : String(e))));
  });
  session.on('debug-request', () => {
    session
      .debugSnapshot(debugDirectory)
      .then((f) => log('Debug snapshot written:\n  ' + f.join('\n  ')))
      .catch((e) => log('Debug snapshot failed: ' + e.message));
  });

  const readBody = (req: http.IncomingMessage): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      let raw = '';
      req.on('data', (c) => {
        raw += c;
        if (raw.length > 1e6) req.destroy();
      });
      req.on('end', () => {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch {
          reject(new Error('Body is not valid JSON'));
        }
      });
    });

  const json = (res: http.ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  let port = opts.port;
  const server = http.createServer(async (req, res) => {
    try {
      const host = (req.headers.host ?? '').toLowerCase();
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
        res.writeHead(403);
        res.end('Forbidden host');
        return;
      }
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      const p = url.pathname;
      if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(fs.readFileSync(PUBLIC, 'utf8'));
        return;
      }
      if (req.method === 'GET' && p === '/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(`event: state\ndata: ${JSON.stringify(state())}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (req.method === 'GET' && p === '/api/state') return json(res, 200, state());
      if (req.method === 'GET' && p === '/api/files') return json(res, 200, files());
      if (req.method !== 'POST' && req.method !== 'DELETE') return json(res, 404, { error: 'not found' });
      if (req.method === 'POST' && !(req.headers['content-type'] ?? '').includes('application/json')) return json(res, 415, { error: 'send application/json' });
      const body = req.method === 'POST' ? await readBody(req) : {};
      const duplicate = /^\/api\/step\/([\w-]+)\/duplicate$/.exec(p);
      if (duplicate && req.method === 'POST') return json(res, session.duplicateStep(duplicate[1]) ? 200 : 404, state());
      const stepMatch = /^\/api\/step\/([\w-]+)(\/move)?$/.exec(p);
      if (stepMatch && req.method === 'DELETE') return json(res, session.deleteStep(stepMatch[1]) ? 200 : 404, state());
      if (stepMatch && stepMatch[2]) return json(res, session.moveStep(stepMatch[1], Number(body.to)) ? 200 : 404, state());
      if (stepMatch) return json(res, session.updateStep(stepMatch[1], body as StepPatch) ? 200 : 404, state());
      switch (p) {
        case '/api/ai/configure': {
          const settings=ai.configure({enabled:body.enabled===true,provider:String(body.provider) as Provider,model:String(body.model ?? ''),baseUrl:String(body.baseUrl ?? ''),apiKey:typeof body.apiKey==='string'?body.apiKey:undefined,maxOutputTokens:Number(body.maxOutputTokens ?? 1024),maxRequests:Number(body.maxRequests ?? 20)});
          broadcast();return json(res,200,{ai:settings});
        }
        case '/api/ai/clear':
          ai.clear();broadcast();return json(res,200,{ai:ai.status()});
        case '/api/ai/preview': {
          const file=files().find(f => f.path===body.file);
          if(!file)throw new AiError('Select a generated file to discuss.');
          if(!/\.(ts|json)$/.test(file.path))throw new AiError('Select a TypeScript or JSON file for AI assistance.');
          const preview=ai.mask(buildPreview(String(body.task) as AiTask,file,String(body.note ?? ''),run.output,knownSecrets()),knownSecrets());
          return json(res,200,{preview,file:file.path,ai:ai.status()});
        }
        case '/api/ai/ask': {
          const pending=ai.ask(String(body.task) as AiTask,ai.mask(String(body.preview ?? ''),knownSecrets()),body.approved===true);
          broadcast();
          try {return json(res,200,{result:await pending,ai:ai.status()});}
          finally {broadcast();}
        }
        case '/api/code': {
          const file = String(body.path);
          if (!generatedFiles().some(f => f.path === file) || !/\.(ts|json)$/.test(file) || typeof body.content !== 'string') throw new Error('Choose a generated TypeScript or JSON file to edit.');
          api.userNamed = true; // freeze the current name while manual source edits are active
          codeEdits.set(file, body.content);
          broadcast();
          return json(res, 200, state());
        }
        case '/api/code/reset':
          codeEdits.clear();
          broadcast();
          return json(res, 200, state());
        case '/api/modules':
          return json(res, 200, state());
        case '/api/module':
          if (!opts.frameworkRoot) throw new Error('Framework mode is not enabled.');
          moduleDirectory(opts.frameworkRoot, String(body.module));
          selectedModule = String(body.module);
          codeEdits.clear();
          savedFile = null;
          broadcast();
          return json(res, 200, state());
        case '/api/run': {
          if (!opts.frameworkRoot || !savedFile) throw new Error('Save a test before running it.');
          if (run.running) throw new Error('A test run is already active.');
          run = { running: true, code: null, output: '' };
          const append = (s: string) => { run.output = (run.output + s).slice(-40000); broadcast(); };
          void runTests(opts.frameworkRoot, { file: savedFile }, append).then(result => {
            run.code = result.code;
            run.output = result.output.slice(-40000);
          }).catch(e => { run.code = 1; run.output = e.message; }).finally(() => { run.running = false; broadcast(); });
          broadcast();
          return json(res, 202, state());
        }
        case '/api/mode':
          await session.setMode(String(body.mode) as Mode);
          return json(res, 200, state());
        case '/api/undo':
          session.undo();
          return json(res, 200, state());
        case '/api/clear':
          session.clear();
          return json(res, 200, state());
        case '/api/click-style':
          session.defaultClickStyle = (String(body.style) as typeof session.defaultClickStyle) || 'locator';
          broadcast();
          return json(res, 200, state());
        case '/api/options': {
          if (typeof body.flowName === 'string' && body.flowName.trim()) {
            if (gen.flowName !== body.flowName.trim()) codeEdits.clear();
            gen.flowName = body.flowName.trim();
            api.userNamed = true;
          }
          if (body.style === 'pom' || body.style === 'flat') { if (gen.style !== body.style) codeEdits.clear(); gen.style = body.style; }
          if (typeof body.coordsAsRatio === 'boolean') gen.coordsAsRatio = body.coordsAsRatio;
          broadcast();
          return json(res, 200, state());
        }
        case '/api/save':
          await session.flushPending();
          return json(res, 200, { entries: save(), state: state() });
        case '/api/debug':
          return json(res, 200, { files: await session.debugSnapshot(debugDirectory) });
        default:
          return json(res, 404, { error: 'not found' });
      }
    } catch (e) {
      json(res, e instanceof AiError ? e.status : 500, { error: e instanceof Error ? e.message : String(e), ai: ai.status() });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'EADDRINUSE') reject(new PortInUseError(`Port ${opts.port} is already in use. Start with another port, for example: --panel-port ${opts.port + 1}`));
      else reject(e);
    });
    server.listen(opts.port, '127.0.0.1', () => resolve());
  });
  port = (server.address() as AddressInfo).port;
  const keepAlive = setInterval(() => {
    for (const c of clients) c.write(': ping\n\n');
  }, 15000);

  Object.assign(api, {
    url: `http://127.0.0.1:${port}/`,
    port,
    save,
    files,
    state,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(keepAlive);
        for (const c of clients) c.end();
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  });
  return api;
}
