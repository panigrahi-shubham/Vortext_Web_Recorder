// The recording session: launches the browser, receives events from the page,
// verifies locators, replays actions, waits for the page to settle, diffs snapshots
// and owns the step list. Every browser operation runs under one AsyncLock.
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, firefox, webkit, selectors, type Browser, type BrowserContext, type Dialog, type Download, type Frame, type Page } from 'playwright';
import { generate } from '../codegen/index';
import { containerPart } from '../locators/candidates';
import { describeChain, renderChain, toLocator } from '../locators/render';
import { chooseLocator, frameSelectors, toTargetRef } from '../locators/verify';
import { diffSnapshots, urlRegexSource } from '../suggest/suggest';
import type {
  ActionKind,
  AssertType,
  ClickStyle,
  ElementDescriptor,
  GeneratedFile,
  GenerateOptions,
  LocatorChoice,
  RankedCandidate,
  Step,
  TargetRef,
} from '../types';
import { AsyncLock } from '../util/lock';
import { readTextFile } from '../util/files';
import { buildInitScript } from './inject';
import { NetworkTracker, waitForSettle } from './settle';
import { headingOf, resolveSuggestions, resolveVolatile, takeSnapshot, type SnapshotResult } from './snapshot';

export type Mode = 'record' | 'actions' | 'assert' | 'waitfor' | 'inspect' | 'pause' | 'hover' | 'scroll' | 'drag';

export interface SessionOptions {
  url: string;
  viewport: { width: number; height: number };
  browser?: 'chromium' | 'firefox' | 'webkit';
  headless?: boolean;
  storageState?: string;
  testIdAttr: string;
  allowCss?: boolean;
  ui?: boolean;
  quietMs?: number;
  settleTimeoutMs?: number;
  pageFlags?: { axe?: boolean; screenshots?: boolean };
  log?: (msg: string) => void;
}

/** What the in-page script sends. */
export interface PageEvent {
  inputMode?: 'fill' | 'type' | 'append';
  typingDelay?: number;
  type: string;
  target?: ElementDescriptor | null;
  target2?: ElementDescriptor | null;
  value?: string;
  values?: string[];
  files?: string[];
  key?: string;
  secret?: boolean;
  applied?: boolean;
  x?: number;
  y?: number;
  vw?: number;
  vh?: number;
  assertType?: AssertType;
  expected?: string | number;
  attrName?: string;
}

export interface StepPatch {
  inputMode?: 'fill' | 'type' | 'append';
  typingDelay?: number;
  preAssert?: boolean;
  clickStyle?: ClickStyle;
  suggestion?: { id: string; accepted: boolean };
  dialogAction?: 'accept' | 'dismiss';
  comment?: string;
  alternative?: number; // index into step.alternatives
  value?: string;
}

const CLICK_KINDS = new Set(['click', 'dblclick', 'rightclick']);

export class RecorderSession extends EventEmitter {
  browser!: Browser;
  context!: BrowserContext;
  pages: Page[] = [];
  steps: Step[] = [];
  mode: Mode = 'record';
  lastSettle: { ms: number; timedOut: boolean } | null = null;
  lastError: string | null = null;
  private lock = new AsyncLock();
  private trackers = new WeakMap<Page, NetworkTracker>();
  private lastSnap = new WeakMap<Page, SnapshotResult>();
  private current: Step | null = null;
  private seq = 0;
  private clipboard: { value: string; secret: boolean } | null = null;
  private eventCounter = 0;
  private lastStepDoneAt = 0;
  private knownUrl = new WeakMap<Page, string>();
  private log: (m: string) => void;

  constructor(readonly opts: SessionOptions) {
    super();
    this.log = opts.log ?? (() => {});
  }

  static async launch(opts: SessionOptions): Promise<RecorderSession> {
    const s = new RecorderSession(opts);
    try {
      await s.init();
      return s;
    } catch (error) {
      await s.close();
      throw error;
    }
  }

  get busy(): boolean {
    return this.lock.busy;
  }

