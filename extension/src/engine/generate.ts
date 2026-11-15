/**
 * The rule pipeline: element in, ranked + verified locator candidates out.
 *
 *   1. semantic rules   test id, id, role + name, label, placeholder, name, alt, title, text
 *   2. structural rules shortest unique CSS, relative XPath
 *   3. anchoring rules  repeating container + text, or unique region + inner locator
 *   4. scoring + trace  every candidate is checked against the live DOM; rejects are recorded with a reason
 */
import { LOCATOR_ROLES, getRole } from './a11y';
import { AnchorInfo, findAnchors } from './anchor';
import { PageCtx, cssAttr, inShadow, normalizeText } from './ctx';
import { buildCss, nthPath, simpleSelectors } from './css';
import { badgeSplit, dynamicRegexSource, hasDynamicNumber, isDynamicToken, isMostlyNumeric, isStableValue, numericBadges } from './dynamic';
import { javaString, pwStep, tsString } from './emit';
import { suggestName } from './naming';
import { byAttr, byLabel, byRole, byText, labelTexts, xpathAll } from './queries';
import type { Candidate, ElementInfo, FrameRef, PickResult, Rejection, Stability, Step, TextMatch } from './types';
import { buildXpaths, relativeXpath, xpathLiteral } from './xpath';

export interface GenerateOptions {
  frames?: FrameRef[];
  skipAnchors?: boolean;
  retargetedFrom?: string;
}

interface StepCand {
  strategy: string;
  step: Step;
  score: number;
  notes: string[];
}

const SCORE = {
  testid: 100, role: 92, label: 88, id: 86, placeholder: 84, heading: 84, nameAttr: 80, img: 80, alt: 78,
  text: 74, title: 72, cssAttr: 66, roleOnlyScoped: 62, xpathText: 60, cssClass: 58, xpathAttr: 56,
  roleOnlyGlobal: 52, cssTag: 48, xpathClass: 46, xpathIndexed: 28,
};

export function stabilityOf(score: number): Stability {
  return score >= 80 ? 'high' : score >= 50 ? 'medium' : 'low';
}

type Resolved = { m: TextMatch; notes: string[]; penalty: number } | { fail: string };

/**
 * Text matching rule shared by role name, label, placeholder, alt, title and text:
 * try a number-tolerant regex, then Playwright's default substring match, then exact.
 */
function resolveMatch(raw: string, find: (m: TextMatch) => Element[], el: Element, allowDescendant = false): Resolved {
  const text = normalizeText(raw);
  const badge = badgeSplit(text, numericBadges(el));
  const hit = (m: TextMatch) => {
    const found = find(m);
    const same = found.length === 1 && (found[0] === el || (allowDescendant && el.contains(found[0])));
    return { n: found.length, ok: same };
  };

  if (badge) {
    const m: TextMatch = { kind: 'regex', source: badge.source, flags: '' };
    if (hit(m).ok) return { m, notes: ['the number comes from a counter badge inside the element, so any count is accepted'], penalty: 2 };
  }
  const dyn = dynamicRegexSource(text);
  if (dyn) {
    const m: TextMatch = { kind: 'regex', source: dyn, flags: '' };
    if (hit(m).ok) return { m, notes: ['numbers in the text look dynamic (counts, prices), so they are matched with a regex'], penalty: 2 };
  }
  const numberPenalty = hasDynamicNumber(text) || badge ? 12 : 0;
  const numberNote = numberPenalty ? ['contains a number that may change between runs'] : [];

  const sub: TextMatch = { kind: 'string', value: text, exact: false };
  const s = hit(sub);
  if (s.ok) return { m: sub, notes: numberNote, penalty: numberPenalty };

  const exact: TextMatch = { kind: 'string', value: text, exact: true };
  const e = hit(exact);
  if (e.ok) {
    return { m: exact, notes: [`exact: true is needed because ${s.n} elements contain this text`, ...numberNote], penalty: 1 + numberPenalty };
  }
  return { fail: e.n === 0 ? `resolves to a different element (${s.n} contain the text)` : `${e.n} exact matches, ${s.n} partial` };
}

