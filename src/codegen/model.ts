// Steps -> code model: page classes (properties + intention methods) and spec blocks.
// Pure, no I/O. Rendering lives in pageObjects.ts and spec.ts.
import { regexLiteral, q, renderChain, renderChainWithParam } from '../locators/render';
import { routePattern } from '../suggest/suggest';
import type { Assertion, GenerateOptions, Step, TargetRef } from '../types';
import { camelCase, humanize, RESERVED, uniqueName } from './format';
import { clickMethodName, envVarName, pageClassName, paramName, propName, scopedParamName, slug } from './naming';

export interface PropDef {
  name: string;
  target: TargetRef;
  param: string | null; // scoped locators become methods taking the row text
  code: string; // rendered against this.page (with the param when scoped)
  weak: boolean;
}

export interface MethodDef {
  paramTypes?: Record<string, string>;
  name: string;
  params: string[];
  body: string[];
  returns: 'Download' | 'Page' | null;
  key: string;
}

export interface PageClassDef {
  name: string;
  route: string;
  props: PropDef[];
  propByCode: Map<string, PropDef>;
  methods: MethodDef[];
  methodByKey: Map<string, MethodDef>;
  taken: Set<string>;
  gotoUrl: string | null;
  loadedUrlRegex: string | null;
  loadedProp: PropDef | null;
}

export interface Block {
  title: string;
  lines: string[];
}

export interface FlowModel {
  title: string;
  slug: string;
  style: 'pom' | 'flat';
  classes: PageClassDef[];
  topInstances: Array<{ varName: string; cls: string }>;
  blocks: Block[];
  data: Record<string, string>;
  secrets: string[]; // data keys read from env vars
  smartHelpers: Set<'clickOrAt' | 'clickAtRatio' | 'copyText' | 'pasteText'>;
  typeImports: Set<'Download' | 'Page'>;
  usesAxe: boolean;
  assets: string[];
  viewport: { width: number; height: number };
  storageState?: string;
  testIdAttr?: string;
}

const FIELD_KINDS = new Set(['fill', 'select', 'check', 'uncheck', 'upload']);
const ASSERT_KINDS = new Set(['assert', 'waitVisible', 'waitHidden']);

function relUrl(url: string, baseURL?: string): string {
  if (baseURL && url.startsWith(baseURL.replace(/\/$/, ''))) {
    const rest = url.slice(baseURL.replace(/\/$/, '').length);
    return rest.startsWith('/') ? rest : '/' + rest;
  }
  return url;
}

/** "Fill a", "Fill b", "Click c" -> "Fill a, fill b and click c" */
export function joinSentence(parts: string[]): string {
  const p = parts.map((x, i) => (i === 0 ? x : x[0].toLowerCase() + x.slice(1)));
  return p.length <= 1 ? p.join('') : p.slice(0, -1).join(', ') + ' and ' + p[p.length - 1];
}

export function describeStep(s: Step, baseURL?: string): string {
  const t = s.target;
  const what = t ? t.describe + (t.anchor ? ` in "${t.anchor}"` : '') : 'page';
  switch (s.kind) {
    case 'goto':
      return `Open ${relUrl(s.value ?? s.page.url, baseURL)}`;
    case 'click':
      return `Click ${what}`;
    case 'dblclick':
      return `Double-click ${what}`;
    case 'rightclick':
      return `Right-click ${what}`;
    case 'hover':
      return `Hover ${what}`;
    case 'fill':
      return `${s.inputMode === 'append' ? 'Append text to' : s.inputMode === 'type' ? 'Type into' : 'Fill'} ${what}`;
    case 'copyText': return `Copy value/text from ${what}`;
    case 'pasteText': return `Paste recorder clipboard into ${what}`;
    case 'select':
      return `Select "${(s.values ?? []).join(', ')}" in ${what}`;
    case 'check':
      return `Check ${what}`;
    case 'uncheck':
      return `Uncheck ${what}`;
    case 'press':
      return `Press ${s.value}${t ? ' in ' + what : ''}`;
    case 'upload':
      return `Upload ${(s.files ?? []).join(', ')} to ${what}`;
    case 'drag':
      return `Drag ${what} to ${s.target2?.describe ?? 'target'}`;
    case 'scrollIntoView':
      return `Scroll to ${what}`;
    case 'waitVisible':
      return `Wait until ${what} is visible`;
    case 'waitHidden':
      return `Wait until ${what} is hidden`;
    case 'assert':
      return `Check ${what}: ${s.assertion?.type}`;
  }
}

