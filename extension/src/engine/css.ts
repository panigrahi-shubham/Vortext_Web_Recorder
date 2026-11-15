import { PageCtx, cssAttr, cssEscape, normalizeText } from './ctx';
import { isDynamicToken, isStableValue, stableClasses } from './dynamic';

export type CssKind = 'attr' | 'class' | 'tag';

export interface SimpleSelector {
  sel: string;
  kind: CssKind;
}

export interface CssResult {
  selector: string;
  kind: CssKind;
  /** Number of ancestor levels the selector had to climb. */
  hops: number;
  /** True when :nth-of-type was needed (position-dependent, brittle). */
  nth: boolean;
}

const FRAMEWORK_DATA_ATTR = /^data-(v-|react|ember|ng-|radix|headlessui|state$|testid$|test$|qa$|cy$|index$|key$|id$|rbd-)/;

export function stableHref(el: Element): string | null {
  if (el.localName !== 'a') return null;
  const href = el.getAttribute('href');
  if (!href || href === '#' || href.length > 80) return null;
  if (/^javascript:/i.test(href) || /\d{3,}/.test(href) || href.includes('?')) return null;
  return href;
}

/** Selectors that describe the element on its own, best first. Not necessarily unique. */
export function simpleSelectors(el: Element, ctx: PageCtx): SimpleSelector[] {
  const tag = cssEscape(el.localName);
  const out: SimpleSelector[] = [];
  const push = (sel: string, kind: CssKind) => {
    if (!out.some((o) => o.sel === sel)) out.push({ sel, kind });
  };

  for (const attr of ctx.settings.testIdAttrs) {
    const v = el.getAttribute(attr);
    if (v) push(`[${attr}=${cssAttr(v)}]`, 'attr');
  }
  const id = el.getAttribute('id');
  if (id && !isDynamicToken(id)) push(`#${cssEscape(id)}`, 'attr');

  const name = el.getAttribute('name');
  if (isStableValue(name)) push(`${tag}[name=${cssAttr(name)}]`, 'attr');

  const ariaLabel = el.getAttribute('aria-label');
  if (isStableValue(ariaLabel)) push(`${tag}[aria-label=${cssAttr(ariaLabel)}]`, 'attr');

  const placeholder = el.getAttribute('placeholder');
  if (isStableValue(placeholder)) push(`${tag}[placeholder=${cssAttr(placeholder)}]`, 'attr');

  const href = stableHref(el);
  if (href) push(`a[href=${cssAttr(href)}]`, 'attr');

  let dataCount = 0;
  for (const attr of Array.from(el.attributes)) {
    if (dataCount >= 3) break;
    if (!attr.name.startsWith('data-') || FRAMEWORK_DATA_ATTR.test(attr.name)) continue;
    if (ctx.settings.testIdAttrs.includes(attr.name)) continue;
    if (!isStableValue(attr.value) || isDynamicToken(attr.value.replace(/\s+/g, '-'))) continue;
    push(`${tag}[${attr.name}=${cssAttr(attr.value)}]`, 'attr');
    dataCount++;
  }

  const title = el.getAttribute('title');
  if (isStableValue(title)) push(`${tag}[title=${cssAttr(title)}]`, 'attr');
  const alt = el.getAttribute('alt');
  if (isStableValue(alt)) push(`${tag}[alt=${cssAttr(alt)}]`, 'attr');

  const classes = stableClasses(el).slice(0, 3);
  for (const cls of classes) push(`${tag}.${cssEscape(cls)}`, 'class');
  if (classes.length >= 2) push(`${tag}.${cssEscape(classes[0])}.${cssEscape(classes[1])}`, 'class');

  if (el.localName === 'input') {
    const type = el.getAttribute('type');
    if (type) push(`input[type=${cssAttr(type)}]`, 'tag');
    const value = el.getAttribute('value');
    if (type && /^(submit|button|reset)$/i.test(type) && isStableValue(value)) {
      push(`input[type=${cssAttr(type)}][value=${cssAttr(normalizeText(value))}]`, 'attr');
    }
  }
  push(tag, 'tag');
  return out;
}

/** "div:nth-of-type(2) > span" from (but excluding) `from` down to `el`. */
export function nthPath(from: Element, el: Element): { path: string; nth: boolean } | null {
  const segments: string[] = [];
  let nth = false;
  let cur: Element | null = el;
  while (cur && cur !== from) {
    const parent: Element | null = cur.parentElement;
    if (!parent) return null;
    const tag = cur.localName;
    const same = Array.from(parent.children).filter((c) => c.localName === tag);
    if (same.length > 1) {
      segments.unshift(`${cssEscape(tag)}:nth-of-type(${same.indexOf(cur) + 1})`);
      nth = true;
    } else {
      segments.unshift(cssEscape(tag));
    }
    cur = parent;
  }
  return cur === from ? { path: segments.join(' > '), nth } : null;
}

function isOnly(ctx: PageCtx, selector: string, el: Element): boolean {
  const found = ctx.queryAll(selector);
  return found.length === 1 && found[0] === el;
}

/** Shortest CSS selector that matches only this element across the page (open shadow roots included). */
export function buildCss(el: Element, ctx: PageCtx): CssResult | null {
  const own = simpleSelectors(el, ctx);
  for (const s of own) {
    if (s.kind === 'tag' && !/[[.#]/.test(s.sel)) continue;
    if (isOnly(ctx, s.sel, el)) return { selector: s.sel, kind: s.kind, hops: 0, nth: false };
  }

  let anc = el.parentElement;
  let hops = 1;
  while (anc) {
    const isBody = anc.localName === 'body';
    const ancSelectors = isBody ? [{ sel: 'body', kind: 'tag' as CssKind }] : simpleSelectors(anc, ctx).filter((s) => s.kind !== 'tag');
    for (const a of ancSelectors) {
      if (!isOnly(ctx, a.sel, anc)) continue;
      for (const s of own) {
        const sel = `${a.sel} ${s.sel}`;
        if (isOnly(ctx, sel, el)) return { selector: sel, kind: s.kind === 'tag' ? a.kind : s.kind, hops, nth: false };
      }
      const path = nthPath(anc, el);
      if (path) {
        const sel = `${a.sel} > ${path.path}`;
        if (isOnly(ctx, sel, el)) return { selector: sel, kind: 'tag', hops, nth: path.nth };
      }
      break;
    }
    anc = anc.parentElement;
    hops++;
  }
  return null;
}