const FORM_CONTROL = new Set(['input', 'select', 'textarea']);

/** Rules 1: locators that say what the element is. Counts are taken inside `scope` when given. */
function semanticSteps(el: Element, ctx: PageCtx, scope: Element | undefined, rejected: Rejection[]): StepCand[] {
  const out: StepCand[] = [];
  const tag = el.localName;

  for (const attr of ctx.settings.testIdAttrs) {
    const value = el.getAttribute(attr);
    if (!value) continue;
    const step: Step = { kind: 'testid', attr, value };
    const n = ctx.count(`[${attr}=${cssAttr(value)}]`, scope);
    if (n === 1) {
      const dynamic = /\d{4,}/.test(value);
      out.push({
        strategy: 'testid',
        step,
        score: SCORE.testid - (dynamic ? 20 : 0),
        notes: [`${attr} is a dedicated test attribute`, ...(dynamic ? ['value contains a long number and may be generated'] : [])],
      });
    } else {
      rejected.push({ locator: pwStep(step), reason: `${n} elements share this ${attr}` });
    }
    break;
  }

  const id = el.getAttribute('id');
  if (id) {
    const step: Step = { kind: 'id', id };
    if (isDynamicToken(id)) {
      rejected.push({ locator: `#${id}`, reason: 'id looks generated (hash or counter), so it will change' });
    } else if (ctx.queryAll(pwStepCss(step), scope).length === 1) {
      out.push({ strategy: 'id', step, score: SCORE.id, notes: ['id is unique and looks hand-written'] });
    } else {
      rejected.push({ locator: `#${id}`, reason: 'id is duplicated on the page' });
    }
  }

  const role = getRole(el);
  if (role && LOCATOR_ROLES.has(role) && !ctx.isHidden(el)) {
    const name = ctx.accName(el);
    const base = role === 'heading' ? SCORE.heading : role === 'img' ? SCORE.img : SCORE.role;
    if (name && name.length <= 80 && !isMostlyNumeric(name)) {
      const r = resolveMatch(name, (m) => byRole(ctx, role, m, scope), el);
      if ('m' in r) {
        out.push({
          strategy: 'role',
          step: { kind: 'role', role, name: r.m },
          score: base - r.penalty,
          notes: [`role "${role}" with accessible name: what a user and a screen reader see`, ...r.notes],
        });
      } else {
        rejected.push({ locator: `getByRole(${tsString(role)}, { name: ${tsString(name)} })`, reason: r.fail });
      }
    } else {
      const all = byRole(ctx, role, undefined, scope);
      if (all.length === 1 && all[0] === el) {
        out.push({
          strategy: 'role',
          step: { kind: 'role', role },
          score: scope ? SCORE.roleOnlyScoped : SCORE.roleOnlyGlobal,
          notes: [
            name ? 'accessible name is not usable (numeric or too long)' : 'element has no accessible name',
            scope ? `it is the only ${role} inside the container` : `it is the only ${role} on the page right now`,
          ],
        });
      } else {
        rejected.push({
          locator: `getByRole(${tsString(role)})`,
          reason: `no usable accessible name and ${all.length} elements have this role. Ask the developers for an aria-label or test id`,
        });
      }
    }
  }

  if (FORM_CONTROL.has(tag)) {
    const label = labelTexts(el)[0];
    if (label && label.length <= 80) {
      const r = resolveMatch(label, (m) => byLabel(ctx, m, scope), el);
      if ('m' in r) out.push({ strategy: 'label', step: { kind: 'label', text: r.m }, score: SCORE.label - r.penalty, notes: ['matched by its label text', ...r.notes] });
      else rejected.push({ locator: `getByLabel(${tsString(label)})`, reason: r.fail });
    }
  }

  const attrRules: ['placeholder' | 'alt' | 'title', number][] = [
    ['placeholder', SCORE.placeholder],
    ['alt', SCORE.alt],
    ['title', SCORE.title],
  ];
  for (const [attr, score] of attrRules) {
    const value = normalizeText(el.getAttribute(attr));
    if (!value || value.length > 80) continue;
    const r = resolveMatch(value, (m) => byAttr(ctx, attr, m, scope), el);
    if ('m' in r) out.push({ strategy: attr, step: { kind: attr, text: r.m }, score: score - r.penalty, notes: [`matched by its ${attr} attribute`, ...r.notes] });
    else rejected.push({ locator: `${attr}=${tsString(value)}`, reason: r.fail });
  }

  const nameAttr = el.getAttribute('name');
  if (nameAttr && FORM_CONTROL.has(tag)) {
    const step: Step = { kind: 'nameAttr', tag, value: nameAttr };
    if (!isStableValue(nameAttr)) rejected.push({ locator: `[name="${nameAttr}"]`, reason: 'name attribute looks generated' });
    else if (ctx.count(`${tag}[name=${cssAttr(nameAttr)}]`, scope) === 1) out.push({ strategy: 'name', step, score: SCORE.nameAttr, notes: ['form field name attribute'] });
    else rejected.push({ locator: `[name="${nameAttr}"]`, reason: 'several fields share this name' });
  }

  if (!FORM_CONTROL.has(tag)) {
    const full = normalizeText(el.textContent);
    const compact = el.querySelectorAll('*').length <= 8;
    if (full.length >= 2 && compact && !isMostlyNumeric(full)) {
      let text = full;
      const notes = ['matched by its visible text'];
      let penalty = 0;
      if (full.length > 60) {
        text = full.slice(0, 45).replace(/\s+\S*$/, '');
        notes.push('text is long, so only the beginning is used');
        penalty = 8;
      }
      const r = resolveMatch(text, (m) => byText(ctx, m, scope), el, true);
      if ('m' in r) out.push({ strategy: 'text', step: { kind: 'text', text: r.m }, score: SCORE.text - r.penalty - penalty, notes: [...notes, ...r.notes] });
      else rejected.push({ locator: `getByText(${tsString(text)})`, reason: r.fail });
    }
  }
  return out;
}