/** Expected-value literal for an assertion. */
function expectedLiteral(a: Assertion): string {
  if (a.regex && typeof a.expected === 'string') return regexLiteral(a.expected);
  if (typeof a.expected === 'number') return String(a.expected);
  return q(String(a.expected ?? ''));
}

export function assertionLine(a: Assertion, target: string | null, pageVar: string): string {
  const t = target ?? pageVar;
  switch (a.type) {
    case 'visible':
      return `await expect(${t}).toBeVisible();`;
    case 'hidden':
      return `await expect(${t}).not.toBeVisible();`;
    case 'enabled':
      return `await expect(${t}).toBeEnabled();`;
    case 'disabled':
      return `await expect(${t}).toBeDisabled();`;
    case 'editable':
      return `await expect(${t}).toBeEditable();`;
    case 'checked':
      return `await expect(${t}).toBeChecked();`;
    case 'unchecked':
      return `await expect(${t}).not.toBeChecked();`;
    case 'focused':
      return `await expect(${t}).toBeFocused();`;
    case 'textEquals':
      return `await expect(${t}).toHaveText(${expectedLiteral(a)});`;
    case 'textContains':
      return `await expect(${t}).toContainText(${expectedLiteral(a)});`;
    case 'valueEquals':
      return `await expect(${t}).toHaveValue(${expectedLiteral(a)});`;
    case 'attributeEquals':
      return `await expect(${t}).toHaveAttribute(${q(a.attrName ?? '')}, ${expectedLiteral(a)});`;
    case 'countEquals':
      return `await expect(${t}).toHaveCount(${Number(a.expected ?? 0)});`;
    case 'urlMatches':
      return `await expect(${pageVar}).toHaveURL(${a.regex === false ? q(String(a.expected)) : regexLiteral(String(a.expected))});`;
    case 'titleMatches':
      return `await expect(${pageVar}).toHaveTitle(${expectedLiteral(a)});`;
    case 'screenshot':
      return target ? `await expect(${t}).toHaveScreenshot();` : `await expect(${pageVar}).toHaveScreenshot();`;
    case 'a11y':
      return `expect((await new AxeBuilder({ page: ${pageVar} }).analyze()).violations).toEqual([]);`;
  }
}

interface Ctx {
  opts: GenerateOptions;
  classes: Map<string, PageClassDef>; // by route key
  classNames: Set<string>;
  instances: Map<string, string>; // `${cls}|${tab}` -> var
  instanceNames: Set<string>;
  declaredInstances: Set<string>;
  tabVars: Map<number, string>;
  model: FlowModel;
  dataKeys: Map<string, string>; // value identity -> key
  hasPasswordOnRoute: Set<string>;
  headingByRoute: Map<string, string | null>;
  provenVisible: Set<string>;
}

function routeKey(s: { page: Step['page'] }): string {
  return routePattern(s.page.url);
}

function classFor(ctx: Ctx, url: string, heading: string | null): PageClassDef {
  const route = routePattern(url);
  let cls = ctx.classes.get(route);
  if (cls) return cls;
  const name = uniqueName(pageClassName(url, { heading: heading ?? ctx.headingByRoute.get(route), hasPassword: ctx.hasPasswordOnRoute.has(route) }), ctx.classNames);
  cls = {
    name,
    route,
    props: [],
    propByCode: new Map(),
    methods: [],
    methodByKey: new Map(),
    taken: new Set(['page', 'goto', 'expectLoaded', 'constructor']),
    gotoUrl: null,
    loadedUrlRegex: null,
    loadedProp: null,
  };
  ctx.classes.set(route, cls);
  ctx.model.classes.push(cls);
  return cls;
}

