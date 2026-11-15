// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_ENGINE_SETTINGS, PageCtx, bestFor, classNameFrom, dynamicRegexSource, generate, isDynamicToken,
  lookup, pageObjectJava, pageObjectTs, retarget, scanPage,
} from '../src/engine';

const html = readFileSync(resolve(process.cwd(), 'test/fixture.html'), 'utf8');
let ctx: PageCtx;
const $ = (sel: string) => document.querySelector(sel)!;
const $$ = (sel: string) => Array.from(document.querySelectorAll(sel));

beforeEach(() => {
  document.documentElement.innerHTML = html.replace(/^[\s\S]*?<html>/, '').replace(/<\/html>[\s\S]*$/, '');
  ctx = new PageCtx(document, DEFAULT_ENGINE_SETTINGS);
});

/** Every accepted candidate must resolve back to exactly the picked element. */
function expectRoundTrip(el: Element) {
  const result = generate(el, new PageCtx(document, DEFAULT_ENGINE_SETTINGS));
  expect(result.candidates.length).toBeGreaterThan(0);
  for (const c of result.candidates) {
    const pw = lookup(c.playwright, new PageCtx(document, DEFAULT_ENGINE_SETTINGS));
    expect(pw.error, c.playwright).toBeUndefined();
    expect(pw.elements.length, `${c.playwright} should match once`).toBe(1);
    expect(pw.elements[0] === el || el.contains(pw.elements[0]), c.playwright).toBe(true);
    if (c.selenium) {
      const se = lookup(c.selenium, new PageCtx(document, DEFAULT_ENGINE_SETTINGS));
      expect(se.error, c.selenium).toBeUndefined();
      expect(se.elements.length, `${c.selenium} should match once`).toBe(1);
      expect(se.elements[0], c.selenium).toBe(el);
    }
  }
  return result;
}

describe('dynamic value rules', () => {
  it('flags generated ids and classes', () => {
    for (const t of ['ember1423', 'css-1x2y3z', 'sc-bdVaJa', 'Button_root__3xK2a', ':r1a:', 'a1b2c3d4', 'item-48213']) {
      expect(isDynamicToken(t), t).toBe(true);
    }
    for (const t of ['login', 'product-card', 'btn-primary', 'sortSel', 'nav-item', 'step-2']) {
      expect(isDynamicToken(t), t).toBe(false);
    }
  });
  it('turns counts into a regex but leaves 3G alone', () => {
    expect(dynamicRegexSource('Active (5675)')).toBe('^Active \\(\\d+\\)$');
    expect(dynamicRegexSource('No Price (1,235)')).toBe('^No Price \\([\\d.,]+\\)$');
    expect(dynamicRegexSource('3G Router')).toBeNull();
    expect(dynamicRegexSource('250')).toBeNull();
  });
});

describe('semantic rules', () => {
  it('prefers role + name and needs exact when another button contains the text', () => {
    const r = expectRoundTrip($('.btn-primary'));
    expect(r.candidates[0].playwright).toBe("page.getByRole('button', { name: 'Add Product' })");
    expect(r.rejected.some((x) => x.locator === '#ember1423')).toBe(true);
    expect(r.candidates.every((c) => !c.playwright.includes('ember'))).toBe(true);
    const sel = bestFor(r.candidates, 'selenium')!;
    expect(sel.selenium).toBe(`By.xpath("//button[normalize-space()='Add Product']")`);
  });
  it('matches dynamic counts with a regex', () => {
    const r = expectRoundTrip($$('[role=tab]')[0]);
    expect(r.candidates[0].playwright).toBe("page.getByRole('tab', { name: /^Active \\(\\d+\\)$/ })");
    expect(bestFor(r.candidates, 'selenium')!.selenium).toContain("starts-with(normalize-space(), 'Active (')");
    expect(r.info.suggestedName).toBe('activeTab');
  });
  it('ignores a counter badge glued to the label', () => {
    const r = expectRoundTrip($('a[href="/leads"]'));
    expect(r.candidates[0].playwright).toBe("page.getByRole('link', { name: /^Lead Manager\\s*\\d+\\+?$/ })");
    expect(r.candidates.map((c) => c.selenium)).toContain(`By.xpath("//a[starts-with(normalize-space(), 'Lead Manager')]")`);
    expect(r.info.suggestedName).toBe('leadManagerLink');
  });
  it('uses the test id first', () => {
    const r = expectRoundTrip($('[data-testid=login-submit]'));
    expect(r.candidates[0].playwright).toBe("page.getByTestId('login-submit')");
    expect(r.candidates[0].selenium).toBe('By.cssSelector("[data-testid=\\"login-submit\\"]")');
  });
  it('handles label, placeholder and name', () => {
    const email = expectRoundTrip($('#email'));
    expect(email.candidates.map((c) => c.playwright)).toContain("page.getByLabel('Email address')");
    const search = expectRoundTrip($('input[name=q]'));
    expect(search.candidates.map((c) => c.playwright)).toContain("page.getByPlaceholder('Search Products')");
    expect(search.candidates.map((c) => c.selenium)).toContain('By.name("q")');
    expect(search.info.suggestedName).toBe('searchProductsInput');
    expectRoundTrip($('#sortSel'));
    expectRoundTrip($('input[name=pwd]'));
  });
  it('gives links a linkText form for Selenium', () => {
    const r = expectRoundTrip($('a[href="/forgot"]'));
    expect(r.candidates[0].playwright).toBe("page.getByRole('link', { name: 'Forgot password?' })");
    expect(r.candidates.map((c) => c.selenium)).toContain('By.linkText("Forgot password?")');
  });
});