function pwStepCss(step: Step & { kind: 'id' }): string {
  return `[id=${cssAttr(step.id)}]`;
}

/** Selenium By for a top-level step, or null when Selenium has no equivalent. Each form is re-verified. */
function seleniumFor(step: Step, el: Element, ctx: PageCtx): string | null {
  const onlyCss = (sel: string) => {
    const found = ctx.queryAll(sel);
    return found.length === 1 && found[0] === el;
  };
  switch (step.kind) {
    case 'testid':
      return `By.cssSelector(${javaString(`[${step.attr}=${cssAttr(step.value)}]`)})`;
    case 'id':
      return `By.id(${javaString(step.id)})`;
    case 'nameAttr':
      return `By.name(${javaString(step.value)})`;
    case 'css':
      return `By.cssSelector(${javaString(step.selector)})`;
    case 'xpath':
      return `By.xpath(${javaString(step.expr)})`;
    case 'placeholder':
    case 'alt':
    case 'title': {
      if (step.text.kind !== 'string') return null;
      const sel = `[${step.kind}${step.text.exact ? '' : '*'}=${cssAttr(step.text.value)}]`;
      return onlyCss(sel) ? `By.cssSelector(${javaString(sel)})` : null;
    }
    case 'text': {
      if (el.localName !== 'a' || step.text.kind !== 'string' || hasDynamicNumber(step.text.value) || numericBadges(el).length) return null;
      const value = step.text.value;
      const links = ctx.queryAll('a');
      if (links.filter((a) => normalizeText(a.textContent) === value).length === 1) return `By.linkText(${javaString(value)})`;
      return links.filter((a) => normalizeText(a.textContent).includes(value)).length === 1
        ? `By.partialLinkText(${javaString(value)})`
        : null;
    }
    default:
      return null;
  }
}