function instanceVar(ctx: Ctx, cls: PageClassDef, tab: number, lines: string[] | null): string {
  const k = `${cls.name}|${tab}`;
  let v = ctx.instances.get(k);
  if (!v) {
    let base = camelCase(cls.name.replace(/Page$/, ''), 3) || 'app';
    if (RESERVED.has(base) || ctx.instanceNames.has(base)) base += 'Page';
    if (tab > 0) base += 'Popup' + (tab > 1 ? tab : '');
    v = uniqueName(base, ctx.instanceNames);
    ctx.instances.set(k, v);
  }
  if (!ctx.declaredInstances.has(k)) {
    ctx.declaredInstances.add(k);
    if (tab === 0) ctx.model.topInstances.push({ varName: v, cls: cls.name });
    else if (lines) lines.push(`const ${v} = new ${cls.name}(${tabVar(ctx, tab)});`);
  }
  return v;
}

function tabVar(ctx: Ctx, tab: number): string {
  if (tab === 0) return 'page';
  let v = ctx.tabVars.get(tab);
  if (!v) {
    v = tab === 1 ? 'popup' : `popup${tab}`;
    ctx.tabVars.set(tab, v);
  }
  return v;
}

/** Register a locator property (POM) and return how to reference it inside the class. */
function prop(cls: PageClassDef, t: TargetRef): PropDef {
  const scopedParam = t.kind === 'scoped' && t.anchor ? scopedParamName(t) : null;
  const key = scopedParam ? renderChainWithParam(t.chain, 'this.page', scopedParam) : renderChain(t.chain, 'this.page');
  let p = cls.propByCode.get(key);
  if (p) return p;
  const name = uniqueName(propName(t), cls.taken);
  p = { name, target: t, param: scopedParam, code: key, weak: t.score < 60 };
  cls.propByCode.set(key, p);
  cls.props.push(p);
  return p;
}

function inClassRef(p: PropDef, paramExpr?: string): string {
  return p.param ? `this.${p.name}(${paramExpr ?? p.param})` : `this.${p.name}`;
}

/** Expression for a target used in the spec. */
function specRef(ctx: Ctx, t: TargetRef, url: string, tab: number, lines: string[]): string {
  if (ctx.opts.style === 'flat') return renderChain(t.chain, tabVar(ctx, tab));
  const cls = classFor(ctx, url, null);
  const p = prop(cls, t);
  const v = instanceVar(ctx, cls, tab, lines);
  return p.param ? `${v}.${p.name}(${q(t.anchor ?? '')})` : `${v}.${p.name}`;
}

function dataKey(ctx: Ctx, base: string, value: string): string {
  const id = base + '\u0000' + value;
  const existing = ctx.dataKeys.get(id);
  if (existing) return existing;
  const taken = new Set(Object.keys(ctx.model.data));
  const key = uniqueName(base || 'value', taken);
  ctx.model.data[key] = value;
  ctx.dataKeys.set(id, key);
  return key;
}

function valueExpr(ctx: Ctx, s: Step, fieldParam: string): string {
  if (s.kind !== 'fill') return q(s.value ?? '');
  const secret = !!s.secret;
  const key = dataKey(ctx, fieldParam, secret && !ctx.opts.keepSecrets ? '<' + fieldParam + '>' : s.value ?? '');
  if (secret) {
    if (!ctx.model.secrets.includes(key)) ctx.model.secrets.push(key);
    return `process.env.${envVarName(key)} ?? data.${key}`;
  }
  return `data.${key}`;
}

