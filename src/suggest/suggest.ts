// Before/after diff -> ranked assertion suggestions. Pure: unit-tested without a browser.
import { escapeRegex, isVolatileValue, looksDynamic, stablePart, stableRegex } from '../locators/rank';
import type { AssertType, PageSnapshot, RepeatGroup, SnapElement } from '../types';

export interface RawSuggestion {
  id: string;
  type: AssertType;
  label: string;
  reason: 'appeared' | 'disappeared' | 'changed' | 'navigated';
  score: number;
  expected?: string | number;
  regex?: boolean;
  attrName?: string;
  el?: SnapElement; // element to locate
  group?: RepeatGroup; // repeated items to count
  side: 'before' | 'after'; // which snapshot the element lives in
  key: string; // de-duplication key (one assertion per element)
}

export interface DiffContext {
  actionKind?: string;
  actionKey?: string | null; // snapshot key of the element acted on
  maxSuggestions?: number;
}

// ---------------------------------------------------------------- URL helpers

const VOLATILE_SEGMENT = /^(?:\d+|[0-9a-f]{8,}|[0-9a-f-]{32,36}|[A-Za-z0-9_-]{20,})$/i;

/** "/product/123/reviews" -> "/product/:id/reviews" */
export function routePattern(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const segs = u.pathname.split('/').map((s) => (s && VOLATILE_SEGMENT.test(s) ? ':id' : s));
  let route = segs.join('/') || '/';
  // hash routing (#/cart, #!/cart)
  const h = u.hash.replace(/^#!?/, '');
  if (h.startsWith('/')) route += '#' + h.split('?')[0].split('/').map((s) => (s && VOLATILE_SEGMENT.test(s) ? ':id' : s)).join('/');
  return route;
}

/** Regex source used in toHaveURL for a URL: path only, volatile parts replaced. */
export function urlRegexSource(url: string): string {
  const route = routePattern(url);
  const [pathPart, hashPart] = route.split('#');
  if (pathPart === '/' && !hashPart) return '\\/(?:[?#].*)?$';
  const toRe = (p: string) => p.split(':id').map(escapeRegex).join('[^/?#]+');
  let re = toRe(pathPart);
  if (hashPart) re += '#' + toRe(hashPart);
  return re;
}

// ---------------------------------------------------------------- naming

export function elementLabel(el: SnapElement): string {
  const d = el.d;
  const kind = el.volatile && el.volatile !== 'dialog' ? el.volatile : d.role ?? (d.testId ? d.testId : d.tag);
  const raw = d.name || d.text || d.testId || d.placeholder || '';
  const text = raw.length > 32 ? raw.slice(0, 30) + '…' : raw;
  return text ? `${kind} '${text}'` : kind;
}

// ---------------------------------------------------------------- diff

function byKey(s: PageSnapshot): Map<string, SnapElement> {
  return new Map(s.elements.map((e) => [e.key, e]));
}

function textAssertion(text: string): { type: AssertType; expected: string; regex?: boolean } | null {
  const t = text.trim();
  if (!t) return null;
  if (isVolatileValue(t) || looksDynamic(t)) {
    const part = stablePart(t);
    if (part.length >= 3) return { type: 'textContains', expected: part };
    return null;
  }
  return { type: 'textContains', expected: t.length > 60 ? t.slice(0, 60).replace(/\s+\S*$/, '') : t };
}

export function diffSnapshots(before: PageSnapshot, after: PageSnapshot, ctx: DiffContext = {}): RawSuggestion[] {
  const out: RawSuggestion[] = [];
  let n = 0;
  const id = () => `s${++n}`;
  const b = byKey(before);
  const a = byKey(after);
  const navigated = routePattern(before.url) !== routePattern(after.url);

  // 1. URL
  const hashOnly = !navigated && before.url !== after.url && new URL(after.url).hash !== new URL(before.url).hash;
  if (navigated) {
    const route = routePattern(after.url);
    out.push({ id: id(), type: 'urlMatches', label: `URL changed to ${route}`, reason: 'navigated', score: 95, expected: urlRegexSource(after.url), regex: true, side: 'after', key: 'page:url' });
  } else if (hashOnly) {
    const u = new URL(after.url);
    const hash = u.hash;
    const src = /^#!?\//.test(hash) ? urlRegexSource(after.url) : escapeRegex(u.pathname + hash);
    out.push({ id: id(), type: 'urlMatches', label: `URL changed to ${u.pathname}${hash}`, reason: 'navigated', score: 70, expected: src, regex: true, side: 'after', key: 'page:url' });
  }

  // 2. title
  if (before.title !== after.title && after.title) {
    const steady = !looksDynamic(after.title);
    const re = steady ? null : stableRegex(after.title);
    if (steady || re) {
      out.push({ id: id(), type: 'titleMatches', label: `title changed to '${after.title}'`, reason: 'changed', score: 55, expected: steady ? after.title : re!, regex: !steady, side: 'after', key: 'page:title' });
    }
  }

  // 3. appeared
  const topHeadingLevel = Math.min(9, ...after.elements.filter((e) => e.d.role === 'heading').map((e) => e.d.headingLevel ?? 2));
  let headingsOnNav = 0;
  for (const el of after.elements) {
    if (b.has(el.key) && !navigated) continue;
    const d = el.d;
    if (el.volatile === 'spinner' || el.volatile === 'overlay') continue; // transient
    if (el.volatile === 'dialog' || el.volatile === 'modal') {
      out.push({ id: id(), type: 'visible', label: `${elementLabel(el)} appeared`, reason: 'appeared', score: 90, el, side: 'after', key: el.key });
      continue;
    }
    if (el.volatile === 'alert' || el.volatile === 'toast' || el.volatile === 'status') {
      const ta = textAssertion(d.text || d.name);
      const sc = el.volatile === 'alert' ? 88 : 82;
      if (ta) out.push({ id: id(), ...ta, label: `${elementLabel(el)} appeared`, reason: 'appeared', score: sc, el, side: 'after', key: el.key });
      else out.push({ id: id(), type: 'visible', label: `${elementLabel(el)} appeared`, reason: 'appeared', score: 80, el, side: 'after', key: el.key });
      continue;
    }
    if (d.role === 'heading' && (d.name || d.text)) {
      const lvl = d.headingLevel ?? 2;
      if (navigated && (lvl > topHeadingLevel || headingsOnNav++ >= 1)) continue;
      out.push({ id: id(), type: 'visible', label: `heading '${d.name || d.text}' appeared`, reason: 'appeared', score: navigated ? 84 - lvl : 86 - lvl, el, side: 'after', key: el.key });
      continue;
    }
    if (navigated) continue; // on a new page everything "appeared": keep only landmarks
    const txt = d.text.trim();
    if (txt && txt.length <= 40 && !isVolatileValue(txt) && !['input', 'select', 'textarea'].includes(d.tag)) {
      out.push({ id: id(), type: el.leaf === false ? 'visible' : 'textEquals', expected: el.leaf === false ? undefined : txt, label: `${elementLabel(el)} appeared`, reason: 'appeared', score: d.testId ? 84 : 62, el, side: 'after', key: el.key });
    } else if (d.role && ['button', 'link', 'checkbox', 'textbox', 'combobox'].includes(d.role) && d.name) {
      out.push({ id: id(), type: 'visible', label: `${elementLabel(el)} appeared`, reason: 'appeared', score: 50, el, side: 'after', key: el.key });
    }
  }

  // 4. disappeared
  if (!navigated) {
    for (const el of before.elements) {
      if (a.has(el.key)) continue;
      if (el.volatile && ['spinner', 'modal', 'overlay', 'dialog', 'alert', 'toast'].includes(el.volatile)) {
        out.push({ id: id(), type: 'hidden', label: `${elementLabel(el)} disappeared`, reason: 'disappeared', score: el.volatile === 'dialog' || el.volatile === 'modal' ? 70 : 60, el, side: 'before', key: el.key });
      }
    }
  }

  // 5. changed (same element on both sides)
  if (!navigated) {
    for (const el of after.elements) {
      const prev = b.get(el.key);
      if (!prev) continue;
      const d = el.d;
      const pd = prev.d;
      const isTarget = ctx.actionKey === el.key;
      if (d.checked !== null && pd.checked !== null && d.checked !== pd.checked) {
        out.push({ id: id(), type: d.checked ? 'checked' : 'unchecked', label: `${elementLabel(el)} is now ${d.checked ? 'checked' : 'unchecked'}`, reason: 'changed', score: isTarget ? 87 : 82, el, side: 'after', key: el.key });
        continue;
      }
      if (el.selected !== null && prev.selected !== null && el.selected !== prev.selected) {
        out.push({ id: id(), type: 'attributeEquals', attrName: 'aria-selected', expected: String(el.selected), label: `${elementLabel(el)} is now ${el.selected ? 'selected' : 'not selected'}`, reason: 'changed', score: 82, el, side: 'after', key: el.key });
        continue;
      }
      if (el.expanded !== null && prev.expanded !== null && el.expanded !== prev.expanded) {
        out.push({ id: id(), type: 'attributeEquals', attrName: 'aria-expanded', expected: String(el.expanded), label: `${elementLabel(el)} is now ${el.expanded ? 'expanded' : 'collapsed'}`, reason: 'changed', score: 80, el, side: 'after', key: el.key });
        continue;
      }
      if (el.pressed !== null && prev.pressed !== null && el.pressed !== prev.pressed) {
        out.push({ id: id(), type: 'attributeEquals', attrName: 'aria-pressed', expected: String(el.pressed), label: `${elementLabel(el)} is now ${el.pressed ? 'pressed' : 'not pressed'}`, reason: 'changed', score: 76, el, side: 'after', key: el.key });
        continue;
      }
      const nameFromLabel = d.name === pd.name && !!d.name && d.name !== d.text && !!d.role;
      if (!nameFromLabel && el.leaf !== false && d.text !== pd.text && d.text && d.text.length <= 80 && !isVolatileValue(d.text) && !['input', 'textarea', 'select'].includes(d.tag)) {
        const who = d.role ? d.role + (d.name && d.name !== d.text && d.name !== pd.text ? ` '${d.name.slice(0, 24)}'` : '') : d.testId ?? d.tag;
        out.push({ id: id(), type: 'textEquals', expected: d.text, label: `${who} text changed to '${d.text.slice(0, 30)}'`, reason: 'changed', score: d.testId ? 85 : 78, el, side: 'after', key: el.key });
        continue;
      }
      if (el.value !== null && prev.value !== null && el.value !== prev.value && !isTarget && ctx.actionKind !== 'fill' && !isVolatileValue(el.value)) {
        out.push({ id: id(), type: 'valueEquals', expected: el.value, label: `${elementLabel(el)} value changed to '${el.value.slice(0, 30)}'`, reason: 'changed', score: 66, el, side: 'after', key: el.key });
        continue;
      }
      if (d.disabled !== pd.disabled) {
        out.push({ id: id(), type: d.disabled ? 'disabled' : 'enabled', label: `${elementLabel(el)} is now ${d.disabled ? 'disabled' : 'enabled'}`, reason: 'changed', score: 64, el, side: 'after', key: el.key });
      }
    }
  }

  // 6. list length
  if (!navigated) {
    const bg = new Map(before.groups.map((g) => [g.key, g]));
    const ag = new Map(after.groups.map((g) => [g.key, g]));
    for (const g of after.groups) {
      const prev = bg.get(g.key);
      if (prev && prev.count !== g.count) {
        out.push({ id: id(), type: 'countEquals', expected: g.count, label: `${g.role ?? g.tag} list now has ${g.count} item${g.count === 1 ? '' : 's'} (was ${prev.count})`, reason: 'changed', score: 75, group: g, side: 'after', key: 'group:' + g.key });
      }
    }
    for (const g of before.groups) {
      if (!ag.has(g.key) && g.count > 0) {
        out.push({ id: id(), type: 'countEquals', expected: 0, label: `${g.role ?? g.tag} list is now empty (was ${g.count})`, reason: 'changed', score: 70, group: g, side: 'after', key: 'group:' + g.key });
      }
    }
  }

  // rank, one per element
  out.sort((x, y) => y.score - x.score);
  const seen = new Set<string>();
  return out.filter((s) => (seen.has(s.key) ? false : (seen.add(s.key), true))).slice(0, ctx.maxSuggestions ?? 12);
}