  private async init(): Promise<void> {
    const engine = { chromium, firefox, webkit }[this.opts.browser ?? 'chromium'];
    if (this.opts.testIdAttr !== 'data-testid') selectors.setTestIdAttribute(this.opts.testIdAttr);
    // We handle Ctrl+C ourselves (save first, then close), so Playwright must not exit for us.
    this.browser = await engine.launch({ headless: this.opts.headless ?? false, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });
    let storageState: string | undefined;
    if (this.opts.storageState) {
      if (!fs.existsSync(this.opts.storageState)) throw new Error(`--storage-state file not found: ${this.opts.storageState}`);
      // PowerShell may have written it as UTF-16; Playwright expects UTF-8 JSON.
      const parsed = JSON.parse(readTextFile(this.opts.storageState));
      this.context = await this.browser.newContext({ viewport: this.opts.viewport, storageState: parsed, acceptDownloads: true });
    } else {
      this.context = await this.browser.newContext({ viewport: this.opts.viewport, storageState, acceptDownloads: true });
    }
    await this.context.exposeBinding('__tphubEmit', (source, evt: PageEvent) => {
      this.eventCounter++;
      void this.enqueue(source.page, source.frame, evt);
    });
    await this.context.exposeBinding('__tphubCall', (source, cmd: string, payload: unknown) => this.onCall(source.page, source.frame, cmd, payload));
    await this.context.addInitScript({ content: buildInitScript({ testIdAttr: this.opts.testIdAttr, capture: true, ui: !!this.opts.ui, mode: this.mode, ...this.opts.pageFlags }) });
    this.context.on('page', (p) => this.wirePage(p));
  }

  private wirePage(p: Page): void {
    if (this.pages.includes(p)) return;
    this.pages.push(p);
    const tracker = new NetworkTracker();
    tracker.attach(p);
    this.trackers.set(p, tracker);
    p.on('dialog', (d) => void this.onDialog(d));
    p.on('download', (d) => this.onDownload(d));
    p.on('framenavigated', (f) => this.onNavigated(p, f));
    p.on('close', () => this.emitUpdate());
    const tab = this.pages.indexOf(p);
    // the popup event can arrive after the step that opened it was finished
    const recent = !this.current && Date.now() - this.lastStepDoneAt < 3000 ? this.steps[this.steps.length - 1] : null;
    const opener = this.current ?? (recent && recent.kind !== 'goto' && !recent.popup ? recent : null);
    if (opener && tab > 0 && !opener.popup) {
      const step = opener;
      step.popup = { tab, url: p.url() };
      p.waitForLoadState('domcontentloaded').then(() => (step.popup!.url = p.url())).catch(() => {});
    }
    this.emitUpdate();
  }

  /** Open the first page and record the initial goto step. */
  async start(): Promise<void> {
    await this.lock.run(async () => {
      const page = await this.context.newPage();
      this.wirePage(page);
      await page.goto(this.opts.url, { waitUntil: 'domcontentloaded' });
      const settle = await waitForSettle(page, this.trackers.get(page)!, { quietMs: this.opts.quietMs, timeoutMs: this.opts.settleTimeoutMs });
      const snap = await takeSnapshot(page);
      this.lastSnap.set(page, snap);
      this.knownUrl.set(page, page.url());
      this.push({
        ...this.newStep('goto', null, { url: page.url(), title: snap.snap.title, heading: headingOf(snap.snap), tab: 0 }),
        value: page.url(),
        settleMs: settle.ms,
        settleTimedOut: settle.timedOut,
      });
    });
  }

  // ---------------------------------------------------------------- events

  private enqueue(page: Page, frame: Frame, evt: PageEvent): Promise<void> {
    return this.lock.run(async () => {
      if (this.mode === 'pause') return;
      try {
        await this.process(page, frame, evt);
        this.lastError = null;
      } catch (e) {
        this.current = null;
        this.lastError = e instanceof Error ? e.message.split('\n')[0] : String(e);
        this.log(`Could not record ${evt.type}: ${this.lastError}`);
        this.emitUpdate();
      }
    });
  }

  /** Wait until the page has reported everything and every queued job is done. */
  async idle(quietMs = 400): Promise<void> {
    for (let i = 0; i < 50; i++) {
      const before = this.eventCounter;
      await new Promise((r) => setTimeout(r, quietMs));
      await this.lock.idle();
      if (this.eventCounter === before && !this.lock.busy) return;
    }
  }