function coordsCall(ctx: Ctx, s: Step, root: string, locatorExpr: string | null): string[] {
  const c = s.coords!;
  if (s.clickStyle === 'fallback' && locatorExpr) {
    if (ctx.opts.coordsAsRatio) {
      ctx.model.smartHelpers.add('clickOrAt');
      return [`await clickOrAt(${root}, ${locatorExpr}, { rx: ${(c.x / c.vw).toFixed(4)}, ry: ${(c.y / c.vh).toFixed(4)} });`];
    }
    ctx.model.smartHelpers.add('clickOrAt');
    return [`await clickOrAt(${root}, ${locatorExpr}, { x: ${c.x}, y: ${c.y} });`];
  }
  const would = locatorExpr ? ` // would have used: ${locatorExpr}` : '';
  if (ctx.opts.coordsAsRatio) {
    ctx.model.smartHelpers.add('clickAtRatio');
    return [`await clickAtRatio(${root}, ${(c.x / c.vw).toFixed(4)}, ${(c.y / c.vh).toFixed(4)});${would}`];
  }
  return [`await ${root}.mouse.click(${c.x}, ${c.y});${would}`];
}

/** Action lines for one step. `ref(t)` gives the locator expression; `root` is the Page expression. */
function actionLines(ctx: Ctx, s: Step, root: string, ref: (t: TargetRef) => string, valueOf: (s: Step) => string): string[] {
  const lines: string[] = [];
  if (s.dialog) {
    lines.push(`// a ${s.dialog.type} dialog appears: "${s.dialog.message.replace(/\s+/g, ' ').slice(0, 80)}"`);
    lines.push(`${root}.once('dialog', (dialog) => dialog.${s.dialog.action}());`);
  }
  const t = s.target;
  const loc = t && t.kind !== 'coords' ? ref(t) : null;
  const useCoords = (s.clickStyle !== 'locator' || !loc) && !!s.coords && ['click', 'dblclick', 'rightclick'].includes(s.kind);
  const requiresLocator = ['copyText', 'pasteText', 'fill', 'select', 'check', 'uncheck', 'upload', 'hover', 'scrollIntoView', 'drag'].includes(s.kind);
  if ((requiresLocator && !loc) || (s.kind === 'drag' && (!s.target2 || s.target2.kind === 'coords')) || (['click', 'dblclick', 'rightclick'].includes(s.kind) && !loc && !useCoords)) {
    const message = `Unsupported recorded ${s.kind} at step ${s.id}: choose a usable locator or delete and record this step again.`;
    lines.push(`throw new Error(${q(message)}); // recording needs review`);
    return lines;
  }
  switch (s.kind) {
    case 'click':
    case 'dblclick':
    case 'rightclick': {
      if (useCoords && s.kind === 'click') lines.push(...coordsCall(ctx, s, root, loc));
      else if (useCoords) {
        const c = s.coords!;
        lines.push(`await ${root}.mouse.${s.kind === 'dblclick' ? 'dblclick' : 'click'}(${c.x}, ${c.y}${s.kind === 'rightclick' ? ", { button: 'right' }" : ''});`);
      } else if (loc) {
        lines.push(s.kind === 'click' ? `await ${loc}.click();` : s.kind === 'dblclick' ? `await ${loc}.dblclick();` : `await ${loc}.click({ button: 'right' });`);
      }
      break;
    }
    case 'hover':
      if (loc) lines.push(`await ${loc}.hover();`);
      break;
    case 'fill':
      if (loc) {
        const value = valueOf(s);
        if (s.inputMode === 'type' || s.inputMode === 'append') {
          if (s.inputMode === 'type') lines.push(`await ${loc}.fill('');`);
          else { lines.push(`await ${loc}.focus();`); lines.push(`await ${loc}.press('ControlOrMeta+End');`); }
          lines.push(`await ${loc}.pressSequentially(${value}, { delay: ${s.typingDelay ?? 0} });`);
        } else lines.push(`await ${loc}.fill(${value});`);
      }
      break;
    case 'copyText':
    case 'pasteText':
      ctx.model.smartHelpers.add(s.kind);
      lines.push(`await ${s.kind}(${root}, ${loc});`);
      break;
    case 'select':
      if (loc) lines.push(`await ${loc}.selectOption(${valueOf(s)});`);
      break;
    case 'check':
      if (loc) lines.push(`await ${loc}.check();`);
      break;
    case 'uncheck':
      if (loc) lines.push(`await ${loc}.uncheck();`);
      break;
    case 'press':
      lines.push(loc ? `await ${loc}.press(${q(s.value ?? '')});` : `await ${root}.keyboard.press(${q(s.value ?? '')});`);
      break;
    case 'upload':
      if (loc) lines.push(`await ${loc}.setInputFiles(${valueOf(s)}); // TODO: point to a real file`);
      break;
    case 'drag':
      if (loc && s.target2) lines.push(`await ${loc}.dragTo(${ref(s.target2)});`);
      break;
    case 'scrollIntoView':
      if (loc) lines.push(`await ${loc}.scrollIntoViewIfNeeded();`);
      break;
    default:
      break;
  }
  return lines;
}

