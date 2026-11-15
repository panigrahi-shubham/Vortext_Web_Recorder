import { build, context } from 'esbuild';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const options = {
  entryPoints: {
    content: 'src/content/index.ts',
    background: 'src/background/index.ts',
    panel: 'src/panel/panel.ts',
  },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'chrome116',
  charset: 'ascii', // Chrome refuses content scripts containing Unicode non-characters
  minify: false,
  sourcemap: false,
  logLevel: 'info',
};

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
await cp('src/panel/panel.html', 'dist/panel.html');
await cp('src/panel/panel.css', 'dist/panel.css');

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
  // Shared browser engine used by the npm scout command as well as the extension.
  await build({ entryPoints: ['src/engine/index.ts'], outfile: 'dist/engine.js', bundle: true, format: 'iife', globalName: 'VortexLocatorEngine', target: 'chrome116', charset: 'ascii' });
  for (const file of ['content.js', 'background.js', 'panel.js']) {
    const text = await readFile(`dist/${file}`, 'utf8');
    if (/[\uFFFE\uFFFF\uFDD0-\uFDEF]/.test(text)) throw new Error(`dist/${file} contains Unicode non-characters, which Chrome rejects`);
  }
}