  /** Commit the final typed field and any delayed click before an explicit save. */
  async flushPending(): Promise<void> {
    for (const page of this.pages) {
      if (page.isClosed()) continue;
      for (const frame of page.frames()) {
        await frame.evaluate('window.__tphub && (window.__tphub.flushFills(), window.__tphub.sendPendingClick())').catch(() => {});
      }
    }
    await this.idle(250);
  }

  private async process(page: Page, frame: Frame, evt: PageEvent): Promise<void> {
    switch (evt.type) {
      case 'copyText':
      case 'pasteText':
        return this.processAction(page, frame, evt);
      case 'click':
      case 'dblclick':
      case 'rightclick':
      case 'hover':
      case 'scrollIntoView':
        return this.processAction(page, frame, evt);
      case 'press':
        return this.processAction(page, frame, evt);
      case 'drag':
        return this.processAction(page, frame, evt);
      case 'fill':
      case 'select':
      case 'upload':
      case 'check':
      case 'uncheck':
        return evt.applied ? this.processApplied(page, frame, evt) : this.processAction(page, frame, evt);
      case 'assert':
        return this.processAssert(page, frame, evt);
      case 'waitVisible':
      case 'waitHidden':
        return this.processWait(page, frame, evt);
      default:
        this.log(`Ignored unknown event ${evt.type}`);
    }
  }

  private pageInfo(page: Page, snap: SnapshotResult): Step['page'] {
    return { url: snap.snap.url || page.url(), title: snap.snap.title, heading: headingOf(snap.snap), tab: Math.max(0, this.pages.indexOf(page)) };
  }

  private newStep(kind: ActionKind, target: TargetRef | null, page: Step['page']): Step {
    return {
      id: `step-${++this.seq}`,
      kind,
      target,
      page,
      preAssert: kind !== 'goto' && !!target,
      clickStyle: target && target.kind === 'coords' ? 'coords' : 'locator',
      suggestions: [],
      warnings: [...(target?.warnings ?? [])],
      createdAt: Date.now(),
    };
  }

  private async snapshotFresh(page: Page, frame: Frame | null): Promise<SnapshotResult> {
    const s = await takeSnapshot(page, frame);
    await resolveVolatile(s, !!this.opts.allowCss);
    return s;
  }

  private async targetKey(frame: Frame, d: ElementDescriptor | null | undefined): Promise<string | null> {
    if (!d?.targetId) return null;
    try {
      const key = (await frame.evaluate(`(function(){var e=window.__tphub.getTarget(${Number(d.targetId)});return e?window.__tphub.pathOf(e):null})()`)) as string | null;
      if (!key) return null;
      if (frame.parentFrame()) return 'frame:' + (await frameSelectors(frame)).join('>') + '|' + key;
      return key;
    } catch {
      return null;
    }
  }

  private async absolutePoint(frame: Frame, evt: PageEvent, d: ElementDescriptor | null | undefined, page: Page) {
    let x = evt.x ?? (d ? d.rect.x + d.rect.width / 2 : 0);
    let y = evt.y ?? (d ? d.rect.y + d.rect.height / 2 : 0);
    if (frame.parentFrame()) {
      const box = await (await frame.frameElement()).boundingBox().catch(() => null);
      if (box) {
        x += box.x;
        y += box.y;
      }
    }
    const vp = page.viewportSize() ?? this.opts.viewport;
    return { x: Math.round(x), y: Math.round(y), vw: vp.width, vh: vp.height };
  }

  private async choose(frame: Frame, d: ElementDescriptor): Promise<LocatorChoice> {
    return chooseLocator(frame, d, { allowCss: !!this.opts.allowCss });
  }

  private async withSuppress<T>(frame: Frame, job: () => Promise<T>): Promise<T> {
    const frames = frame.page().frames();
    for (const f of frames) await f.evaluate('window.__tphub && window.__tphub.suppress++').catch(() => {});
    try {
      return await job();
    } finally {
      for (const f of frames) if (!f.isDetached()) await f.evaluate('window.__tphub && (window.__tphub.suppress = Math.max(0, window.__tphub.suppress - 1))').catch(() => {});
    }
  }

