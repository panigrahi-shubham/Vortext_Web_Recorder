/**
 * Rules that decide whether an id, class or attribute value is stable enough to put in a locator.
 * Everything here is deterministic pattern matching: no page access, easy to unit test and extend.
 */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const CSS_IN_JS = /^(css|sc|jss|svelte|jsx|emotion|styled)-[A-Za-z0-9]{4,}$/;
const FRAMEWORK_ID = /^(:r[0-9a-z]+:|radix-|headlessui-|ember\d|ext-gen|gwt-uid-|yui_|j_id|mat-(input|select|option|radio|checkbox|tab-label|dialog)-\d|cdk-|react-select-\d|downshift-\d|rc[-_]|el-id-)/i;

function hashLike(segment: string): boolean {
  return segment.length >= 5 && /\d/.test(segment) && /[a-zA-Z]/.test(segment);
}

/** True when a single id / class token looks generated (hash, counter, framework id). */
export function isDynamicToken(token: string): boolean {
  if (!token) return true;
  if (token.length > 50) return true;
  if (/\d{3,}/.test(token)) return true; // item-48213, ember1234
  if (UUID.test(token)) return true;
  if (/^[a-f0-9]{6,}$/i.test(token) && /\d/.test(token)) return true; // bare hex hash
  if (CSS_IN_JS.test(token)) return true; // css-1x2y3z, sc-bdVaJa
  if (/^(css|sc|jss|svelte|jsx|emotion|styled)-?[A-Za-z0-9]*\d[A-Za-z0-9]*$/.test(token)) return true; // jss12, css-0x1
  if (FRAMEWORK_ID.test(token)) return true;
  const segments = token.split(/[-_]+/).filter(Boolean);
  if (segments.length > 1 && hashLike(segments[segments.length - 1])) return true; // Button_root__3xK2a
  if (segments.length === 1 && hashLike(token) && !/[aeiou]{1}[a-z]{2,}/i.test(token)) return true; // x7k2q9
  return false;
}

const STATE_CLASS =
  /^(active|selected|hover|hovered|focus|focused|open|opened|closed|show|shown|hide|hidden|disabled|enabled|checked|expanded|collapsed|current|visible|invisible|loading|loaded|error|valid|invalid|dirty|touched|untouched|pristine|first|last|odd|even|on|off|in|fade|collapse|collapsing|animated|is-.+|has-.+|ng-.+)$/i;

const UTILITY_EXACT = new Set([
  'flex', 'grid', 'block', 'inline', 'inline-block', 'inline-flex', 'relative', 'absolute', 'fixed', 'sticky',
  'static', 'container', 'clearfix', 'row', 'col', 'italic', 'underline', 'uppercase', 'lowercase', 'capitalize',
  'truncate', 'pull-left', 'pull-right', 'float-left', 'float-right', 'text-left', 'text-right', 'text-center',
  'd-flex', 'd-none', 'd-block', 'd-inline', 'd-inline-block', 'w-100', 'h-100', 'fl', 'fr', 'cb', 'cp',
]);
const UTILITY_PATTERN =
  /^-?(p|m|w|h|px|py|pt|pb|pl|pr|ps|pe|mx|my|mt|mb|ml|mr|ms|me|gap|z|top|left|right|bottom|inset|order|basis|grow|shrink|opacity|leading|tracking|duration|delay|scale|rotate|translate|space|col|row|text|bg|border|rounded|shadow|ring|font|min-w|max-w|min-h|max-h|size|d|fs|fw|lh)(-[a-z]+)*-(\d+(\.\d+)?|px|auto|full|screen|xs|sm|md|lg|xl|\dxl|none)$/;

/** Tailwind / Bootstrap style utility classes say nothing about what the element is. */
export function isUtilityClass(cls: string): boolean {
  if (/[:[\]/!]/.test(cls)) return true;
  if (UTILITY_EXACT.has(cls)) return true;
  return UTILITY_PATTERN.test(cls);
}

export function isStateClass(cls: string): boolean {
  return STATE_CLASS.test(cls);
}