describe('anchoring rules', () => {
  it('anchors an icon-only element to its product card', () => {
    const el = $$('.edit-icon')[1];
    const r = expectRoundTrip(el);
    const best = r.candidates[0];
    expect(best.playwright).toBe("page.locator('div.product-card').filter({ hasText: 'Hero Passion Xpro Bike' }).locator('span.edit-icon')");
    expect(best.param!.playwright).toBe(
      "this.page.locator('div.product-card').filter({ has: this.page.getByText(text, { exact: true }) }).locator('span.edit-icon')",
    );
    expect(best.selenium).toContain("contains(normalize-space(.), 'Hero Passion Xpro Bike')");
    expect(best.param!.selenium).toContain('" + text + "');
  });
  it('switches to an exact text filter when the title is a substring of another card', () => {
    const r = expectRoundTrip($$('.kebab')[0]); // card "Router" vs "Router Pro"
    expect(r.candidates[0].playwright).toBe(
      "page.locator('div.product-card').filter({ has: page.getByText('Router', { exact: true }) }).getByRole('button')",
    );
    expect(r.candidates[0].selenium).toContain("[.//*[normalize-space()='Router']]");
  });
  it('anchors repeated text and checkboxes', () => {
    expectRoundTrip($$('.chip')[2]);
    const cb = expectRoundTrip($$('.select-row')[1]);
    expect(cb.candidates[0].playwright).toContain(".getByRole('checkbox')");
  });
  it('anchors table buttons to their row', () => {
    const r = expectRoundTrip($$('#orders button')[1]);
    expect(r.candidates[0].playwright).toBe("page.locator('#orders > tbody > tr').filter({ hasText: 'Blue Ocean Ltd' }).getByRole('button', { name: 'View' })");
  });
});

describe('retargeting and scan', () => {
  it('retargets an svg path to the clickable parent', () => {
    expect(retarget($('.edit-icon path'))).toBe($('.edit-icon'));
    expect(retarget($('.nav-item svg path'))).toBe($('.nav-item'));
  });
  it('scans every interactive element and each best locator is unique', () => {
    const scan = scanPage(ctx, { requireLayout: false });
    expect(scan.total).toBeGreaterThan(30);
    for (const item of scan.items) {
      expect(item.result.candidates.length, item.el.outerHTML.slice(0, 80)).toBeGreaterThan(0);
      const found = lookup(item.result.candidates[0].playwright, new PageCtx(document, DEFAULT_ENGINE_SETTINGS));
      expect(found.elements.length, item.result.candidates[0].playwright).toBe(1);
    }
  });
});

describe('shadow DOM', () => {
  it('finds elements in open shadow roots for Playwright and offers no Selenium form', () => {
    const root = $('#host').attachShadow({ mode: 'open' });
    root.innerHTML = '<button class="shadow-btn">Shadow Save</button>';
    const el = root.querySelector('button')!;
    const r = generate(el, new PageCtx(document, DEFAULT_ENGINE_SETTINGS));
    expect(r.info.inShadow).toBe(true);
    expect(r.candidates[0].playwright).toBe("page.getByRole('button', { name: 'Shadow Save' })");
    expect(r.candidates.every((c) => c.selenium === null)).toBe(true);
  });
});

describe('reverse lookup', () => {
  it('understands CSS, XPath, Playwright and Selenium syntax', () => {
    expect(lookup('.product-card', ctx).elements.length).toBe(3);
    expect(lookup('//button[normalize-space()="View"]', ctx).elements.length).toBe(2);
    expect(lookup("page.getByRole('button', { name: 'Add' })", ctx).elements.length).toBe(3);
    expect(lookup("page.getByRole('button', { name: 'Quick Add', exact: true })", ctx).elements.length).toBe(1);
    expect(lookup("await page.getByText(/^No \\w+ \\(\\d+\\)$/).first();", ctx).elements.length).toBe(1);
    expect(lookup('driver.findElement(By.cssSelector("button.kebab"))', ctx).elements.length).toBe(3);
    expect(lookup('By.partialLinkText("Price")', ctx).elements.length).toBe(2);
    expect(lookup('div[', ctx).error).toBeTruthy();
  });
});

describe('page object export', () => {
  it('emits fields for unique locators and methods for anchored ones', () => {
    const add = generate($('.btn-primary'), ctx).candidates[0];
    const edit = generate($$('.edit-icon')[1], ctx).candidates[0];
    const ts = pageObjectTs('ProductsPage', [
      { name: 'addProductButton', candidate: add },
      { name: 'editIcon', candidate: edit },
    ]);
    expect(ts).toContain("this.addProductButton = page.getByRole('button', { name: 'Add Product' });");
    expect(ts).toContain('editIcon(text: string): Locator {');
    const java = pageObjectJava('ProductsPage', [
      { name: 'addProductButton', candidate: bestFor(generate($('.btn-primary'), ctx).candidates, 'selenium') },
      { name: 'editIcon', candidate: edit },
    ]);
    expect(java).toContain('private final By addProductButton = By.xpath(');
    expect(java).toContain('public WebElement editIcon(String text) {');
    expect(classNameFrom('Products | Seller Panel', 'https://x.test/products')).toBe('ProductsPage');
  });
});
