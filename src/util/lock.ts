/**
 * A tiny FIFO async lock. Every snapshot, verification and replayed action goes through
 * one instance so two browser operations never overlap (lesson from the mobile recorder).
 */
export class AsyncLock {
  private tail: Promise<unknown> = Promise.resolve();
  private depth = 0;

  get busy(): boolean {
    return this.depth > 0;
  }

  run<T>(job: () => Promise<T>): Promise<T> {
    this.depth++;
    const result = this.tail.then(job, job);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result.finally(() => {
      this.depth--;
    });
  }

  /** Resolves when everything queued so far has finished. */
  async idle(): Promise<void> {
    while (this.depth > 0) await this.tail;
  }
}

/** Retry once, then rethrow with a hint. */
export async function retryOnce<T>(what: string, job: () => Promise<T>): Promise<T> {
  try {
    return await job();
  } catch (first) {
    await new Promise((r) => setTimeout(r, 150));
    try {
      return await job();
    } catch (second) {
      const msg = second instanceof Error ? second.message : String(second);
      throw new Error(`${what} failed twice: ${msg}. If the page was navigating, wait for it to load and try again.`);
    }
  }
}
