// Build locator candidates for an element descriptor. Pure: no browser needed.
import type { Candidate, ElementDescriptor, LocatorChain, LocatorPart, TextMatch } from '../types';
import { BASE_SCORES, dynamicInfo, isStableId, stableClasses, stableRegex } from './rank';

/** Roles that are never useful in getByRole. */
const SKIP_ROLES = new Set(['generic', 'none', 'presentation', 'paragraph', 'text', 'strong', 'emphasis', 'time', 'code']);

/** Marker index meaning "verify.ts must compute the real nth index". */
export const NTH_TO_COMPUTE = -99;

interface TextChoice {
  match: TextMatch;
  level: 0 | 1 | 2;
  warnings: string[];
}

/** Choose the literal text, or a regex of its steady part when the text looks dynamic. */
function textChoices(text: string, what: string): TextChoice[] {
  const info = dynamicInfo(text);
  if (info.level === 0) return [{ match: text, level: 0, warnings: [] }];
  const out: TextChoice[] = [];
  const re = stableRegex(text);
  if (re) {
    out.push({
      match: { regex: re },
      level: 1,
      warnings: [`${what} "${text}" looks dynamic (${info.reasons.join(', ')}); matched its steady part with a regex`],
    });
  }
  out.push({ match: text, level: info.level, warnings: [`${what} "${text}" looks dynamic (${info.reasons.join(', ')})`] });
  return out;
}

function cssEscapeIdent(s: string): string {
  return s.replace(/([^\w-])/g, '\\$1');
}

function chain(frames: string[], ...parts: LocatorPart[]): LocatorChain {
  return { frames: [...frames], parts };
}

/** Parts that locate the element *inside* a repeated container (for scoped locators). */
function innerParts(d: ElementDescriptor): { part: LocatorPart; level: 0 | 1 | 2 } | null {
  if (d.role && !SKIP_ROLES.has(d.role) && d.name) {
    const c = textChoices(d.name, 'name')[0];
    return { part: { kind: 'role', role: d.role, name: c.match }, level: c.level };
  }
  if (d.testId) return { part: { kind: 'testId', value: d.testId }, level: 0 };
  if (d.placeholder) return { part: { kind: 'placeholder', value: d.placeholder }, level: 0 };
  if (d.text && d.text.length <= 60) {
    const c = textChoices(d.text, 'text')[0];
    return { part: { kind: 'text', value: c.match }, level: c.level };
  }
  const cls = stableClasses(d.classes)[0];
  if (cls) return { part: { kind: 'css', selector: `.${cssEscapeIdent(cls)}` }, level: 0 };
  if (d.role && !SKIP_ROLES.has(d.role)) return { part: { kind: 'role', role: d.role }, level: 0 };
  return null;
}

export function containerPart(r: NonNullable<ElementDescriptor['repeat']>): LocatorPart | null {
  if (r.containerRole && ['row', 'listitem', 'article', 'option', 'treeitem', 'gridcell', 'tab', 'menuitem'].includes(r.containerRole)) {
    return { kind: 'role', role: r.containerRole };
  }
  if (r.containerTestId) return { kind: 'testId', value: r.containerTestId };
  const cls = stableClasses(r.containerClasses)[0];
  if (cls) return { kind: 'css', selector: `.${cssEscapeIdent(cls)}` };
  // custom elements (<user-card>) are stable component names
  if (r.containerTag.includes('-') && /^[a-z][a-z0-9-]*$/.test(r.containerTag)) return { kind: 'css', selector: r.containerTag };
  return null;
}

/**
 * All candidates for one element, in the order of section 4.4.
 * `frames` are the iframe selectors leading to the element's frame.
 */