  /** Intercepted user action: verify locator, replay through it, settle, diff. */
  private async processAction(page: Page, frame: Frame, evt: PageEvent): Promise<void> {
    const d = evt.target ?? null;
    const before = await this.snapshotFresh(page, frame);
    const choice: LocatorChoice | null = d ? await this.choose(frame, d) : null;
    const target = choice && d ? toTargetRef(choice, d) : null;
    let kind = evt.type as ActionKind;
    if (kind === 'click' && d && (d.inputType === 'checkbox' || d.inputType === 'radio' || d.role === 'checkbox' || d.role === 'radio' || d.role === 'switch')) {
      kind = d.inputType === 'radio' || d.role === 'radio' ? 'check' : d.checked ? 'uncheck' : 'check';
    }
    const step = this.newStep(kind, target, this.pageInfo(page, before));
    step.secret = !!evt.secret;
    if (kind === 'fill') {
      step.value = evt.value ?? '';
      step.secret = !!evt.secret;
      step.inputMode = evt.inputMode ?? 'fill';
      step.typingDelay = Math.max(0, Math.min(1000, Number(evt.typingDelay) || 0));
    }
    if (kind === 'select') step.values = evt.values ?? [];
    if (kind === 'press') step.value = evt.key;
    if (d && (CLICK_KINDS.has(kind) || kind === 'check' || kind === 'uncheck')) {
      step.coords = await this.absolutePoint(frame, evt, d, page);
      if (CLICK_KINDS.has(kind) && step.clickStyle === 'locator') step.clickStyle = this.defaultClickStyle;
    }
    let choice2: LocatorChoice | null = null;
    if (kind === 'drag' && evt.target2) {
      choice2 = await this.choose(frame, evt.target2);
      step.target2 = toTargetRef(choice2, evt.target2);
    }
    step.alternatives = choice?.alternatives.filter((a) => a.usable).slice(0, 5);
    const actionKey = await this.targetKey(frame, d);
    this.current = step;
    const tracker = this.trackers.get(page)!;
    await this.withSuppress(frame, async () => {
      try {
        await this.replay(page, frame, step, choice, choice2);
      } catch (e) {
        const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
        if (step.coords && CLICK_KINDS.has(kind)) {
          step.warnings.push(`replaying through the locator failed (${msg}); clicked the recorded point instead`);
          step.clickStyle = 'coords';
          await page.mouse.click(step.coords.x, step.coords.y, { button: kind === 'rightclick' ? 'right' : 'left', clickCount: kind === 'dblclick' ? 2 : 1 });
        } else throw e;
      }
    });
    const settle = await waitForSettle(page, tracker, { quietMs: this.opts.quietMs, timeoutMs: this.opts.settleTimeoutMs });
    this.lastSettle = { ms: settle.ms, timedOut: settle.timedOut };
    step.settleMs = settle.ms;
    step.settleTimedOut = settle.timedOut;
    if (settle.timedOut) step.warnings.push(`page did not settle within ${(this.opts.settleTimeoutMs ?? 8000) / 1000} s: ${settle.reason}`);
    else if (settle.ms >= 2000) step.warnings.push(`slow: took ${(settle.ms / 1000).toFixed(1)} s to settle`);
    if (page.isClosed()) {
      this.finish(step, page);
      return;
    }
    const after = await this.snapshotFresh(page, frame.isDetached() ? null : frame);
    this.lastSnap.set(page, after);
    const raws = diffSnapshots(before.snap, after.snap, { actionKind: kind, actionKey });
    step.suggestions = await resolveSuggestions(raws, before, after, { allowCss: !!this.opts.allowCss, idPrefix: step.id });
    if (step.secret || kind === 'copyText' || kind === 'pasteText') step.suggestions = [];
    if (kind === 'fill') step.suggestions.forEach(s => { s.accepted = false; });
    this.finish(step, page);
  }

