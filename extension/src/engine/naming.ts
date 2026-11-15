import { PageCtx, normalizeText } from './ctx';
import { isDynamicToken, stableClasses } from './dynamic';

const ROLE_SUFFIX: Record<string, string> = {
  button: 'Button', link: 'Link', textbox: 'Input', searchbox: 'Input', spinbutton: 'Input', checkbox: 'Checkbox',
  radio: 'Radio', combobox: 'Dropdown', listbox: 'Dropdown', tab: 'Tab', img: 'Image', heading: 'Heading',
  menuitem: 'MenuItem', switch: 'Switch', option: 'Option', slider: 'Slider', dialog: 'Dialog',
};
const TAG_SUFFIX: Record<string, string> = { svg: 'Icon', i: 'Icon', select: 'Dropdown', input: 'Input', textarea: 'Input', img: 'Image' };

const RESERVED = new Set(['page', 'class', 'new', 'delete', 'default', 'package', 'import', 'export', 'return', 'public', 'private']);

function camel(words: string[]): string {
  return words
    .map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('');
}

function words(source: string): string[] {
  return source
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map((w) => w.replace(/^([A-Za-z]{3,})\d+$/, '$1'))
    .filter((w) => w && !/^\d+$/.test(w))
    .map((w) => (w === w.toUpperCase() && w.length > 1 ? w.charAt(0) + w.slice(1).toLowerCase() : w))
    .slice(0, 4);
}

/** Rule-based field name for a Page Object: accessible name + role suffix, e.g. addProductButton. */
export function suggestName(el: Element, ctx: PageCtx, role: string | null, accName: string): string {
  const id = el.getAttribute('id');
  const text = normalizeText(el.textContent);
  const sources = [
    accName,
    el.getAttribute('placeholder'),
    text.length <= 40 ? text : '',
    ...ctx.settings.testIdAttrs.map((a) => el.getAttribute(a)),
    id && !isDynamicToken(id) ? id : '',
    el.getAttribute('name'),
    el.getAttribute('title'),
    stableClasses(el)[0],
  ];
  let parts: string[] = [];
  for (const s of sources) {
    parts = words(normalizeText(s));
    if (parts.length) break;
  }
  const suffix = (role && ROLE_SUFFIX[role]) || TAG_SUFFIX[el.localName] || '';
  if (!parts.length) parts = [suffix ? '' : el.localName].filter(Boolean);
  let name = camel(parts);
  if (suffix && !name.toLowerCase().endsWith(suffix.toLowerCase())) name = name ? name + suffix : suffix.charAt(0).toLowerCase() + suffix.slice(1);
  if (!name) name = 'element';
  if (/^\d/.test(name) || RESERVED.has(name)) name = `el${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  return name;
}

export function uniqueName(base: string, used: Set<string>): string {
  let name = base;
  for (let i = 2; used.has(name); i++) name = `${base}${i}`;
  used.add(name);
  return name;
}

/** "Products | Seller Panel" -> ProductsPage */
export function classNameFrom(title: string, url: string): string {
  let source = title.split(/[|\-–—:·]/)[0];
  if (!words(source).length) {
    try {
      source = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
    } catch {
      source = '';
    }
  }
  const parts = words(source).slice(0, 3);
  let name = parts.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('') || 'App';
  if (/^\d/.test(name)) name = `P${name}`;
  return name.endsWith('Page') ? name : `${name}Page`;
}