export function buildCandidates(d: ElementDescriptor, frames: string[] = [], fromAncestor = 0): Candidate[] {
  const out: Candidate[] = [];
  const add = (c: Omit<Candidate, 'fromAncestor'>) => out.push({ ...c, fromAncestor });

  // 1. test id
  if (d.testId) {
    const info = dynamicInfo(d.testId);
    add({
      kind: 'testId',
      chain: chain(frames, { kind: 'testId', value: d.testId }),
      base: BASE_SCORES.testId,
      dynamic: info.level > 0 && /\d{3,}/.test(d.testId),
      dynamicLevel: /\d{3,}/.test(d.testId) ? 1 : 0,
      warnings: /\d{3,}/.test(d.testId) ? [`test id "${d.testId}" contains a number that may change`] : [],
    });
  }

  // 2. role + accessible name
  const role = d.role && !SKIP_ROLES.has(d.role) ? d.role : null;
  if (role && d.name) {
    for (const c of textChoices(d.name, 'Accessible name')) {
      add({ kind: 'role', chain: chain(frames, { kind: 'role', role, name: c.match }), base: BASE_SCORES.role, dynamic: c.level > 0, dynamicLevel: c.level, warnings: c.warnings });
      if (typeof c.match === 'string') {
        add({ kind: 'role', chain: chain(frames, { kind: 'role', role, name: c.match, exact: true }), base: BASE_SCORES.role - 1, dynamic: c.level > 0, dynamicLevel: c.level, warnings: c.warnings });
      }
    }
  }
  if (role) {
    add({ kind: 'role', chain: chain(frames, { kind: 'role', role }), base: 65, dynamic: false, dynamicLevel: 0, warnings: ['locator has no name; it is only unique while the page has one such element'] });
  }

  // 3. label, placeholder, alt, title
  const attrKinds: Array<['label' | 'placeholder' | 'altText' | 'title', string | null]> = [
    ['label', d.label],
    ['placeholder', d.placeholder],
    ['altText', d.alt],
    ['title', d.title],
  ];
  for (const [kind, value] of attrKinds) {
    if (!value) continue;
    for (const c of textChoices(value, kind)) {
      add({ kind, chain: chain(frames, { kind, value: c.match }), base: BASE_SCORES[kind], dynamic: c.level > 0, dynamicLevel: c.level, warnings: c.warnings });
      if (typeof c.match === 'string') {
        add({ kind, chain: chain(frames, { kind, value: c.match, exact: true }), base: BASE_SCORES[kind] - 1, dynamic: c.level > 0, dynamicLevel: c.level, warnings: c.warnings });
      }
    }
  }

  // 4. visible text (not for form fields, whose "text" is their value)
  const isField = ['input', 'select', 'textarea'].includes(d.tag);
  if (!isField && d.text && d.text.length <= 80) {
    for (const c of textChoices(d.text, 'Text')) {
      if (typeof c.match === 'string') {
        // exact first: getByText matches substrings by default
        add({ kind: 'text', chain: chain(frames, { kind: 'text', value: c.match, exact: true }), base: BASE_SCORES.text, dynamic: c.level > 0, dynamicLevel: c.level, warnings: c.warnings });
        add({ kind: 'text', chain: chain(frames, { kind: 'text', value: c.match }), base: BASE_SCORES.text - 1, dynamic: c.level > 0, dynamicLevel: c.level, warnings: c.warnings });
      } else {
        add({ kind: 'text', chain: chain(frames, { kind: 'text', value: c.match }), base: BASE_SCORES.text, dynamic: true, dynamicLevel: c.level, warnings: c.warnings });
      }
    }
  }

  // 5. CSS from a steady id, name attribute or class
  const cssWarn = 'CSS selector: breaks when the markup changes. Ask developers for a test id.';
  if (isStableId(d.id)) {
    add({ kind: 'css', chain: chain(frames, { kind: 'css', selector: `#${cssEscapeIdent(d.id!)}` }), base: BASE_SCORES.css, dynamic: false, dynamicLevel: 0, warnings: [cssWarn] });
  }
  if (d.nameAttr && isField && !/\d{3,}/.test(d.nameAttr)) {
    add({ kind: 'css', chain: chain(frames, { kind: 'css', selector: `${d.tag}[name="${d.nameAttr.replace(/"/g, '\\"')}"]` }), base: BASE_SCORES.css - 2, dynamic: false, dynamicLevel: 0, warnings: [cssWarn] });
  }
  const cls = stableClasses(d.classes);
  if (cls.length) {
    add({ kind: 'css', chain: chain(frames, { kind: 'css', selector: `${d.tag}.${cls.slice(0, 2).map(cssEscapeIdent).join('.')}` }), base: 30, dynamic: false, dynamicLevel: 0, warnings: [cssWarn] });
  }

  // 6. scoped locator for repeated rows/cards
  if (d.repeat && d.repeat.anchorText && d.repeat.siblings >= 2) {
    const cont = containerPart(d.repeat);
    const inner = innerParts(d);
    if (cont && inner) {
      const anchorChoice = textChoices(d.repeat.anchorText, 'Row text')[0];
      const level = Math.max(anchorChoice.level, inner.level) as 0 | 1 | 2;
      add({
        kind: 'scoped',
        chain: chain(frames, cont, { kind: 'filter', hasText: anchorChoice.match }, inner.part),
        base: BASE_SCORES.scoped + (inner.part.kind === 'role' || inner.part.kind === 'testId' ? 5 : 0),
        dynamic: level > 0,
        dynamicLevel: level,
        warnings: anchorChoice.warnings,
        anchor: typeof anchorChoice.match === 'string' ? anchorChoice.match : null,
      });
    }
  }

  // 7. nth() on the best non-unique semantic locator (index computed during verification)
  const nthBases: LocatorPart[] = [];
  if (role && d.name) nthBases.push({ kind: 'role', role, name: textChoices(d.name, 'name')[0].match });
  if (!isField && d.text && d.text.length <= 60) nthBases.push({ kind: 'text', value: textChoices(d.text, 'text')[0].match, exact: true });
  if (cls.length) nthBases.push({ kind: 'css', selector: `${d.tag}.${cssEscapeIdent(cls[0])}` });
  if (role) nthBases.push({ kind: 'role', role });
  for (const b of nthBases) {
    add({
      kind: 'nth',
      chain: chain(frames, b, { kind: 'nth', index: NTH_TO_COMPUTE }),
      base: BASE_SCORES.nth,
      dynamic: false,
      dynamicLevel: 0,
      warnings: ['position-based locator (.nth): breaks when items are added, removed or reordered'],
    });
  }

  return out;
}

