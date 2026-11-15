// Verify candidates in the live page: a locator is usable only if it resolves to exactly
// one element AND that element is the one the user acted on.
import type { ElementHandle, Frame, JSHandle } from 'playwright';
import type { Candidate, ElementDescriptor, LocatorChoice, RankedCandidate, TargetRef, Verification } from '../types';
import { buildAllCandidates, NTH_TO_COMPUTE } from './candidates';
import { rankCandidates, scoreCandidate, type RankOptions } from './rank';
import { describeChain, toLocator } from './render';

const frameSelectorCache = new WeakMap<Frame, string[]>();

/** CSS selectors for the iframe chain leading to `frame`, outermost first. */
export async function frameSelectors(frame: Frame): Promise<string[]> {
  if (!frame.parentFrame()) return [];
  const cached = frameSelectorCache.get(frame);
  if (cached) return cached;
  const chain: string[] = [];
  for (let f: Frame | null = frame; f && f.parentFrame(); f = f.parentFrame()) {
    const parent = f.parentFrame()!;
    const el = await f.frameElement();
    const options: string[] = await el.evaluate((node: Element) => {
      const out: string[] = [];
      const tag = node.tagName.toLowerCase();
      const name = node.getAttribute('name');
      if (name) out.push(`${tag}[name="${name.replace(/"/g, '\\"')}"]`);
      const testId = node.getAttribute('data-testid');
      if (testId) out.push(`${tag}[data-testid="${testId.replace(/"/g, '\\"')}"]`);
      if (node.id && /^[A-Za-z][\w-]*$/.test(node.id) && !/\d+$/.test(node.id)) out.push(`#${node.id}`);
      const title = node.getAttribute('title');
      if (title) out.push(`${tag}[title="${title.replace(/"/g, '\\"')}"]`);
      const src = node.getAttribute('src');
      if (src) {
        const p = src.split('?')[0].split('#')[0];
        const last = p.split('/').filter(Boolean).pop();
        if (last) out.push(`${tag}[src*="${last.replace(/"/g, '\\"')}"]`);
      }
      out.push(tag);
      return out;
    });
    let chosen: string | null = null;
    for (const sel of options) {
      try {
        if ((await parent.locator(sel).count()) === 1) {
          chosen = sel;
          break;
        }
      } catch {
        /* invalid selector: try next */
      }
    }
    if (!chosen) {
      const all = await parent.locator(options[options.length - 1]).elementHandles();
      let idx = 0;
      for (let i = 0; i < all.length; i++) if (await all[i].evaluate((a, b) => a === b, el)) idx = i;
      chosen = `${options[options.length - 1]} >> nth=${idx}`;
    }
    chain.unshift(chosen);
  }
  frameSelectorCache.set(frame, chain);
  return chain;
}

async function verifyOne(frame: Frame, c: Candidate, handle: JSHandle | null): Promise<{ cand: Candidate; v: Verification }> {
  try {
    const nthPart = c.chain.parts[c.chain.parts.length - 1];
    if (nthPart && nthPart.kind === 'nth' && nthPart.index === NTH_TO_COMPUTE) {
      const baseChain = { frames: c.chain.frames, parts: c.chain.parts.slice(0, -1) };
      const base = toLocator(frame, baseChain, true);
      const count = await base.count();
      if (count < 2 || !handle) return { cand: c, v: { count, matchesTarget: false } };
      const index = await base.evaluateAll((els, t) => (els as unknown[]).indexOf(t), handle);
      if (index < 0) return { cand: c, v: { count, matchesTarget: false } };
      const fixed: Candidate = { ...c, chain: { frames: c.chain.frames, parts: [...baseChain.parts, { kind: 'nth', index }] } };
      return { cand: fixed, v: { count: 1, matchesTarget: true } };
    }
    const loc = toLocator(frame, c.chain, true);
    const count = await loc.count();
    if (count !== 1) return { cand: c, v: { count, matchesTarget: false } };
    if (!handle) return { cand: c, v: { count, matchesTarget: true, error: 'target detached: identity not confirmed' } };
    const same = await loc.evaluate((el, t) => el === t, handle, { timeout: 2000 });
    return { cand: c, v: { count, matchesTarget: same } };
  } catch (e) {
    return { cand: c, v: { count: 0, matchesTarget: false, error: e instanceof Error ? e.message.split('\n')[0] : String(e) } };
  }
}