function anchorPrefixPw(a: AnchorInfo, root: string, textExpr: string | null): string {
  const base = `${root}.locator(${tsString(a.css)})`;
  if (!a.repeating || a.text === undefined) return base;
  const t = textExpr ?? tsString(a.text);
  // With a parameter the caller passes any row's text, so the match has to be exact ("Router" vs "Router Pro").
  if (a.textMode === 'exact' || textExpr !== null) {
    const pageRef = root.startsWith('this.') ? 'this.page' : 'page';
    return `${base}.filter({ has: ${pageRef}.getByText(${t}, { exact: true }) })`;
  }
  return `${base}.filter({ hasText: ${t} })`;
}

const PARAM_MARK = '@@LS_TEXT@@';

function anchorXpath(a: AnchorInfo, literal: string, forceExact = false): string {
  if (!a.repeating || a.text === undefined) return a.xpath;
  return a.textMode === 'exact' || forceExact
    ? `${a.xpath}[.//*[normalize-space()=${literal}]]`
    : `${a.xpath}[contains(normalize-space(.), ${literal})]`;
}

/** Rules 3: locators built from a container plus something unique inside it. */
function anchoredCandidates(el: Element, ctx: PageCtx, root: string, existing: Candidate[]): Candidate[] {
  const out: Candidate[] = [];
  const shadow = inShadow(el);
  for (const a of findAnchors(el, ctx)) {
    const inner: StepCand[] = semanticSteps(el, ctx, a.el, []);
    for (const s of simpleSelectors(el, ctx)) {
      const found = ctx.queryAll(s.sel, a.el);
      if (found.length === 1 && found[0] === el) {
        const score = s.kind === 'attr' ? SCORE.cssAttr : s.kind === 'class' ? SCORE.cssClass : SCORE.cssTag;
        inner.push({ strategy: 'css', step: { kind: 'css', selector: s.sel }, score, notes: ['the only element matching this selector inside the container'] });
        break;
      }
    }
    if (!inner.length) {
      const path = nthPath(a.el, el);
      if (path) {
        const found = ctx.queryAll(path.path, a.el);
        if (found.length === 1 && found[0] === el) {
          inner.push({ strategy: 'css', step: { kind: 'css', selector: path.path }, score: 36, notes: ['position-based path inside the container (brittle)'] });
        }
      }
    }
    inner.sort((x, y) => y.score - x.score);

    for (const ic of inner.slice(0, 2)) {
      const stepCode = pwStep(ic.step);
      if (existing.some((c) => c.playwright === `${root}.${stepCode}`)) continue; // already unique without the anchor
      const playwright = `${anchorPrefixPw(a, root, null)}.${stepCode}`;

      let selenium: string | null = null;
      let seleniumParam: string | null = null;
      if (!shadow && a.xpath) {
        const rel = relativeXpath(el, a.el, ctx);
        if (rel) {
          const full = `${anchorXpath(a, xpathLiteral(a.text ?? ''))}${rel.path}`;
          const found = xpathAll(ctx, full);
          if (found.length === 1 && found[0] === el) {
            selenium = `By.xpath(${javaString(full)})`;
            if (a.repeating) {
              const [before, after] = `${anchorXpath(a, `'${PARAM_MARK}'`, true)}${rel.path}`.split(PARAM_MARK);
              seleniumParam = `By.xpath(${javaString(before)} + text + ${javaString(after)})`;
            }
          }
        }
      }

      const candidate: Candidate = {
        strategy: `anchored-${ic.strategy}`,
        score: ic.score - (a.repeating ? 8 : 5),
        stability: 'low',
        playwright,
        selenium,
        notes: [
          a.repeating
            ? `anchored to the repeating container ${a.css} (${a.count} on the page), picked by its text "${a.text}"`
            : `scoped to the unique region ${a.css}`,
          ...ic.notes,
        ],
      };
      if (a.repeating && a.text !== undefined) {
        const thisRoot = root.replace(/^page/, 'this.page');
        candidate.param = {
          playwright: `${anchorPrefixPw(a, thisRoot, 'text')}.${stepCode}`,
          selenium: seleniumParam,
          sample: a.text,
          key: `${a.css}|${stepCode}`,
        };
        candidate.notes.push('exported as a method taking the row text, so one locator covers every row');
      }
      out.push(candidate);
    }
  }
  return out;
}