  private async replay(page: Page, frame: Frame, step: Step, choice: LocatorChoice | null, choice2: LocatorChoice | null): Promise<void> {
    const best = choice?.best;
    const useLocator = best && best.usable && best.kind !== 'coords';
    const loc = useLocator ? toLocator(frame, best!.chain, true) : null;
    const timeout = 5000;
    if (['fill', 'select', 'copyText', 'pasteText'].includes(step.kind) && !loc) throw new Error(`${step.kind} requires a verified element locator.`);
    if ((!loc && ['hover', 'scrollIntoView', 'drag'].includes(step.kind)) ||
        (step.kind === 'drag' && (!choice2?.best.usable || choice2.best.kind === 'coords'))) {
      step.warnings.push(`Unsupported ${step.kind}: no usable locator; generated test will stop until this step is corrected.`);
      return;
    }
    switch (step.kind) {
      case 'fill':
        if (step.inputMode === 'type' || step.inputMode === 'append') {
          if (step.inputMode === 'type') await loc!.fill('', { timeout });
          else { await loc!.focus({ timeout }); await loc!.press('ControlOrMeta+End', { timeout }); }
          await loc!.pressSequentially(step.value ?? '', { delay: step.typingDelay ?? 0, timeout });
        } else await loc!.fill(step.value ?? '', { timeout });
        return;
      case 'select':
        await loc!.selectOption((step.values ?? []).map(value => ({ value })), { timeout });
        return;
      case 'copyText': {
        const result = await loc!.evaluate((el: Element) => ({
          value: 'value' in el ? String((el as HTMLInputElement).value) : (el as HTMLElement).innerText ?? el.textContent ?? '',
          secret: el.getAttribute('type') === 'password' || /token|secret|apikey|api-key|api_key|otp|one-time-code|passcode|pin\b/i.test([el.id, el.getAttribute('name'), el.getAttribute('autocomplete')].join(' ')),
        }));
        this.clipboard = result;
        step.secret = result.secret;
        return;
      }
      case 'pasteText':
        if (!this.clipboard) throw new Error('Copy value/text from an element before using recorder Paste.');
        step.secret = step.secret || this.clipboard.secret;
        await loc!.fill(this.clipboard.value, { timeout });
        return;
      case 'click':
        if (loc) await loc.click({ timeout });
        else if (step.coords) await page.mouse.click(step.coords.x, step.coords.y);
        return;
      case 'dblclick':
        if (loc) await loc.dblclick({ timeout });
        else if (step.coords) await page.mouse.dblclick(step.coords.x, step.coords.y);
        return;
      case 'rightclick':
        if (loc) await loc.click({ button: 'right', timeout });
        else if (step.coords) await page.mouse.click(step.coords.x, step.coords.y, { button: 'right' });
        return;
      case 'check':
        if (loc) await loc.check({ timeout });
        else if (step.coords) await page.mouse.click(step.coords.x, step.coords.y);
        return;
      case 'uncheck':
        if (loc) await loc.uncheck({ timeout });
        else if (step.coords) await page.mouse.click(step.coords.x, step.coords.y);
        return;
      case 'hover':
        if (loc) await loc.hover({ timeout });
        return;
      case 'scrollIntoView':
        if (loc) await loc.scrollIntoViewIfNeeded({ timeout });
        return;
      case 'press':
        if (loc) await loc.press(step.value ?? 'Enter', { timeout });
        else await page.keyboard.press(step.value ?? 'Enter');
        return;
      case 'drag': {
        const b2 = choice2?.best;
        if (loc && b2 && b2.usable && b2.kind !== 'coords') await loc.dragTo(toLocator(frame, b2.chain, true), { timeout });
        return;
      }
      default:
        return;
    }
  }

  /** Field changes the browser already applied (typing, select, file pick). */
  private async processApplied(page: Page, frame: Frame, evt: PageEvent): Promise<void> {
    const d = evt.target!;
    let before = this.lastSnap.get(page);
    if (!before || before.snap.url !== page.url()) before = await this.snapshotFresh(page, frame);
    const choice = await this.choose(frame, d);
    const target = toTargetRef(choice, d);
    const kind = evt.type as ActionKind;
    // typing into the same field again: update the previous fill instead of adding a step
    const prev = this.steps[this.steps.length - 1];
    if (kind === 'fill' && prev && prev.kind === 'fill' && (!prev.inputMode || prev.inputMode === 'fill') && prev.target?.code === target.code) {
      prev.value = evt.value ?? '';
      prev.secret = prev.secret || !!evt.secret;
      this.emitUpdate();
      return;
    }
    const step = this.newStep(kind, target, this.pageInfo(page, before));
    step.alternatives = choice.alternatives.filter((a) => a.usable).slice(0, 5);
    if (kind === 'fill') {
      step.value = evt.value ?? '';
      step.secret = !!evt.secret;
      if (evt.secret) step.warnings.push('looks like a secret: it will be masked in the fixtures file and read from an environment variable');
    }
    if (kind === 'select') step.values = evt.values ?? [];
    if (kind === 'upload') step.files = evt.files ?? [];
    const actionKey = await this.targetKey(frame, d);
    const settle = await waitForSettle(page, this.trackers.get(page)!, { quietMs: Math.min(200, this.opts.quietMs ?? 300), timeoutMs: 3000 });
    step.settleMs = settle.ms;
    const after = await this.snapshotFresh(page, frame);
    this.lastSnap.set(page, after);
    const raws = diffSnapshots(before.snap, after.snap, { actionKind: kind, actionKey });
    step.suggestions = await resolveSuggestions(raws, before, after, { allowCss: !!this.opts.allowCss, idPrefix: step.id });
    // a fill rarely needs a post-check: keep suggestions but do not tick them by default
    if (kind === 'fill') step.suggestions.forEach((s) => (s.accepted = false));
    this.finish(step, page);
  }

