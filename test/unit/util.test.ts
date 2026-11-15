import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { parseArgs, parseViewport } from '../../src/util/args';
import { decodeBuffer } from '../../src/util/files';
import { resolveTestIdAttr } from '../../src/util/config';
import { AsyncLock } from '../../src/util/lock';

describe('cli arguments', () => {
  it('parses flags, values and paths with spaces', () => {
    const a = parseArgs(['record', '--url', 'https://x.test', '--out', 'C:\\My Tests\\e2e', '--allow-css', '--viewport=1366x768']);
    assert.equal(a._[0], 'record');
    assert.equal(a.out, 'C:\\My Tests\\e2e');
    assert.equal(a['allow-css'], true);
    assert.deepEqual(parseViewport(a.viewport as string), { width: 1366, height: 768 });
  });
  it('rejects a bad viewport with a helpful message', () => {
    assert.throws(() => parseViewport('big'), /WIDTHxHEIGHT/);
  });
});

describe('file decoding', () => {
  it('decodes UTF-16LE with BOM (PowerShell output)', () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('{"a":"é"}', 'utf16le')]);
    assert.equal(decodeBuffer(buf), '{"a":"é"}');
  });
  it('decodes UTF-8 with BOM', () => {
    assert.equal(decodeBuffer(Buffer.from([0xef, 0xbb, 0xbf, 0x68, 0x69])), 'hi');
  });
  it('reads testIdAttribute from playwright.config.ts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tphub-'));
    fs.writeFileSync(path.join(dir, 'playwright.config.ts'), "export default { use: { testIdAttribute: 'data-test' } }");
    assert.equal(resolveTestIdAttr(dir), 'data-test');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('async lock', () => {
  it('never runs two jobs at once', async () => {
    const lock = new AsyncLock();
    let running = 0;
    let max = 0;
    const job = () => lock.run(async () => {
      running++;
      max = Math.max(max, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
    });
    await Promise.all([job(), job(), job(), job()]);
    assert.equal(max, 1);
  });
  it('keeps going after a failed job', async () => {
    const lock = new AsyncLock();
    await assert.rejects(lock.run(async () => { throw new Error('boom'); }));
    assert.equal(await lock.run(async () => 42), 42);
  });
});