/** Classes that are safe to use in a locator, in source order. */
export function stableClasses(el: Element): string[] {
  const out: string[] = [];
  for (const cls of Array.from(el.classList)) {
    if (isDynamicToken(cls) || isStateClass(cls) || isUtilityClass(cls)) continue;
    out.push(cls);
  }
  return out;
}

/** Attribute values (name, aria-label, href ...) that may contain spaces. */
export function isStableValue(value: string | null | undefined): value is string {
  if (!value) return false;
  const v = value.trim();
  if (!v || v.length > 80) return false;
  if (/\d{4,}/.test(v)) return false;
  if (UUID.test(v)) return false;
  return true;
}

/** Standalone numbers inside a label: "Active (5675)", "67 approved", "₹ 250/Person". "3G" is left alone. */
const NUMBER_TOKEN = /(?<![A-Za-z\d])\d+(?:[.,]\d+)*(?![A-Za-z\d])/g;

export function hasDynamicNumber(text: string): boolean {
  NUMBER_TOKEN.lastIndex = 0;
  return NUMBER_TOKEN.test(text);
}

export function isMostlyNumeric(text: string): boolean {
  const letters = text.replace(/[^A-Za-z\u00C0-\uFFFD]/g, '').replace(/[\u20B9$\u20AC\u00A3\u00A5]/g, '');
  return letters.length < 2;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "Active (5675)" -> ^Active \(\d+\)$ ; returns null when the text has no standalone number. */
export function dynamicRegexSource(text: string): string | null {
  if (!hasDynamicNumber(text) || isMostlyNumeric(text)) return null;
  let out = '';
  let last = 0;
  NUMBER_TOKEN.lastIndex = 0;
  for (let m = NUMBER_TOKEN.exec(text); m; m = NUMBER_TOKEN.exec(text)) {
    out += escapeRegex(text.slice(last, m.index));
    out += /[.,]/.test(m[0]) ? '[\\d.,]+' : '\\d+';
    last = m.index + m[0].length;
  }
  out += escapeRegex(text.slice(last));
  return `^${out}$`;
}

/** Texts of child elements that are only a number: notification badges, counters ("71", "99+", "1,235"). */
export function numericBadges(el: Element): string[] {
  const out: string[] = [];
  for (const child of Array.from(el.querySelectorAll('*'))) {
    if (child.children.length) continue;
    const t = (child.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (t && t.length <= 8 && /^\d[\d.,]*\+?$/.test(t) && !out.includes(t)) out.push(t);
  }
  return out;
}

/** Split "Lead Manager71" around its badge "71". Returns the stable label and a regex that tolerates any count. */
export function badgeSplit(text: string, badges: string[]): { label: string; source: string } | null {
  for (const badge of badges) {
    const at = text.lastIndexOf(badge);
    if (at < 0) continue;
    const before = text.slice(0, at).trimEnd();
    const after = text.slice(at + badge.length).trimStart();
    if (before.replace(/[^A-Za-z]/g, '').length < 2) continue;
    const num = /[.,]/.test(badge) ? '[\\d.,]+\\+?' : '\\d+\\+?';
    return { label: before, source: `^${escapeRegex(before)}\\s*${num}${after ? `\\s*${escapeRegex(after)}` : ''}$` };
  }
  return null;
}

/** Longest piece of text between the dynamic numbers, plus whether it starts the string. */
export function stableChunk(text: string): { chunk: string; isPrefix: boolean } | null {
  NUMBER_TOKEN.lastIndex = 0;
  const parts: { s: string; start: number }[] = [];
  let last = 0;
  for (let m = NUMBER_TOKEN.exec(text); m; m = NUMBER_TOKEN.exec(text)) {
    parts.push({ s: text.slice(last, m.index), start: last });
    last = m.index + m[0].length;
  }
  parts.push({ s: text.slice(last), start: last });
  let best: { s: string; start: number } | null = null;
  for (const p of parts) {
    const trimmedLen = p.s.trim().length;
    if (trimmedLen >= 3 && (!best || trimmedLen > best.s.trim().length)) best = p;
  }
  if (!best) return null;
  const isPrefix = best.start === 0;
  return { chunk: isPrefix ? best.s.trimEnd() : best.s.trim(), isPrefix };
}
