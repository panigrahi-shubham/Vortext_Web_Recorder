/** Implicit ARIA roles, limited to what the locator rules need. Follows Playwright's role mapping. */

const INPUT_ROLES: Record<string, string | null> = {
  button: 'button', submit: 'button', reset: 'button', image: 'button',
  checkbox: 'checkbox', radio: 'radio', range: 'slider', number: 'spinbutton',
  search: 'searchbox', email: 'textbox', tel: 'textbox', text: 'textbox', url: 'textbox', '': 'textbox',
  hidden: null, password: null, file: null, color: null, date: null, time: null, month: null, week: null,
  'datetime-local': null,
};

const TAG_ROLES: Record<string, string> = {
  button: 'button', textarea: 'textbox', option: 'option', li: 'listitem', ul: 'list', ol: 'list',
  nav: 'navigation', main: 'main', dialog: 'dialog', table: 'table', tr: 'row', td: 'cell', th: 'columnheader',
  progress: 'progressbar', article: 'article', aside: 'complementary', hr: 'separator', svg: 'img',
  h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
};

export function getRole(el: Element): string | null {
  const explicit = el.getAttribute('role')?.trim().split(/\s+/)[0];
  if (explicit) return explicit === 'presentation' || explicit === 'none' ? null : explicit;
  const tag = el.localName;
  if (tag === 'a' || tag === 'area') return el.hasAttribute('href') ? 'link' : null;
  if (tag === 'input') {
    const type = (el.getAttribute('type') ?? '').toLowerCase();
    const role = type in INPUT_ROLES ? INPUT_ROLES[type] : 'textbox';
    if ((role === 'textbox' || role === 'searchbox') && el.hasAttribute('list')) return 'combobox';
    return role;
  }
  if (tag === 'select') {
    const size = Number(el.getAttribute('size') ?? '0');
    return el.hasAttribute('multiple') || size > 1 ? 'listbox' : 'combobox';
  }
  if (tag === 'img') return el.getAttribute('alt') === '' ? null : 'img';
  return TAG_ROLES[tag] ?? null;
}

/** CSS that selects every element that could carry the role implicitly. Explicit [role] is added by the caller. */
const ROLE_SELECTORS: Record<string, string> = {
  button: 'button,input[type=button],input[type=submit],input[type=reset],input[type=image]',
  link: 'a[href],area[href]',
  textbox: 'input,textarea',
  searchbox: 'input[type=search]',
  checkbox: 'input[type=checkbox]',
  radio: 'input[type=radio]',
  combobox: 'select,input[list]',
  listbox: 'select',
  option: 'option',
  slider: 'input[type=range]',
  spinbutton: 'input[type=number]',
  heading: 'h1,h2,h3,h4,h5,h6',
  img: 'img,svg',
  listitem: 'li',
  list: 'ul,ol',
  row: 'tr',
  cell: 'td',
  columnheader: 'th',
  dialog: 'dialog',
  navigation: 'nav',
  main: 'main',
  table: 'table',
  article: 'article',
  complementary: 'aside',
  progressbar: 'progress',
  separator: 'hr',
};

export function roleSelector(role: string): string {
  const explicit = `[role~="${role.replace(/"/g, '')}"]`;
  return ROLE_SELECTORS[role] ? `${ROLE_SELECTORS[role]},${explicit}` : explicit;
}

/** Roles worth emitting getByRole() for. Structural roles (list, row, cell) are too generic to be useful alone. */
export const LOCATOR_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'listbox', 'option', 'tab',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'switch', 'slider', 'spinbutton', 'heading', 'img',
  'treeitem', 'dialog', 'alert', 'alertdialog', 'tooltip',
]);

export const INTERACTIVE_SELECTOR =
  'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],' +
  '[role=menuitem],[role=checkbox],[role=radio],[role=switch],[role=option],[role=combobox],[role=textbox],' +
  '[onclick],[contenteditable=""],[contenteditable=true]';
