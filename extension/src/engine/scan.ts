/** Page scan: find every element a test is likely to touch and generate its best locator. */
import { INTERACTIVE_SELECTOR } from './a11y';
import { PageCtx, UI_TAG, composedParent, normalizeText } from './ctx';
import { stableClasses } from './dynamic';
import { generate } from './generate';
import type { PickResult } from './types';

export interface ScanOptions {
  limit?: number;
  /** Require a visible layout box. Off in unit tests, where there is no layout engine. */
  requireLayout?: boolean;
}

const WRAPPING = new Set(['a', 'button', 'summary']);
const WRAPPING_ROLES = /^(button|link|tab|menuitem|option|switch|checkbox|radio)$/;
const POINTER_TAGS = 'div,span,i,svg,img,li,td,p,label,em,b,strong';

function isVisible(el: Element, ctx: PageCtx, requireLayout: boolean): boolean {
  if (el.localName === UI_TAG) return false;
  if (ctx.isHidden(el)) return false;
  if (!requireLayout) return true;
  const rect = el.getBoundingClientRect();
  return rect.width > 1 && rect.height > 1;
}

/** Retargeting rule: a click on an icon inside a button means the button. */
export function retarget(el: Element): Element {
  let cur: Element = el;
  const svg = el.closest('svg');
  if (svg) cur = svg;
  let anc: Element | null = cur;
  for (let depth = 0; anc && depth <= 4; depth++) {
    if (anc.matches(INTERACTIVE_SELECTOR)) return anc;
    anc = anc.parentElement;
  }
  return cur;
}

export function collectInteractive(ctx: PageCtx, opts: ScanOptions = {}): Element[] {
  const requireLayout = opts.requireLayout ?? true;
  const picked = new Set<Element>(ctx.queryAll(INTERACTIVE_SELECTOR));

  // Sites built from clickable <div>s: an element with cursor:pointer whose parent does not have it.
  const view = ctx.doc.defaultView;
  if (view && requireLayout) {
    const pool = ctx.queryAll(POINTER_TAGS);
    for (const el of pool.slice(0, 6000)) {
      if (picked.has(el)) continue;
      if (view.getComputedStyle(el).cursor !== 'pointer') continue;
      const parent = composedParent(el);
      if (parent && view.getComputedStyle(parent).cursor === 'pointer') continue;
      picked.add(el);
    }
  }

  const out: Element[] = [];
  for (const el of picked) {
    if (!isVisible(el, ctx, requireLayout)) continue;
    // Drop children of something already clickable (the <span> inside a <button>).
    let nested = false;
    let anc = composedParent(el);
    for (let depth = 0; anc && depth < 6; depth++) {
      if (picked.has(anc) && (WRAPPING.has(anc.localName) || WRAPPING_ROLES.test(anc.getAttribute('role') ?? ''))) {
        nested = true;
        break;
      }
      anc = composedParent(anc);
    }
    if (!nested) out.push(el);
  }
  out.sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1));
  return out;
}

export interface ScanEntry {
  el: Element;
  result: PickResult;
  /** Further elements covered by the same parameterised locator (other rows of the list). */
  repeat: number;
}

export interface ScanResult {
  items: ScanEntry[];
  total: number;
  truncated: boolean;
  ms: number;
}

/** Cheap structural fingerprint: same tag/class path and same own text means "the same control in another row". */
function signature(el: Element): string {
  const path: string[] = [];
  let cur: Element | null = el;
  for (let depth = 0; cur && depth < 7 && cur.localName !== 'body'; depth++) {
    path.push(`${cur.localName}.${stableClasses(cur).join('.')}`);
    cur = cur.parentElement;
  }
  const own = [
    normalizeText(el.textContent).slice(0, 40),
    el.getAttribute('type'),
    el.getAttribute('role'),
    el.getAttribute('aria-label'),
    el.getAttribute('placeholder'),
    el.getAttribute('title'),
  ];
  return `${path.join('<')}|${own.map((v) => v ?? '').join('|')}`;
}

export function scanPage(ctx: PageCtx, opts: ScanOptions = {}): ScanResult {
  const started = performance.now();
  const limit = opts.limit ?? 300;
  const all = collectInteractive(ctx, opts);
  const items: ScanEntry[] = [];
  const bySignature = new Map<string, ScanEntry>();
  const byKey = new Map<string, ScanEntry>();
  let truncated = false;

  for (const el of all) {
    // Rows of a list fold into the first row's parameterised locator without being generated again.
    const sig = signature(el);
    const sameRow = bySignature.get(sig);
    if (sameRow) {
      sameRow.repeat++;
      continue;
    }
    if (items.length >= limit) {
      truncated = true;
      continue;
    }
    const result = generate(el, ctx);
    const key = result.candidates[0]?.param?.key;
    const sameLocator = key ? byKey.get(key) : undefined;
    if (sameLocator) {
      sameLocator.repeat++;
      bySignature.set(sig, sameLocator);
      continue;
    }
    const entry: ScanEntry = { el, result, repeat: 0 };
    items.push(entry);
    if (key) {
      byKey.set(key, entry);
      bySignature.set(sig, entry);
    }
  }
  return { items, total: all.length, truncated, ms: Math.round(performance.now() - started) };
}
