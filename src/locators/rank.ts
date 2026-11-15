// Pure scoring and text heuristics. No browser, no I/O: everything here is unit-tested.
import type { Candidate, CandidateKind, LocatorChoice, RankedCandidate, Verification } from '../types';
import { renderChain } from './render';

// ---------------------------------------------------------------------------
// Dynamic text detection
// ---------------------------------------------------------------------------

const MONTHS = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';

/** Patterns that make a text almost certainly change between runs. */
const STRONG_PATTERNS: Array<[RegExp, string]> = [
  [/[$€£₹¥]\s?\d/, 'currency amount'],
  [/\b(?:usd|eur|gbp|inr|rs\.?)\s?\d/i, 'currency amount'],
  [/\d+[.,]\d{2}\b/, 'decimal amount'],
  [/\b\d{4}-\d{1,2}-\d{1,2}\b/, 'date'],
  [/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/, 'date'],
  [new RegExp(`\\b${MONTHS}\\s+\\d{1,2}\\b`, 'i'), 'date'],
  [new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTHS}`, 'i'), 'date'],
  [/\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:am|pm)?\b/i, 'time'],
  [/\b\d{1,2}\s?(?:am|pm)\b/i, 'time'],
  [/\b\d+\s*(?:s|sec|secs|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?|w|weeks?|months?|y|years?)\s+ago\b/i, 'relative time'],
  [/\bjust now\b/i, 'relative time'],
  [/#\s?\d{3,}/, 'order or ticket number'],
  [/\b[A-Z]{2,8}-\d{3,}\b/, 'order or ticket number'],
  [/\b\d{5,}\b/, 'long number'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, 'uuid'],
  [/^\s*\d+\s+[A-Za-z]/, 'count'],
  [/\(\s*\d+\s*\)/, 'count'],
  [/:\s*\d/, 'value after a label'],
  [/\d+(?:\.\d+)?\s?%/, 'percentage'],
  [/^\s*\d+\s*$/, 'number'],
];

/** "digits next to words": weaker signal, product names such as "iPhone 15" also hit it. */
const WEAK_PATTERN = /(?:[A-Za-z]\s?\d|\d\s?[A-Za-z])/;

export interface DynamicInfo {
  level: 0 | 1 | 2; // 0 = steady, 1 = maybe dynamic, 2 = very likely dynamic
  reasons: string[];
}

export function dynamicInfo(text: string | null | undefined): DynamicInfo {
  const t = (text ?? '').trim();
  if (!t) return { level: 0, reasons: [] };
  const reasons: string[] = [];
  for (const [re, why] of STRONG_PATTERNS) if (re.test(t) && !reasons.includes(why)) reasons.push(why);
  if (reasons.length) return { level: 2, reasons };
  if (WEAK_PATTERN.test(t)) return { level: 1, reasons: ['digits next to words'] };
  return { level: 0, reasons: [] };
}

export function looksDynamic(text: string | null | undefined): boolean {
  return dynamicInfo(text).level > 0;
}

/**
 * Text that should not be used as an *expected value* in an assertion.
 * Counts and prices are fine to assert ("1" in a cart badge), dates and ids are not.
 */
export function isVolatileValue(text: string | null | undefined): boolean {
  const t = (text ?? '').trim();
  if (!t) return false;
  const volatile = ['date', 'time', 'relative time', 'order or ticket number', 'long number', 'uuid'];
  return dynamicInfo(t).reasons.some((r) => volatile.includes(r));
}

const DYNAMIC_TOKEN = new RegExp(
  [
    '[$€£₹¥]\\s?[\\d.,]+',
    '\\b(?:usd|eur|gbp|inr|rs\\.?)\\s?[\\d.,]+',
    '\\b\\d{4}-\\d{1,2}-\\d{1,2}\\b',
    '\\b\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}\\b',
    `\\b${MONTHS}\\s+\\d{1,2}(?:,?\\s+\\d{4})?`,
    '\\b\\d{1,2}:\\d{2}(?::\\d{2})?\\s?(?:am|pm)?',
    '\\b\\d+\\s*(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\\s+ago',
    '#?\\s?\\d[\\d.,]*%?',
  ].join('|'),
  'gi',
);

/** Remove digits, dates and amounts; return the longest steady piece ("Total: $42.10" -> "Total"). */
export function stablePart(text: string): string {
  const pieces = text
    .split(DYNAMIC_TOKEN)
    .map((p) => p.replace(/\s+/g, ' ').replace(/^[\s:()[\],.\-–|/#]+|[\s:()[\],.\-–|/#]+$/g, '').trim())
    .filter((p) => p.length >= 2);
  if (!pieces.length) return '';
  return pieces.reduce((a, b) => (b.length > a.length ? b : a));
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/**
 * A regex that keeps the steady part of a dynamic text.
 * "Add to cart (3)" -> ^Add to cart ; "6 new notifications" -> new notifications
 */
export function stableRegex(text: string): string | null {
  const t = text.replace(/\s+/g, ' ').trim();
  DYNAMIC_TOKEN.lastIndex = 0;
  const m = DYNAMIC_TOKEN.exec(t);
  DYNAMIC_TOKEN.lastIndex = 0;
  if (!m) return null;
  const prefix = t.slice(0, m.index).replace(/[\s:(#\-–|]+$/, '').trim();
  if (prefix.length >= 3) return '^' + escapeRegex(prefix);
  const part = stablePart(t);
  return part.length >= 3 ? escapeRegex(part) : null;
}

// ---------------------------------------------------------------------------
// Generated / utility name detection (ids and classes)
// ---------------------------------------------------------------------------

const GENERATED_PATTERNS: RegExp[] = [
  /^[a-f0-9]{8,}$/i,
  /(?=[a-f0-9]*\d)(?=[a-f0-9]*[a-f])[a-f0-9]{6,}/i,
  /^css-[a-z0-9]+/i,
  /^sc-[a-z0-9]+/i,
  /^jsx-\d+/,
  /^ember\d+/i,
  /^:r[0-9a-z]*:$/i,
  /^:[a-z0-9]+:$/i,
  /^(?:mui|react-select|radix|headlessui|downshift|rc-tabs|ant)-.*\d/i,
  /^ng-(?:tns|star|untouched|pristine|valid|invalid|dirty|touched)/,
  /^_?ngcontent/,
  /__[A-Za-z0-9_-]{5,}$/,
  /^[A-Za-z]+_[A-Za-z]+__[A-Za-z0-9]{4,}$/,
  /^makeStyles-/,
  /\d+$/, // numbers at the end ("item-42", "field3")
  /^\d/,
  /^[a-z]{1,3}\d{2,}/i,
  /^(?:yui|ext-gen|gwt-uid|x-auto)/i,
];

export function looksGenerated(name: string | null | undefined): boolean {
  const n = (name ?? '').trim();
  if (!n) return true;
  if (n.length > 40) return true;
  return GENERATED_PATTERNS.some((re) => re.test(n));
}

const UTILITY_EXACT = new Set([
  'active', 'show', 'shown', 'hide', 'hidden', 'fade', 'open', 'opened', 'closed', 'selected', 'focus', 'focused',
  'hover', 'disabled', 'enabled', 'visible', 'invisible', 'row', 'col', 'container', 'container-fluid', 'clearfix',
  'flex', 'grid', 'block', 'inline', 'inline-block', 'relative', 'absolute', 'fixed', 'sticky', 'static',
  'truncate', 'underline', 'uppercase', 'lowercase', 'capitalize', 'italic', 'antialiased', 'sr-only',
  'btn', 'collapse', 'collapsed', 'in', 'rounded', 'shadow', 'border', 'grow', 'shrink', 'transition', 'transform', 'outline', 'ring', 'italic', 'pull-left', 'pull-right', 'small', 'large', 'dark', 'light',
]);

const UTILITY_PREFIX =
  /^-?(?:m|p)[trblxyse]?-|^(?:w|h|min-w|min-h|max-w|max-h|gap|space-[xy]|inset|top|left|right|bottom|z|order|col|row|grid-cols|grid-rows|basis|grow|shrink|flex|items|justify|content|self|place|text|font|leading|tracking|bg|border|rounded|shadow|opacity|ring|outline|cursor|select|overflow|transition|duration|ease|delay|animate|transform|scale|rotate|translate|skew|origin|fill|stroke|align|whitespace|break|d|float|position|is|has|js|u|btn|col-sm|col-md|col-lg|col-xl|offset|g|gx|gy|fs|fw|lh|ms|me|ps|pe|mx|my|px|py|mt|mb|ml|mr|pt|pb|pl|pr)-/;

export function looksUtilityClass(cls: string): boolean {
  if (!cls) return true;
  if (/[:[\]/!@]/.test(cls)) return true; // tailwind variants and arbitrary values
  if (UTILITY_EXACT.has(cls)) return true;
  return UTILITY_PREFIX.test(cls);
}

export function stableClasses(classes: string[]): string[] {
  return classes.filter((c) => c.length >= 3 && !looksGenerated(c) && !looksUtilityClass(c));
}

export function isStableId(id: string | null | undefined): boolean {
  return !!id && !looksGenerated(id) && /^[A-Za-z][\w-]*$/.test(id);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export const BASE_SCORES: Record<CandidateKind, number> = {
  testId: 100,
  role: 90,
  label: 85,
  placeholder: 85,
  altText: 85,
  title: 80,
  text: 75,
  scoped: 60,
  css: 45,
  nth: 40,
  coords: 10,
};

const KIND_ORDER: CandidateKind[] = [
  'testId', 'role', 'label', 'placeholder', 'altText', 'title', 'text', 'scoped', 'css', 'nth', 'coords',
];

export interface RankOptions {
  allowCss?: boolean;
}

export function dynamicPenalty(level: number | undefined): number {
  if (!level) return 0;
  return level >= 2 ? 35 : 15;
}

/** Score one candidate given its verification result. Pure. */
export function scoreCandidate(c: Candidate & { dynamicLevel?: number }, v: Verification | null, opts: RankOptions = {}): RankedCandidate {
  const code = c.kind === 'coords' ? 'page.mouse.click(x, y)' : renderChain(c.chain, 'page');
  if (c.kind === 'coords') {
    return { ...c, score: c.base, code, verification: v, usable: true };
  }
  const unique = !!v && v.count === 1 && v.matchesTarget;
  let score = c.base;
  if (c.kind === 'css' && opts.allowCss) score += 25;
  score -= dynamicPenalty(c.dynamicLevel ?? (c.dynamic ? 2 : 0));
  score -= 5 * (c.fromAncestor ?? 0);
  const longest = longestText(c);
  if (longest > 60) score -= 5;
  score = Math.max(1, Math.min(100, score));
  return { ...c, score: unique ? score : 0, code, verification: v, usable: unique };
}

function longestText(c: Candidate): number {
  let n = 0;
  for (const p of c.chain.parts) {
    const t = 'value' in p ? p.value : p.kind === 'role' ? p.name : p.kind === 'filter' ? p.hasText : undefined;
    if (typeof t === 'string') n = Math.max(n, t.length);
  }
  return n;
}

/** Rank already-verified candidates. The best usable one wins; coords is the last resort. */
export function rankCandidates(
  scored: RankedCandidate[],
): LocatorChoice {
  const sorted = [...scored].sort((a, b) => {
    if (a.usable !== b.usable) return a.usable ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
  });
  // Deduplicate identical code (e.g. exact and non-exact producing the same text).
  const seen = new Set<string>();
  const unique = sorted.filter((c) => (seen.has(c.code) ? false : (seen.add(c.code), true)));
  const best = unique.find((c) => c.usable) ?? unique[unique.length - 1];
  return { best, alternatives: unique.filter((c) => c !== best).slice(0, 8) };
}

export function scoreColor(score: number): 'green' | 'amber' | 'red' {
  if (score >= 75) return 'green';
  if (score >= 45) return 'amber';
  return 'red';
}