  private async processAssert(page: Page, frame: Frame, evt: PageEvent): Promise<void> {
    const snap = await takeSnapshot(page, frame);
    const type = evt.assertType ?? 'visible';
    let target: TargetRef | null = null;
    let expected = evt.expected;
    let regex = false;
    if (type === 'urlMatches') {
      expected = typeof expected === 'string' && expected ? expected : urlRegexSource(page.url());
      regex = true;
    } else if (type === 'titleMatches') {
      expected = typeof expected === 'string' && expected ? expected : await page.title();
    } else if (type !== 'a11y' && type !== 'screenshot' && evt.target) {
      if (type === 'countEquals' && evt.target.repeat) {
        target = await this.groupTarget(frame, evt.target);
        if (target) expected = Number(expected ?? (await toLocator(frame, target.chain, true).count()));
      }
      if (!target) {
        const choice = await this.choose(frame, evt.target);
        target = toTargetRef(choice, evt.target);
      }
    } else if (type === 'screenshot' && evt.target) {
      target = toTargetRef(await this.choose(frame, evt.target), evt.target);
    }
    const step = this.newStep('assert', target, this.pageInfo(page, snap));
    step.preAssert = false;
    step.assertion = { type, target, expected, regex, attrName: evt.attrName };
    this.finish(step, page);
  }

  private async groupTarget(frame: Frame, d: ElementDescriptor): Promise<TargetRef | null> {
    const part = d.repeat ? containerPart(d.repeat) : null;
    if (!part) return null;
    const chain = { frames: await frameSelectors(frame), parts: [part] };
    return {
      chain,
      code: renderChain(chain),
      score: 70,
      kind: part.kind === 'role' ? 'role' : part.kind === 'testId' ? 'testId' : 'css',
      warnings: [],
      role: d.repeat!.containerRole,
      name: '',
      tag: d.repeat!.containerTag,
      text: '',
      inputType: null,
      label: null,
      placeholder: null,
      testId: d.repeat!.containerTestId,
      nameAttr: null,
      anchor: null,
      describe: describeChain(chain) + ' items',
    };
  }

  private async processWait(page: Page, frame: Frame, evt: PageEvent): Promise<void> {
    const snap = await takeSnapshot(page, frame);
    const choice = await this.choose(frame, evt.target!);
    const step = this.newStep(evt.type as ActionKind, toTargetRef(choice, evt.target!), this.pageInfo(page, snap));
    step.preAssert = false;
    this.finish(step, page);
  }

  private finish(step: Step, page: Page): void {
    this.current = null;
    if (!page.isClosed()) this.knownUrl.set(page, page.url());
    this.lastStepDoneAt = Date.now();
    this.push(step);
  }

  private push(step: Step): void {
    this.steps.push(step);
    this.emitUpdate();
  }

  private async onDialog(d: Dialog): Promise<void> {
    const step = this.current;
    if (step) step.dialog = { type: d.type(), message: d.message(), action: 'accept' };
    try {
      if (d.type() === 'prompt') await d.accept(d.defaultValue());
      else await d.accept();
    } catch {
      /* already handled */
    }
  }

  private onDownload(d: Download): void {
    if (this.current) this.current.download = { suggestedFilename: d.suggestedFilename() };
  }