function preAssertLines(ctx: Ctx, s: Step, expr: string | null): string[] {
  if (!s.preAssert || !expr || s.clickStyle !== 'locator') return [];
  if (!['click', 'dblclick', 'rightclick', 'fill', 'select', 'check', 'uncheck', 'hover', 'press', 'upload', 'drag'].includes(s.kind)) return [];
  if (s.kind === 'press' && !s.target) return [];
  if (s.kind === 'upload') return [];
  if (ctx.provenVisible.has(expr)) return [];
  const out = [`await expect(${expr}).toBeVisible(); // pre-assertion`];
  if (s.kind === 'fill' || s.kind === 'select') out.push(`await expect(${expr}).toBeEnabled();`);
  return out;
}

function postAssertLines(ctx: Ctx, s: Step, tab: number, lines: string[]): string[] {
  const out: string[] = [];
  for (const sug of s.suggestions.filter((x) => x.accepted)) {
    const a = sug.assertion;
    const expr = a.target ? specRef(ctx, a.target, sug.pageUrl, tab, lines) : null;
    out.push(`${assertionLine(a, expr, tabVar(ctx, tab))} // suggested: ${sug.label}`);
    if (expr && ['visible', 'textEquals', 'textContains', 'checked', 'enabled'].includes(a.type)) ctx.provenVisible.add(expr);
  }
  if (s.settleMs && s.settleMs >= 2000) out.push(`// took about ${(s.settleMs / 1000).toFixed(1)} s to settle${s.settleTimedOut ? ' (did not fully settle; the check above waits for it)' : ''}`);
  return out;
}

/** Group consecutive steps on the same page into user intentions. */
export function groupSteps(steps: Step[]): Step[][] {
  const groups: Step[][] = [];
  let cur: Step[] = [];
  const flush = () => {
    if (cur.length) groups.push(cur);
    cur = [];
  };
  for (const s of steps) {
    const special = s.kind === 'goto' || ASSERT_KINDS.has(s.kind) || !!s.dialog || !!s.popup || !!s.download;
    if (cur.length && (special || routeKey(cur[0]) !== routeKey(s) || cur[0].page.tab !== s.page.tab || !FIELD_KINDS.has(cur[cur.length - 1].kind))) flush();
    cur.push(s);
    const ends = special || !FIELD_KINDS.has(s.kind) || s.suggestions.some((x) => x.accepted) || (s.kind === 'press');
    if (ends) flush();
  }
  flush();
  return groups;
}

