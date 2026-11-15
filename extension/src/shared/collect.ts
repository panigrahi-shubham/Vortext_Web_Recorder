import { bestFor, uniqueName, type PickResult } from '../engine';
import type { CollectedItem } from './protocol';

let queue: Promise<unknown> = Promise.resolve();

/** Append picks to the stored collection, skipping locators that are already there. Calls are serialised. */
export function addToCollected(results: PickResult[]): Promise<number> {
  const run = queue.then(async () => {
    const stored = await chrome.storage.local.get('collected');
    const collected: CollectedItem[] = stored.collected ?? [];
    const used = new Set(collected.map((c) => c.name));
    let added = 0;
    for (const result of results) {
      const best = bestFor(result.candidates, 'playwright');
      if (!best) continue;
      const template = best.param?.key;
      const duplicate = collected.some((item) => {
        const other = item.result.candidates[item.chosen] ?? item.result.candidates[0];
        return other && (other.playwright === best.playwright || (template !== undefined && other.param?.key === template));
      });
      if (duplicate) continue;
      collected.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: uniqueName(result.info.suggestedName, used),
        result: { ...result, rejected: [] },
        chosen: result.candidates.indexOf(best),
      });
      added++;
    }
    if (added) await chrome.storage.local.set({ collected });
    return added;
  });
  queue = run.catch(() => undefined);
  return run;
}