  private onNavigated(page: Page, f: Frame): void {
    if (f !== page.mainFrame()) return;
    const url = f.url();
    const known = this.knownUrl.get(page);
    if (!known || url === known || url === 'about:blank') return;
    // navigation the user started from the address bar (not caused by a recorded step)
    if (this.lock.busy || this.current || Date.now() - this.lastStepDoneAt < 1500) {
      return;
    }
    this.knownUrl.set(page, url);
    void this.lock.run(async () => {
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      const snap = await takeSnapshot(page).catch(() => null);
      if (snap) this.lastSnap.set(page, snap);
      const step = this.newStep('goto', null, { url, title: snap?.snap.title ?? '', heading: snap ? headingOf(snap.snap) : null, tab: Math.max(0, this.pages.indexOf(page)) });
      step.value = url;
      this.push(step);
    });
  }

  // ---------------------------------------------------------------- calls from the toolbar

  private async onCall(page: Page, frame: Frame, cmd: string, payload: unknown): Promise<unknown> {
    switch (cmd) {
      case 'hello':
        return { mode: this.mode, steps: this.steps.length };
      case 'inspect': {
        if (this.lock.busy) return { busy: true };
        const d = payload as ElementDescriptor;
        return this.lock.run(async () => {
          const choice = await this.choose(frame, d);
          return { best: slim(choice.best), alternatives: choice.alternatives.slice(0, 8).map(slim) };
        });
      }
      case 'author': {
        if (this.mode !== 'actions') throw new Error('Switch to Actions mode first.');
        const evt = payload as PageEvent;
        if (!['fill', 'press', 'select', 'check', 'uncheck', 'copyText', 'pasteText'].includes(evt.type) || !evt.target) throw new Error('Unsupported authored action.');
        await this.flushPending();
        const before = this.steps.length;
        await this.enqueue(page, frame, { ...evt, applied: false });
        return this.steps.length > before ? { ok: true } : { error: this.lastError ?? 'Action was not recorded.' };
      }
      case 'count': {
        const d = payload as ElementDescriptor;
        return this.lock.run(async () => {
          const g = await this.groupTarget(frame, d);
          return g ? { code: g.code, count: await toLocator(frame, g.chain, true).count() } : null;
        });
      }
      case 'setMode':
        await this.setMode(String(payload) as Mode);
        return { mode: this.mode };
      case 'undo':
        this.undo();
        return { steps: this.steps.length };
      case 'clear':
        this.clear();
        return { steps: this.steps.length };
      case 'save':
        this.emit('save-request');
        return { ok: true };
      case 'setClickStyle':
        this.defaultClickStyle = String(payload) as ClickStyle;
        this.emitUpdate();
        return { clickStyle: this.defaultClickStyle };
      case 'debug':
        this.emit('debug-request');
        return { ok: true };
      default:
        return { error: 'unknown command ' + cmd };
    }
  }

  defaultClickStyle: ClickStyle = 'locator';

  // ---------------------------------------------------------------- commands (panel and toolbar)

  async setMode(mode: Mode): Promise<void> {
    this.mode = mode;
    for (const p of this.pages) {
      if (p.isClosed()) continue;
      for (const f of p.frames()) {
        await f
          .evaluate(`window.__tphub && (window.__tphub.mode = ${JSON.stringify(mode)}, window.__tphub.onModeChanged && window.__tphub.onModeChanged())`)
          .catch(() => {});
      }
    }
    this.emitUpdate();
  }

  undo(): Step | null {
    if (this.steps.length <= 1) return null;
    const s = this.steps.pop()!;
    this.emitUpdate();
    return s;
  }

  clear(): void {
    this.steps = this.steps.filter((s, i) => i === 0 && s.kind === 'goto');
    this.emitUpdate();
  }

  deleteStep(id: string): boolean {
    const i = this.steps.findIndex((s) => s.id === id);
    if (i < 0) return false;
    this.steps.splice(i, 1);
    this.emitUpdate();
    return true;
  }

  duplicateStep(id: string): Step | null {
    const index = this.steps.findIndex(s => s.id === id);
    if (index < 0 || this.steps[index].kind === 'goto') return null;
    const copy = structuredClone(this.steps[index]);
    copy.id = `step-${++this.seq}`;
    copy.createdAt = Date.now();
    copy.warnings.push('Duplicated in the editor; not replayed during recording.');
    this.steps.splice(index + 1, 0, copy);
    this.emitUpdate();
    return copy;
  }

