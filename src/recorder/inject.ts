// Builds the script that runs inside every page and frame (via context.addInitScript).
// The in-page code itself lives in page-core.js (descriptors, snapshot, capture) and
// page-ui.js (toolbar, tooltip, menus). They are plain JS so they need no transpiling.
import fs from 'node:fs';
import path from 'node:path';

export interface InjectConfig {
  testIdAttr: string;
  capture: boolean; // record user events
  ui: boolean; // show toolbar/tooltip
  mode?: string;
  dblclickWindow?: number;
  axe?: boolean; // @axe-core/playwright installed: offer the accessibility check
  screenshots?: boolean; // offer toHaveScreenshot in Assert mode
}

let cache: { core: string; ui: string } | null = null;

function load(): { core: string; ui: string } {
  if (!cache) {
    const dir = __dirname;
    cache = {
      core: fs.readFileSync(path.join(dir, 'page-core.js'), 'utf8'),
      ui: fs.readFileSync(path.join(dir, 'page-ui.js'), 'utf8'),
    };
  }
  return cache;
}

export function buildInitScript(cfg: InjectConfig): string {
  const { core, ui } = load();
  // `__name` shim: harmless, protects against bundler helpers if code is ever pasted in.
  const head = `;(function(){ if (!window.__name) window.__name = function (f) { return f; }; window.__tphubConfig = ${JSON.stringify(cfg)}; })();\n`;
  return head + core + '\n' + (cfg.ui ? ui : '');
}