export interface ChooseOptions extends RankOptions {
  /** Handles for the element (level 0) and its ancestors (levels 1..3). */
  handles: Map<number, JSHandle | null>;
}

export async function getHandle(frame: Frame, targetId: number | undefined): Promise<ElementHandle | null> {
  if (!targetId) return null;
  try {
    const h = (await frame.evaluateHandle(`window.__tphub && window.__tphub.getTarget(${Number(targetId)})`)) as JSHandle<unknown>;
    const el = h.asElement() as ElementHandle<Element> | null;
    if (!el) {
      await h.dispose();
      return null;
    }
    const connected = await el.evaluate((n: Element) => n.isConnected);
    return connected ? el : null;
  } catch {
    return null;
  }
}

/** Build, verify and rank all candidates for a descriptor in `frame`. */
export async function chooseLocator(frame: Frame, d: ElementDescriptor, opts: Partial<ChooseOptions> = {}): Promise<LocatorChoice> {
  const frames = await frameSelectors(frame);
  const handles = opts.handles ?? new Map<number, JSHandle | null>();
  if (!handles.has(0)) handles.set(0, await getHandle(frame, d.targetId));
  for (const a of d.ancestors ?? []) if (!handles.has(a.level)) handles.set(a.level, await getHandle(frame, a.targetId));
  const candidates = buildAllCandidates(d, frames);
  const ranked: RankedCandidate[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (c.kind === 'coords') {
      ranked.push(scoreCandidate(c, null, opts));
      continue;
    }
    const key = JSON.stringify(c.chain);
    if (seen.has(key)) continue;
    seen.add(key);
    const { cand, v } = await verifyOne(frame, c, handles.get(c.fromAncestor ?? 0) ?? null);
    // .nth() is only meaningful when its base matches several elements
    if (cand.chain.parts.some((p) => p.kind === 'nth' && p.index === NTH_TO_COMPUTE)) continue;
    const r = scoreCandidate(cand, v, opts);
    if (v.error && v.matchesTarget) r.warnings = [...r.warnings, v.error];
    if (!r.usable && v.count > 1) r.warnings = [...r.warnings, `matches ${v.count} elements`];
    if (!r.usable && v.count === 0) r.warnings = [...r.warnings, v.error ? `not resolvable: ${v.error}` : 'matches nothing'];
    if (!r.usable && v.count === 1 && !v.matchesTarget) r.warnings = [...r.warnings, 'matches a different element'];
    ranked.push(r);
  }
  return rankCandidates(ranked);
}

/** Convert a choice + descriptor into the reference stored on a step. */
export function toTargetRef(choice: LocatorChoice, d: ElementDescriptor): TargetRef {
  const b = choice.best;
  const ancestor = b.fromAncestor ? d.ancestors?.find((a) => a.level === b.fromAncestor) : undefined;
  const src = ancestor ?? d;
  return {
    chain: b.chain,
    code: b.code,
    score: b.score,
    kind: b.kind,
    warnings: b.warnings,
    role: src.role,
    name: src.name,
    tag: src.tag,
    text: src.text,
    inputType: src.inputType,
    label: src.label,
    placeholder: src.placeholder,
    testId: src.testId,
    nameAttr: src.nameAttr,
    anchor: b.anchor ?? null,
    describe: b.kind === 'coords' ? `point (${Math.round(d.rect.x + d.rect.width / 2)}, ${Math.round(d.rect.y + d.rect.height / 2)})` : describeChain(b.chain),
    rect: d.rect,
  };
}