export function describe(el: Element, ctx: PageCtx, opts: GenerateOptions = {}): ElementInfo {
  const role = getRole(el);
  const name = ctx.accName(el);
  const text = normalizeText(el.textContent);
  return {
    tag: el.localName,
    role,
    name,
    text: text.length > 80 ? `${text.slice(0, 77)}...` : text,
    suggestedName: suggestName(el, ctx, role, name),
    inShadow: inShadow(el),
    frames: opts.frames ?? [],
    retargetedFrom: opts.retargetedFrom,
  };
}

export function generate(el: Element, ctx: PageCtx, opts: GenerateOptions = {}): PickResult {
  const started = performance.now();
  const rejected: Rejection[] = [];
  const candidates: Candidate[] = [];
  const frames = opts.frames ?? [];
  const root = `page${frames.map((f) => `.frameLocator(${tsString(f.selector)})`).join('')}`;
  const shadow = inShadow(el);
  const shadowNote = shadow ? ['inside shadow DOM: Playwright pierces it automatically, Selenium needs getShadowRoot()'] : [];

  const add = (strategy: string, score: number, notes: string[], step: Step) => {
    candidates.push({
      strategy,
      score,
      stability: 'low',
      playwright: `${root}.${pwStep(step)}`,
      selenium: shadow ? null : seleniumFor(step, el, ctx),
      notes: [...notes, ...shadowNote],
    });
  };

  for (const sc of semanticSteps(el, ctx, undefined, rejected)) add(sc.strategy, sc.score, sc.notes, sc.step);

  const css = buildCss(el, ctx);
  if (css) {
    const base = css.kind === 'attr' ? SCORE.cssAttr : css.kind === 'class' ? SCORE.cssClass : SCORE.cssTag;
    const notes = [css.hops ? `CSS scoped through ${css.hops} ancestor level${css.hops > 1 ? 's' : ''}` : 'shortest unique CSS selector'];
    if (css.kind === 'class') notes.push('relies on class names, which change with restyling');
    if (css.nth) notes.push('uses :nth-of-type, so it breaks when the order changes');
    add('css', base - Math.min(css.hops, 4) * 4 - (css.nth ? 18 : 0), notes, { kind: 'css', selector: css.selector });
  } else {
    rejected.push({ locator: 'CSS', reason: 'no unique CSS selector could be built' });
  }

  for (const xp of buildXpaths(el, ctx)) {
    const score = xp.kind === 'attr' ? SCORE.xpathAttr : xp.kind === 'text' ? SCORE.xpathText : xp.kind === 'class' ? SCORE.xpathClass : SCORE.xpathIndexed;
    const notes = [xp.kind === 'indexed' ? 'position-based XPath: last resort, breaks when the layout changes' : `relative XPath on ${xp.kind === 'text' ? 'visible text' : xp.kind === 'attr' ? 'a stable attribute' : 'a class name'}`];
    if (xp.note) notes.push(xp.note);
    add('xpath', score, notes, { kind: 'xpath', expr: xp.expr });
  }
  if (shadow) rejected.push({ locator: 'XPath', reason: 'XPath cannot reach into shadow DOM' });

  const best = candidates.reduce((m, c) => Math.max(m, c.score), 0);
  if (!opts.skipAnchors && best < 80) candidates.push(...anchoredCandidates(el, ctx, root, candidates));

  candidates.sort((a, b) => b.score - a.score);
  const unique: Candidate[] = [];
  for (const c of candidates) {
    if (unique.some((u) => u.playwright === c.playwright || (c.selenium !== null && u.selenium === c.selenium))) continue;
    c.stability = stabilityOf(c.score);
    unique.push(c);
  }

  return {
    info: describe(el, ctx, opts),
    candidates: unique.slice(0, 8),
    rejected,
    ms: Math.round((performance.now() - started) * 10) / 10,
    url: ctx.doc.location?.href ?? '',
  };
}