export function coordsCandidate(): Candidate {
  return {
    kind: 'coords',
    chain: { frames: [], parts: [] },
    base: BASE_SCORES.coords,
    dynamic: false,
    dynamicLevel: 0,
    warnings: ['no unique locator found: falls back to a coordinate click, which breaks when the layout changes'],
  };
}

/**
 * Candidates for the element and, when it has no strong locator of its own,
 * for up to 3 ancestors that are not much larger than it (icon inside a button).
 */
export function buildAllCandidates(d: ElementDescriptor, frames: string[] = []): Candidate[] {
  const out = buildCandidates(d, frames, 0);
  // Ancestor candidates carry a -5 per level penalty in ranking, so they only win
  // when the element's own candidates are weak or not unique.
  if (d.ancestors) {
    const area = Math.max(1, d.rect.width * d.rect.height);
    for (const a of d.ancestors) {
      const aArea = a.rect.width * a.rect.height;
      const interactive = !!a.role && ['button', 'link', 'menuitem', 'tab', 'checkbox', 'radio', 'option', 'switch', 'treeitem'].includes(a.role);
      if (!interactive && aArea > area * 4) continue;
      out.push(...buildCandidates(a as ElementDescriptor, frames, a.level));
    }
  }
  out.push(coordsCandidate());
  return out;
}
