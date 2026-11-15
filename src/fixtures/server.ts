// Tiny static server for the demo site, with a few fake APIs and "mutation" modes
// used by the resilience tests. Binds to 127.0.0.1 only.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

export type Mutation = 'none' | 'classes' | 'text';

export interface FixtureServer {
  url: string;
  port: number;
  setMutation(m: Mutation): void;
  close(): Promise<void>;
}

export const FIXTURE_ROOT = path.join(__dirname, '..', '..', 'fixtures', 'site');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** Class renames: roles and texts stay the same, so good locators must survive. */
const CLASS_RENAMES: Array<[RegExp, string]> = [
  [/inventory-item/g, 'product-card-v2'],
  [/inventory-list/g, 'product-grid-v2'],
  [/item-name/g, 'product-title-v2'],
  [/\bbtn-add\b/g, 'button-primary-v2'],
  [/\bbtn-remove\b/g, 'button-danger-v2'],
  [/(?<!testid=")cart-badge/g, 'basket-count-v2'], // the data-testid stays
  [/cart-link/g, 'basket-link-v2'],
  [/login-box/g, 'auth-panel-v2'],
  [/\bid="user-name"/g, 'id="login-username-v2"'],
  [/getElementById\('user-name'\)/g, "getElementById('login-username-v2')"],
];

function mutate(body: string, m: Mutation): string {
  if (m === 'classes') {
    let out = body;
    for (const [re, to] of CLASS_RENAMES) out = out.replace(re, to);
    return out;
  }
  if (m === 'text') return body.replace(/Add to cart/g, 'Add to bag');
  return body;
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function startFixtureServer(port = 0, mutation: Mutation = 'none'): Promise<FixtureServer> {
  let current: Mutation = mutation;
  let orderSeq = 482913;
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const p = url.pathname;
      if (p === '/api/cart/toggle') {
        await delay(400);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id: url.searchParams.get('id') }));
        return;
      }
      if (p === '/api/order') {
        await delay(700);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ orderId: orderSeq++ }));
        return;
      }
      if (p === '/api/slow') {
        await delay(Math.min(10000, Number(url.searchParams.get('ms') ?? 500)));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
        return;
      }
      if (p === '/download/report.csv') {
        res.writeHead(200, { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="report.csv"' });
        res.end('name,qty\nTrail Backpack,1\n');
        return;
      }
      if (p === '/api/upload' && req.method === 'POST') {
        let size = 0;
        req.on('data', (c: Buffer) => (size += c.length));
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, size }));
        });
        return;
      }
      // SPA fallback: /spa/anything serves spa.html
      let file = p === '/' ? '/index.html' : p;
      if (p.startsWith('/spa/') || p === '/spa') file = '/spa.html';
      const full = path.join(FIXTURE_ROOT, path.normalize(file).replace(/^([/\\])+/, ''));
      if (!full.startsWith(FIXTURE_ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not found');
        return;
      }
      const ext = path.extname(full);
      let body: string | Buffer = fs.readFileSync(full);
      if (ext === '.html' || ext === '.js') body = mutate(body.toString('utf8'), current);
      res.writeHead(200, { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  const actual = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${actual}`,
    port: actual,
    setMutation(m) {
      current = m;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