  moveStep(id: string, to: number): boolean {
    const i = this.steps.findIndex((s) => s.id === id);
    if (i < 0) return false;
    const [s] = this.steps.splice(i, 1);
    this.steps.splice(Math.max(0, Math.min(to, this.steps.length)), 0, s);
    this.emitUpdate();
    return true;
  }

  updateStep(id: string, patch: StepPatch): Step | null {
    const s = this.steps.find((x) => x.id === id);
    if (!s) return null;
    if (patch.preAssert !== undefined) s.preAssert = patch.preAssert;
    if (patch.clickStyle && (s.coords || patch.clickStyle === 'locator')) s.clickStyle = patch.clickStyle;
    if (patch.suggestion) {
      const sug = s.suggestions.find((x) => x.id === patch.suggestion!.id);
      if (sug) sug.accepted = patch.suggestion.accepted;
    }
    if (patch.dialogAction && s.dialog) s.dialog.action = patch.dialogAction;
    if (patch.comment !== undefined) s.comment = patch.comment || undefined;
    if (patch.value !== undefined && s.kind === 'fill') s.value = patch.value;
    if (patch.inputMode !== undefined && s.kind === 'fill' && ['fill', 'type', 'append'].includes(patch.inputMode)) s.inputMode = patch.inputMode;
    if (patch.typingDelay !== undefined && s.kind === 'fill') s.typingDelay = Math.max(0, Math.min(1000, Number(patch.typingDelay) || 0));
    if (patch.alternative !== undefined && s.alternatives && s.target) {
      const alt = s.alternatives[patch.alternative];
      if (alt) {
        const old = s.target;
        s.target = { ...old, chain: alt.chain, code: alt.code, score: alt.score, kind: alt.kind, warnings: alt.warnings, anchor: alt.anchor ?? null, describe: describeChain(alt.chain) };
        // keep the replaced locator available as an alternative
        s.alternatives[patch.alternative] = { kind: old.kind, chain: old.chain, base: old.score, dynamic: false, warnings: old.warnings, score: old.score, code: old.code, verification: { count: 1, matchesTarget: true }, usable: true, anchor: old.anchor };
      }
    }
    this.emitUpdate();
    return s;
  }

  generateFiles(opts: GenerateOptions): GeneratedFile[] {
    return generate(this.steps, opts).files;
  }

  /** Save DOM, screenshot and ranking details for diagnosing locator choices. */
  async debugSnapshot(dir: string): Promise<string[]> {
    return this.lock.run(async () => {
      const page = this.pages.filter((p) => !p.isClosed()).pop();
      if (!page) throw new Error('No open page to snapshot');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const base = path.join(dir, `debug-${stamp}`);
      fs.mkdirSync(base, { recursive: true });
      const html = (await page.content()).replace(/<tphub-overlay[^>]*>\s*<\/tphub-overlay>/g, '');
      fs.writeFileSync(path.join(base, 'dom.html'), html, 'utf8');
      await page.screenshot({ path: path.join(base, 'screenshot.png'), fullPage: true });
      const snap = await takeSnapshot(page);
      fs.writeFileSync(path.join(base, 'snapshot.json'), JSON.stringify(snap.snap, null, 2), 'utf8');
      const ranking = this.steps.map((s) => ({ id: s.id, kind: s.kind, chosen: s.target ? { code: s.target.code, score: s.target.score, warnings: s.target.warnings } : null, alternatives: (s.alternatives ?? []).map((a) => ({ code: a.code, score: a.score, verification: a.verification, warnings: a.warnings })) }));
      fs.writeFileSync(path.join(base, 'ranking.json'), JSON.stringify(ranking, null, 2), 'utf8');
      return ['dom.html', 'screenshot.png', 'snapshot.json', 'ranking.json'].map((f) => path.join(base, f));
    });
  }

  currentPage(): Page | null {
    return this.pages.filter((p) => !p.isClosed()).pop() ?? null;
  }

  async close(saveStatePath?: string): Promise<void> {
    try {
      if (saveStatePath) await this.context.storageState({ path: saveStatePath });
    } finally {
      await this.browser?.close().catch(() => {});
    }
  }

  private emitUpdate(): void {
    this.emit('update');
  }
}

function slim(c: RankedCandidate) {
  return { code: c.code, score: c.score, usable: c.usable, kind: c.kind, warnings: c.warnings };
}
