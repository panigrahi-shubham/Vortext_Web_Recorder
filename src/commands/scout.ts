import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

/** Run the extension's exact locator engine in a real browser, without extension APIs. */
export async function runScout(url: string, selector: string) {
  const target = new URL(url);
  if (!['http:', 'https:', 'file:'].includes(target.protocol) || target.username || target.password) {
    throw new Error('Use an http://, https:// or file:// URL without embedded credentials.');
  }
  const bundled = path.join(__dirname, '..', 'scout', 'engine.js');
  const development = path.join(__dirname, '..', '..', 'extension', 'dist', 'engine.js');
  const engine = fs.existsSync(bundled) ? bundled : development;
  if (!fs.existsSync(engine)) throw new Error('Locator engine is not built. Run npm run build first.');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(target.href, { waitUntil: 'domcontentloaded' });
    // Wait for client-rendered elements without mutating the target application.
    await page.locator(selector).first().waitFor({ state: 'attached' });
    const matches = await page.locator(selector).count();
    if (matches !== 1) throw new Error(`Selector matches ${matches} elements. Choose one element to inspect.`);
    await page.addScriptTag({ path: engine });
    return await page.locator(selector).evaluate(element => {
      const engine = (window as any).VortexLocatorEngine;
      return engine.generate(element, new engine.PageCtx(document, engine.DEFAULT_ENGINE_SETTINGS));
    });
  } finally { await browser.close(); }
}
