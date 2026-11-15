// Compact page snapshots (taken in the page by page-core.js) and turning raw diff
// suggestions into verified assertions.
import type { Frame, Page } from 'playwright';
import { containerPart } from '../locators/candidates';
import { describeChain, renderChain, toLocator } from '../locators/render';
import { chooseLocator, frameSelectors, toTargetRef } from '../locators/verify';
import type { RawSuggestion } from '../suggest/suggest';
import type { Assertion, PageSnapshot, RepeatGroup, SnapElement, Suggestion, TargetRef } from '../types';
import { retryOnce } from '../util/lock';

export interface SnapshotResult {
  snap: PageSnapshot;
  frameOf: Map<SnapElement, Frame>;
  page: Page;
}

/** Snapshot the main frame plus `extraFrame` (the frame the user acted in, if it is a child frame). */
export async function takeSnapshot(page: Page, extraFrame?: Frame | null): Promise<SnapshotResult> {
  return retryOnce('Page snapshot', async () => {
    const main = page.mainFrame();
    const snap = (await main.evaluate('window.__tphub ? window.__tphub.snapshot() : null')) as PageSnapshot | null;
    const result: PageSnapshot = snap ?? { url: page.url(), title: await page.title().catch(() => ''), elements: [], groups: [], focusedKey: null };
    const frameOf = new Map<SnapElement, Frame>();
    for (const el of result.elements) frameOf.set(el, main);
    const frames = new Set<Frame>(page.frames().filter((f) => f !== main && !f.isDetached()).slice(0, 4));
    if (extraFrame && extraFrame !== main) frames.add(extraFrame);
    for (const f of frames) {
      const sub = (await f.evaluate('window.__tphub ? window.__tphub.snapshot() : null').catch(() => null)) as PageSnapshot | null;
      if (!sub) continue;
      const chain = await frameSelectors(f).catch(() => [] as string[]);
      const prefix = 'frame:' + chain.join('>') + '|';
      for (const el of sub.elements) {
        el.key = prefix + el.key;
        el.frames = chain;
        result.elements.push(el);
        frameOf.set(el, f);
      }
      for (const g of sub.groups) result.groups.push({ ...g, key: prefix + g.key });
    }
    return { snap: result, frameOf, page };
  });
}

export function headingOf(snap: PageSnapshot): string | null {
  const h1 = snap.elements.find((e) => e.d.role === 'heading' && e.d.headingLevel === 1 && !e.frames);
  return h1 ? h1.d.name || h1.d.text || null : null;
}

/** Locate disappearing things (spinners, dialogs, alerts) while they still exist. */
export async function resolveVolatile(res: SnapshotResult, allowCss: boolean, max = 5): Promise<void> {
  const vol = res.snap.elements.filter((e) => e.volatile && e.volatile !== 'status').slice(0, max);
  for (const el of vol) {
    const frame = res.frameOf.get(el);
    if (!frame) continue;
    try {
      const choice = await chooseLocator(frame, el.d, { allowCss });
      el.locator = choice.best.usable && choice.best.kind !== 'coords' && choice.best.score >= 40 ? toTargetRef(choice, el.d) : null;
    } catch {
      el.locator = null;
    }
  }
}

async function groupTarget(res: SnapshotResult, g: RepeatGroup, expected: number): Promise<TargetRef | null> {
  const part = containerPart({ containerRole: g.role, containerTag: g.tag, containerClasses: g.classes, containerTestId: g.testId, siblings: g.count, anchorText: null, index: 0 });
  const options = [part, g.classes[0] ? { kind: 'css' as const, selector: '.' + g.classes[0] } : null].filter(Boolean);
  const frame = res.page.mainFrame();
  for (const p of options) {
    const chain = { frames: [], parts: [p!] };
    try {
      const count = await toLocator(frame, chain, true).count();
      if (count === expected) {
        return {
          chain,
          code: renderChain(chain),
          score: p!.kind === 'role' ? 80 : 50,
          kind: p!.kind === 'role' ? 'role' : p!.kind === 'testId' ? 'testId' : 'css',
          warnings: [],
          role: g.role,
          name: '',
          tag: g.tag,
          text: '',
          inputType: null,
          label: null,
          placeholder: null,
          testId: g.testId,
          nameAttr: null,
          anchor: null,
          describe: describeChain(chain) + ' items',
        };
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Turn raw diff suggestions into verified ones (max 6), the top one accepted. */
export async function resolveSuggestions(
  raws: RawSuggestion[],
  before: SnapshotResult,
  after: SnapshotResult,
  opts: { allowCss: boolean; max?: number; idPrefix: string },
): Promise<Suggestion[]> {
  const out: Suggestion[] = [];
  const max = opts.max ?? 6;
  for (const r of raws) {
    if (out.length >= max) break;
    let target: TargetRef | null = null;
    if (r.group) {
      target = await groupTarget(after, r.group, Number(r.expected));
      if (!target) continue;
    } else if (r.el) {
      if (r.side === 'before') {
        target = r.el.locator ?? null;
        if (!target) continue;
      } else {
        const frame = after.frameOf.get(r.el);
        if (!frame) continue;
        try {
          const choice = await chooseLocator(frame, r.el.d, { allowCss: opts.allowCss });
          // toasts and alerts: locate the container by role and assert its text,
          // instead of locating by the (changing) message itself
          if (r.el.volatile && ['alert', 'toast', 'status'].includes(r.el.volatile)) {
            const byRole = [choice.best, ...choice.alternatives].find((c) => c.usable && (c.kind === 'role' || c.kind === 'testId') && !(r.el!.d.text && c.code.includes(r.el!.d.text.slice(0, 12))));
            if (byRole) {
              choice.alternatives = [choice.best, ...choice.alternatives].filter((c) => c !== byRole);
              choice.best = byRole;
            }
          }
          if (!choice.best.usable || choice.best.kind === 'coords' || choice.best.score < 40) continue;
          target = toTargetRef(choice, r.el.d);
        } catch {
          continue;
        }
      }
    }
    const assertion: Assertion = { type: r.type, target, expected: r.expected, regex: r.regex, attrName: r.attrName };
    // "text changed to X" on a locator that already contains X is the same as "visible"
    if (target && (r.type === 'textEquals' || r.type === 'textContains') && typeof r.expected === 'string' && target.code.includes(`'${r.expected}'`)) {
      assertion.type = 'visible';
      delete assertion.expected;
    }
    out.push({
      id: `${opts.idPrefix}-${r.id}`,
      assertion,
      label: r.label,
      reason: r.reason,
      score: r.score,
      accepted: false,
      pageUrl: after.snap.url,
      elementKey: r.el?.key,
    });
  }
  if (out[0]) out[0].accepted = true;
  return out;
}
