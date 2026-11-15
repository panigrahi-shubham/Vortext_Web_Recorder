/**
 * Anchoring rules. When an element cannot be identified on its own (an edit pencil that exists on every
 * product card), find a container that can be: either a repeating item identified by its text, or a
 * unique region of the page.
 */
import { PageCtx, cssEscape, normalizeText } from './ctx';
import { simpleSelectors } from './css';
import { hasDynamicNumber, isMostlyNumeric, stableClasses } from './dynamic';
import { xpathAll } from './queries';
import { simplePredicates, xpClassFor, xpTag } from './xpath';

export interface AnchorInfo {
  el: Element;
  css: string;
  /** XPath for the container without the text predicate; empty when none could be built. */
  xpath: string;
  repeating: boolean;
  count: number;
  text?: string;
  textMode?: 'contains' | 'exact';
}

const STRUCTURAL = new Set(['li', 'tr', 'article']);
const LANDMARKS = new Set(['nav', 'header', 'footer', 'aside', 'main', 'form', 'dialog', 'table', 'fieldset']);

function isOnlyCss(ctx: PageCtx, sel: string, el: Element): boolean {
  const found = ctx.queryAll(sel);
  return found.length === 1 && found[0] === el;
}

function uniqueXpath(el: Element, ctx: PageCtx): string | null {
  const tag = xpTag(el);
  for (const p of simplePredicates(el, ctx)) {
    if (p.kind === 'text') continue;
    const expr = `//${tag}${p.pred}`;
    const found = xpathAll(ctx, expr);
    if (found.length === 1 && found[0] === el) return expr;
  }
  return null;
}

function candidateTexts(container: Element, target: Element): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  const consider = (el: Element) => {
    if (list.length >= 15) return;
    if (el === target || target.contains(el) || el.contains(target)) return;
    const t = normalizeText(el.textContent);
    if (t.length < 2 || t.length > 60 || isMostlyNumeric(t) || hasDynamicNumber(t) || seen.has(t)) return;
    seen.add(t);
    list.push(t);
  };
  container.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]').forEach(consider);
  for (const el of Array.from(container.querySelectorAll('[class]'))) {
    if (/title|name|heading|subject/i.test(el.getAttribute('class') ?? '')) consider(el);
  }
  for (const el of Array.from(container.querySelectorAll('*'))) {
    if (list.length >= 15) break;
    const hasOwnText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && normalizeText(n.textContent).length > 1);
    if (el.children.length === 0 || hasOwnText) consider(el);
  }
  return list;
}

interface ContainerTexts {
  lower: string[];
  exact: Set<string>[];
}

/** Text of every container of one kind. Computed once per selector: a scan asks for it for every row. */
function containerTexts(css: string, containers: Element[], ctx: PageCtx): ContainerTexts {
  return ctx.memo(`anchor-texts:${css}`, () => ({
    lower: containers.map((c) => normalizeText(c.textContent).toLowerCase()),
    exact: containers.map((c) => {
      const set = new Set<string>();
      for (const el of Array.from(c.querySelectorAll('*'))) {
        const raw = el.textContent;
        if (raw && raw.length < 400) set.add(normalizeText(raw));
      }
      return set;
    }),
  }));
}

/** Text that appears in this container and in no other container of the same kind. */
function distinguishingText(
  container: Element,
  css: string,
  containers: Element[],
  target: Element,
  ctx: PageCtx,
): { text: string; mode: 'contains' | 'exact' } | null {
  const texts = candidateTexts(container, target);
  if (!texts.length) return null;
  const all = containerTexts(css, containers, ctx);
  for (const t of texts) {
    const needle = t.toLowerCase();
    let contains = 0;
    for (const x of all.lower) if (x.includes(needle) && ++contains > 1) break;
    if (contains === 1) return { text: t, mode: 'contains' };
    let exact = 0;
    for (const set of all.exact) if (set.has(t) && ++exact > 1) break;
    if (exact === 1) return { text: t, mode: 'exact' };
  }
  return null;
}

function repeatingAnchor(a: Element, target: Element, ctx: PageCtx): AnchorInfo | null {
  const parent = a.parentElement;
  if (!parent) return null;
  const tag = a.localName;
  const siblings = Array.from(parent.children).filter((c) => c.localName === tag);
  if (siblings.length < 2) return null;

  let css: string | null = null;
  let xpath = '';
  let bestClass: string | null = null;
  let bestShared = 1;
  for (const cls of stableClasses(a)) {
    const shared = siblings.filter((s) => s.classList.contains(cls)).length;
    if (shared > bestShared) {
      bestShared = shared;
      bestClass = cls;
    }
  }
  if (bestClass) {
    css = `${cssEscape(tag)}.${cssEscape(bestClass)}`;
    xpath = `//${xpTag(a)}${xpClassFor(a, bestClass, ctx)}`;
  } else if (STRUCTURAL.has(tag) || /^(listitem|row|article)$/.test(a.getAttribute('role') ?? '')) {
    const viaSection = /^(tbody|thead|tfoot)$/.test(parent.localName) && parent.parentElement;
    const owner = viaSection ? parent.parentElement! : parent;
    const middle = viaSection ? ` > ${parent.localName}` : '';
    for (const s of simpleSelectors(owner, ctx)) {
      if (s.kind === 'tag') continue;
      if (isOnlyCss(ctx, s.sel, owner)) {
        css = `${s.sel}${middle} > ${cssEscape(tag)}`;
        break;
      }
    }
    const ownerXp = uniqueXpath(owner, ctx);
    if (ownerXp) xpath = `${ownerXp}${viaSection ? `/${parent.localName}` : ''}/${xpTag(a)}`;
  }
  if (!css) return null;

  const containers = ctx.queryAll(css);
  if (containers.length < 2 || !containers.includes(a)) return null;
  const dt = distinguishingText(a, css, containers, target, ctx);
  if (!dt) return null;
  return { el: a, css, xpath, repeating: true, count: containers.length, text: dt.text, textMode: dt.mode };
}

function scopedAnchor(a: Element, ctx: PageCtx): AnchorInfo | null {
  for (const s of simpleSelectors(a, ctx)) {
    if (s.kind === 'tag' && !(LANDMARKS.has(a.localName) && s.sel === a.localName)) continue;
    if (!isOnlyCss(ctx, s.sel, a)) continue;
    let xpath = uniqueXpath(a, ctx) ?? '';
    if (!xpath && s.kind === 'tag') xpath = `//${xpTag(a)}`;
    return { el: a, css: s.sel, xpath, repeating: false, count: 1 };
  }
  return null;
}

/** Nearest useful containers for `target`: up to two repeating items and one unique region. */
export function findAnchors(target: Element, ctx: PageCtx): AnchorInfo[] {
  const out: AnchorInfo[] = [];
  let repeating = 0;
  let scoped = 0;
  let anc = target.parentElement;
  for (let depth = 0; anc && anc.localName !== 'body' && anc.localName !== 'html' && depth < 12; depth++) {
    let used = false;
    if (repeating < 2) {
      const r = repeatingAnchor(anc, target, ctx);
      if (r) {
        out.push(r);
        repeating++;
        used = true;
      }
    }
    if (!used && scoped < 1) {
      const s = scopedAnchor(anc, ctx);
      if (s) {
        out.push(s);
        scoped++;
      }
    }
    anc = anc.parentElement;
  }
  return out;
}
