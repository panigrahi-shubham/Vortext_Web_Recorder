// Naming rules for page classes, locator properties, methods and parameters.
import type { Step, TargetRef } from '../types';
import { routePattern } from '../suggest/suggest';
import { camelCase, pascalCase, RESERVED, words } from './format';

const GENERIC_SEGMENTS = new Set(['edit', 'new', 'view', 'details', 'detail', 'list', 'index', 'show', 'create', 'update', 'step', 'page']);

/** "/checkout-step-one.html" -> "CheckoutStepOnePage"; "/product/:id" -> "ProductPage" */
export function pageClassName(url: string, ctx: { heading?: string | null; title?: string; hasPassword?: boolean } = {}): string {
  const route = routePattern(url);
  const [pathPart, hashPart] = route.split('#');
  const pick = (p: string) => {
    const segs = p
      .split('/')
      .filter((s) => s && s !== ':id')
      .map((s) => s.replace(/\.(html?|php|aspx?|jsp)$/i, ''))
      .filter((s) => s && s.toLowerCase() !== 'index');
    if (!segs.length) return '';
    let last = segs[segs.length - 1];
    if (GENERIC_SEGMENTS.has(last.toLowerCase()) && segs.length > 1) last = segs[segs.length - 2] + ' ' + last;
    return last;
  };
  let base = (hashPart && pick(hashPart)) || pick(pathPart);
  if (!base) {
    if (ctx.hasPassword) base = 'Login';
    else if (ctx.heading && words(ctx.heading).length <= 3) base = ctx.heading;
    else base = 'Home';
  }
  let name = pascalCase(base, 4);
  if (!name) name = 'Home';
  if (!/page$/i.test(name)) name += 'Page';
  return name;
}

const ROLE_SUFFIX: Record<string, string> = {
  button: 'Button',
  link: 'Link',
  textbox: 'Input',
  searchbox: 'Input',
  spinbutton: 'Input',
  checkbox: 'Checkbox',
  radio: 'Radio',
  combobox: 'Select',
  listbox: 'Select',
  heading: 'Heading',
  img: 'Image',
  tab: 'Tab',
  switch: 'Switch',
  menuitem: 'MenuItem',
  dialog: 'Dialog',
  alertdialog: 'Dialog',
  alert: 'Message',
  status: 'Message',
  row: 'Row',
  cell: 'Cell',
  option: 'Option',
  slider: 'Slider',
  progressbar: 'Progress',
  listitem: 'Item',
  list: 'List',
  table: 'Table',
  navigation: 'Nav',
  region: 'Region',
  form: 'Form',
  group: 'Group',
};

const NOUN_ENDINGS = /(button|link|input|field|icon|title|message|label|badge|count|total|heading|checkbox|select|dropdown|menu|tab|image|logo|list|table|row|item|dialog|modal|toast|banner|error|price|name)$/i;

function targetWords(t: TargetRef): string {
  const fromTestId = t.testId ? t.testId.replace(/[-_]+/g, ' ') : '';
  const candidates = [t.label, t.placeholder, t.name, fromTestId, t.text, t.nameAttr];
  for (const c of candidates) {
    if (c && words(c).length && !/^\d+$/.test(c.trim())) return c;
  }
  return t.tag;
}

/** "Login" button -> loginButton ; testid cart-badge -> cartBadge ; "Username" textbox -> usernameInput */
export function propName(t: TargetRef, group = false): string {
  if (group) {
    const base = camelCase(t.testId?.replace(/[-_]+/g, ' ') || (t.role ? t.role + 's' : t.tag + 's'), 3);
    return base.endsWith('s') ? base : base + 's';
  }
  const anonymous = !t.name && !t.label && !t.testId && !t.placeholder;
  const src = anonymous && t.role && ['status', 'alert', 'alertdialog', 'dialog', 'progressbar'].includes(t.role) ? t.role : targetWords(t);
  let base = camelCase(src, 4);
  if (!base) base = t.tag || 'element';
  const role = t.role ?? (t.tag === 'input' || t.tag === 'textarea' ? 'textbox' : t.tag === 'select' ? 'combobox' : '');
  const suffix = ROLE_SUFFIX[role] ?? (NOUN_ENDINGS.test(base) ? '' : 'Element');
  if (suffix && !base.toLowerCase().endsWith(suffix.toLowerCase())) base += suffix;
  if (RESERVED.has(base)) base += 'Element';
  return base;
}

/** Strip the role suffix: usernameInput -> username */
export function paramName(prop: string): string {
  const p = prop.replace(/(Input|Select|Checkbox|Radio|Field|Element|Button|Textarea|Region|Link)$/, '');
  const name = p || prop;
  return RESERVED.has(name) ? name + 'Value' : name;
}

const VERBS = new Set([
  'add', 'remove', 'delete', 'edit', 'open', 'close', 'save', 'submit', 'search', 'login', 'logout', 'log', 'sign', 'checkout',
  'continue', 'cancel', 'confirm', 'place', 'go', 'view', 'show', 'hide', 'select', 'choose', 'buy', 'create', 'update',
  'upload', 'download', 'sort', 'filter', 'apply', 'reset', 'clear', 'next', 'back', 'start', 'finish', 'send', 'accept',
  'decline', 'reject', 'approve', 'register', 'subscribe', 'book', 'pay', 'order', 'print', 'export', 'import', 'refresh',
  'expand', 'collapse', 'toggle', 'enable', 'disable', 'invite', 'share', 'copy', 'move', 'archive', 'restore', 'complete',
]);
const GENERIC_SUBMIT = new Set(['submit', 'ok', 'continue', 'next', 'save', 'go', 'yes', 'done', 'apply', 'send', 'confirm']);

/** Method name for a click on `t` (optionally after filling a form on `pageBase`). */
export function clickMethodName(t: TargetRef | null, kind: Step['kind'], pageBase: string, afterFills: boolean): string {
  const label = t ? targetWords(t) : 'page';
  const w = words(label).slice(0, 4);
  const first = w[0] ?? '';
  const pascal = pascalCase(label, 4) || 'Element';
  const without = (drop: string[]) => pascalCase(words(label).filter((x) => !drop.includes(x)).join(' '), 4) || 'Element';
  if (kind === 'dblclick') return 'doubleClick' + without(['double', 'click']);
  if (kind === 'rightclick') return 'rightClick' + without(['right', 'click']);
  if (kind === 'hover') return 'hover' + pascal;
    if (kind === 'copyText') return 'copy' + pascal;
    if (kind === 'pasteText') return 'pasteInto' + pascal;
  if (kind === 'scrollIntoView') return 'scrollTo' + pascal;
  if (kind === 'check') return 'check' + pascal;
  if (kind === 'uncheck') return 'uncheck' + pascal;
  if (VERBS.has(first)) {
    let name = camelCase(label, 4);
    if (w.length === 1 && GENERIC_SUBMIT.has(first)) name = first + pascalCase(pageBase, 3);
    if (RESERVED.has(name)) name = 'click' + pascal;
    return name;
  }
  if (afterFills) return 'submit' + pascal;
  if (t?.role === 'link') return 'open' + pascal;
  if (t?.role === 'tab') return 'select' + pascal + (pascal.endsWith('Tab') ? '' : 'Tab');
  return 'click' + pascal;
}

export function scopedParamName(t: TargetRef): string {
  return /getByRole\('row'\)/.test(t.code) ? 'rowText' : 'itemName';
}

export function slug(name: string): string {
  return words(name).slice(0, 8).join('-') || 'recorded-flow';
}

export function envVarName(key: string): string {
  return 'TEST_' + words(key).join('_').toUpperCase();
}