export function buildModel(steps: Step[], opts: GenerateOptions): FlowModel {
  const model: FlowModel = {
    title: opts.flowName,
    slug: slug(opts.flowName),
    style: opts.style,
    classes: [],
    topInstances: [],
    blocks: [],
    data: {},
    secrets: [],
    smartHelpers: new Set(),
    typeImports: new Set(),
    usesAxe: false,
    assets: [],
    viewport: opts.viewport,
    storageState: opts.storageState,
      testIdAttr: opts.testIdAttr,
  };
  const ctx: Ctx = {
    opts,
    classes: new Map(),
    classNames: new Set(),
    instances: new Map(),
    instanceNames: new Set(['page', 'popup', 'popup2', 'popup3', 'data', 'expect', 'test', 'download', 'download2', 'download3', 'dialog']),
    declaredInstances: new Set(),
    tabVars: new Map(),
    model,
    dataKeys: new Map(),
    hasPasswordOnRoute: new Set(),
    headingByRoute: new Map(),
    provenVisible: new Set(),
  };
  for (const s of steps) {
    const r = routeKey(s);
    if (s.kind === 'fill' && (s.target?.inputType === 'password' || s.secret)) ctx.hasPasswordOnRoute.add(r);
    if (!ctx.headingByRoute.has(r)) ctx.headingByRoute.set(r, s.page.heading);
  }

  const groups = groupSteps(steps);
  let stepNo = 0;
  groups.forEach((g, gi) => {
    const first = g[0];
    const tab = first.page.tab;
    const root = tabVar(ctx, tab);
    const nums = g.map(() => ++stepNo);
    const numLabel = nums.length > 1 ? `${nums[0]}-${nums[nums.length - 1]}` : `${nums[0]}`;
    const lines: string[] = [];
    lines.push(`// ${numLabel}. ${joinSentence(g.map((s) => describeStep(s, opts.baseURL)))}`);
    for (const s of g) if (s.comment) lines.push(`// note: ${s.comment}`);
    let title = g.length > 1 && g.every((x) => FIELD_KINDS.has(x.kind)) ? `${describeStep(first, opts.baseURL)} and ${g.length - 1} more` : describeStep(g[g.length - 1], opts.baseURL);

    // ----- goto
    if (first.kind === 'goto') {
      const url = relUrl(first.value ?? first.page.url, opts.baseURL);
      if (opts.style === 'pom' && gi === 0) {
        const cls = classFor(ctx, first.value ?? first.page.url, first.page.heading);
        cls.gotoUrl = url;
        const v = instanceVar(ctx, cls, tab, lines);
        lines.push(`await ${v}.goto();`);
        lines.push(`await ${v}.expectLoaded();`);
        title = `Open the ${humanize(cls.name.replace(/Page$/, '')).toLowerCase()} page`;
      } else {
        lines.push(`await ${root}.goto(${q(url)});`);
      }
      lines.push(...postAssertLines(ctx, first, tab, lines));
      model.blocks.push({ title, lines });
      return;
    }

    // ----- explicit assertions and waits
    if (ASSERT_KINDS.has(first.kind)) {
      const a: Assertion = first.kind === 'assert' ? first.assertion! : { type: first.kind === 'waitVisible' ? 'visible' : 'hidden', target: first.target };
      if (a.type === 'a11y') model.usesAxe = true;
      const expr = a.target ? specRef(ctx, a.target, first.page.url, tab, lines) : null;
      lines.push(assertionLine(a, expr, root) + (first.kind !== 'assert' ? ` // wait until ${first.kind === 'waitVisible' ? 'visible' : 'hidden'}` : ''));
      if (expr && a.type === 'visible') ctx.provenVisible.add(expr);
      model.blocks.push({ title: first.kind === 'assert' ? `Verify ${a.target ? a.target.describe : 'the page'}` : describeStep(first, opts.baseURL), lines });
      return;
    }

    // ----- actions
    if (opts.style === 'flat') {
      for (const s of g) {
        const ref = (t: TargetRef) => renderChain(t.chain, root);
        const valueOf = (st: Step) => flatValue(ctx, st);
        const expr = s.target && s.target.kind !== 'coords' ? ref(s.target) : null;
        lines.push(...preAssertLines(ctx, s, expr));
        lines.push(...wrapEvents(ctx, s, root, actionLines(ctx, s, root, ref, valueOf), null));
        ctx.provenVisible.clear();
        lines.push(...postAssertLines(ctx, s, tab, lines));
      }
    } else {
      const cls = classFor(ctx, first.page.url, first.page.heading);
      const v = instanceVar(ctx, cls, tab, lines);
      // first action target of a page: used by expectLoaded()
      const firstTarget = first.target && first.target.kind !== 'coords' ? prop(cls, first.target) : null;
      if (!cls.loadedProp && firstTarget && !firstTarget.param) cls.loadedProp = firstTarget;
      const params: string[] = [];
        const paramTypes: Record<string, string> = {};
      const args: string[] = [];
      const body: string[] = [];
      const paramTaken = new Set<string>();
      for (const s of g) {
        const refIn = (tt: TargetRef) => {
          const p = prop(cls, tt);
          if (p.param) {
            if (!params.includes(p.param)) {
              params.push(p.param);
              paramTaken.add(p.param);
              args.push(q(tt.anchor ?? ''));
            }
          }
          return inClassRef(p);
        };
        const valueOf = (st: Step) => {
          const p = prop(cls, st.target!);
          const pn = uniqueName(st.kind === 'upload' ? 'filePath' : paramName(p.name), paramTaken);
          params.push(pn);
          if (st.kind === 'select') paramTypes[pn] = 'string | string[]';
          if (st.kind === 'select') args.push((st.values ?? []).length > 1 ? `[${(st.values ?? []).map(q).join(', ')}]` : q((st.values ?? [''])[0]));
          else if (st.kind === 'upload') args.push(uploadArg(ctx, st));
          else args.push(valueExpr(ctx, st, paramName(p.name)));
          return pn;
        };
        body.push(...actionLines(ctx, s, 'this.page', refIn, valueOf));
      }
      // method
      const last = g[g.length - 1];
      const afterFills = g.length > 1 && g.slice(0, -1).every((s) => FIELD_KINDS.has(s.kind));
      let mName: string;
      const base = cls.name.replace(/Page$/, '');
      if (g.every((s) => FIELD_KINDS.has(s.kind))) {
        if (g.length > 1) mName = `fill${base}Form`;
        else if (last.kind === 'check' || last.kind === 'uncheck') mName = clickMethodName(last.target, last.kind, base, false);
        else mName = ({ fill: 'fill', select: 'select', upload: 'upload' } as Record<string, string>)[last.kind] + pascal(paramName(prop(cls, last.target!).name));
      } else if (last.kind === 'press') {
        const key = pascal(camelCase((last.value ?? 'Key').replace(/\+/g, ' ')));
        const fills = g.filter((x) => x.kind === 'fill');
        if (afterFills && fills.length === 1) mName = `fill${pascal(paramName(prop(cls, fills[0].target!).name))}AndPress${key}`;
        else mName = afterFills ? `fill${base}FormAndPress${key}` : `press${key}`;
      } else if (last.kind === 'drag') {
        mName = `drag${pascal(paramName(prop(cls, last.target!).name))}To${pascal(paramName(prop(cls, last.target2!).name))}`;
      } else {
        mName = clickMethodName(last.target, last.kind, base, afterFills);
      }
      let returns: MethodDef['returns'] = null;
      let wrapped = body;
      if (last.download) {
        returns = 'Download';
        model.typeImports.add('Download');
        wrapped = ["const downloadPromise = this.page.waitForEvent('download');", ...body, 'return downloadPromise;'];
      } else if (last.popup) {
        returns = 'Page';
        model.typeImports.add('Page');
        wrapped = ["const pagePromise = this.page.context().waitForEvent('page');", ...body, 'const popup = await pagePromise;', 'await popup.waitForLoadState();', 'return popup;'];
      }
      const key = JSON.stringify([params, wrapped, returns]);
      let m = cls.methodByKey.get(key);
      if (!m) {
        m = { name: uniqueName(mName, cls.taken), params, paramTypes, body: wrapped, returns, key };
        cls.methodByKey.set(key, m);
        cls.methods.push(m);
      }
      // spec lines
      const firstExpr = first.target && first.target.kind !== 'coords' ? specRef(ctx, first.target, first.page.url, tab, lines) : null;
      lines.push(...preAssertLines(ctx, first, firstExpr));
      ctx.provenVisible.clear();
      const call = `await ${v}.${m.name}(${args.join(', ')});`;
      if (last.download) {
        lines.push(`const download = await ${v}.${m.name}(${args.join(', ')});`);
        lines.push(`expect(download.suggestedFilename()).toBe(${q(last.download.suggestedFilename)}); // suggested: file was downloaded`);
      } else if (last.popup) {
        const pv = tabVar(ctx, last.popup.tab);
        lines.push(`const ${pv} = await ${v}.${m.name}(${args.join(', ')});`);
      } else lines.push(call);
      title = humanize(m.name) + (args.length && args.every((a) => a.startsWith("'")) ? ` (${args.map((a) => a.slice(1, -1)).join(', ')})` : '');
      for (const s of g) lines.push(...postAssertLines(ctx, s, tab, lines));
    }

    // entering a new page next? check it loaded (POM only)
    const next = groups[gi + 1]?.[0];
    if (opts.style === 'pom' && next && next.kind !== 'goto') {
      const lastStep = g[g.length - 1];
      const nextTab = next.page.tab;
      const changedRoute = routeKey(next) !== routeKey(lastStep) || nextTab !== lastStep.page.tab;
      if (changedRoute) {
        const ncls = classFor(ctx, next.page.url, next.page.heading);
        const nv = instanceVar(ctx, ncls, nextTab, lines);
        if (next.target && next.target.kind !== 'coords' && !ASSERT_KINDS.has(next.kind)) {
          const p = prop(ncls, next.target);
          if (!ncls.loadedProp && !p.param) ncls.loadedProp = p;
        }
        lines.push(`await ${nv}.expectLoaded();`);
      }
    }
    model.blocks.push({ title, lines });
  });

  // expectLoaded URL checks
  for (const cls of model.classes) {
    const path = cls.route.split('#')[0];
    if (path !== '/' && path !== '/index.html') {
      const re = cls.route.split(':id').map((p) => p.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('[^/?#]+');
      cls.loadedUrlRegex = re;
    }
  }
  return model;
}

function pascal(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function uploadArg(ctx: Ctx, s: Step): string {
  const dir = (ctx.opts.outDirFromCwd ?? 'tests').replace(/\\/g, '/').replace(/\/$/, '');
  const files = (s.files ?? ['file.txt']).map((f) => {
    if (!ctx.model.assets.includes(f)) ctx.model.assets.push(f);
    return q(`${dir}/assets/${f}`);
  });
  return files.length > 1 ? `[${files.join(', ')}]` : files[0];
}

function flatValue(ctx: Ctx, s: Step): string {
  if (s.kind === 'fill') {
    const base = paramName(propName(s.target!));
    return valueExpr(ctx, s, base);
  }
  if (s.kind === 'select') return (s.values ?? []).length > 1 ? `[${(s.values ?? []).map(q).join(', ')}]` : q((s.values ?? [''])[0]);
  if (s.kind === 'upload') return uploadArg(ctx, s);
  return q(s.value ?? '');
}

/** Flat style: wrap download/popup events around the action lines. */
function wrapEvents(ctx: Ctx, s: Step, root: string, action: string[], _unused: null): string[] {
  if (s.download) {
    return [
      `const downloadPromise = ${root}.waitForEvent('download');`,
      ...action,
      'const download = await downloadPromise;',
      `expect(download.suggestedFilename()).toBe(${q(s.download.suggestedFilename)}); // suggested: file was downloaded`,
    ];
  }
  if (s.popup) {
    const pv = tabVar(ctx, s.popup.tab);
    return [`const ${pv}Promise = ${root}.context().waitForEvent('page');`, ...action, `const ${pv} = await ${pv}Promise;`, `await ${pv}.waitForLoadState();`];
  }
  return action;
}
