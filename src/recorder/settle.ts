// Settle detection: the page is "settled" when there were no DOM mutations for
// `quietMs` AND no fetch/XHR in flight for `quietMs`, with a hard timeout.
import type { Page, Request } from 'playwright';

const LONG_POLL_URL = /(poll|stream|events?\b|sse|socket|heartbeat|hot-update|__webpack_hmr|sockjs)/i;
const LONG_POLL_AFTER_MS = 3000;

export interface SettleState {
  msSinceMutation: number;
  inflight: number;
  msSinceNetwork: number;
  readyState: string;
}

/** Pure decision used by waitForSettle (unit-tested). */
export function isSettled(s: SettleState, quietMs = 300): boolean {
  return s.readyState !== 'loading' && s.msSinceMutation >= quietMs && s.inflight === 0 && s.msSinceNetwork >= quietMs;
}

/** Tracks fetch/XHR requests per page, ignoring long-polling and event streams. */
export class NetworkTracker {
  private inflight = new Map<Request, number>();
  lastActivity = Date.now();

  constructor(private now: () => number = Date.now) {}

  attach(page: Page): void {
    page.on('request', (r) => this.onStart(r));
    page.on('requestfinished', (r) => this.onEnd(r));
    page.on('requestfailed', (r) => this.onEnd(r));
  }

  private isTracked(r: Request): boolean {
    const t = r.resourceType();
    if (t !== 'fetch' && t !== 'xhr' && t !== 'document') return false;
    if (LONG_POLL_URL.test(r.url())) return false;
    const accept = r.headers()['accept'] ?? '';
    return !accept.includes('text/event-stream');
  }

  onStart(r: Request): void {
    if (!this.isTracked(r)) return;
    this.inflight.set(r, this.now());
    this.lastActivity = this.now();
  }

  onEnd(r: Request): void {
    if (this.inflight.delete(r)) this.lastActivity = this.now();
  }

  /** Requests still pending, excluding ones open so long they are probably long-polls. */
  activeCount(): number {
    const now = this.now();
    let n = 0;
    for (const started of this.inflight.values()) if (now - started < LONG_POLL_AFTER_MS) n++;
    return n;
  }

  msSinceActivity(): number {
    return this.now() - this.lastActivity;
  }
}

export interface SettleResult {
  ms: number;
  timedOut: boolean;
  reason: string;
}

export async function waitForSettle(
  page: Page,
  tracker: NetworkTracker,
  opts: { quietMs?: number; timeoutMs?: number; pollMs?: number } = {},
): Promise<SettleResult> {
  const quietMs = opts.quietMs ?? 300;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const pollMs = opts.pollMs ?? 50;
  const start = Date.now();
  let last: SettleState | null = null;
  while (Date.now() - start < timeoutMs) {
    let msSinceMutation = 0;
    let readyState = 'loading';
    if (page.isClosed()) return { ms: Date.now() - start, timedOut: false, reason: 'page closed' };
    try {
      // Main frame plus child frames: the quietest is limited by the busiest.
      const values: number[] = [];
      for (const f of page.frames()) {
        const v = (await f.evaluate('window.__tphub ? [window.__tphub.quietFor(), document.readyState] : [0, document.readyState]').catch(() => null)) as
          | [number, string]
          | null;
        if (!v) {
          if (f === page.mainFrame()) values.push(0);
          continue;
        }
        values.push(v[0]);
        if (f === page.mainFrame()) readyState = v[1];
      }
      msSinceMutation = values.length ? Math.min(...values) : 0;
    } catch {
      msSinceMutation = 0; // navigating: not settled yet
    }
    last = { msSinceMutation, inflight: tracker.activeCount(), msSinceNetwork: tracker.msSinceActivity(), readyState };
    if (isSettled(last, quietMs)) return { ms: Date.now() - start, timedOut: false, reason: 'quiet' };
    await new Promise((r) => setTimeout(r, pollMs));
  }
  const why = !last
    ? 'unknown'
    : last.inflight > 0
      ? `${last.inflight} request(s) still running`
      : last.msSinceMutation < quietMs
        ? 'the page kept changing (animation or polling?)'
        : 'page still loading';
  return { ms: Date.now() - start, timedOut: true, reason: why };
}
