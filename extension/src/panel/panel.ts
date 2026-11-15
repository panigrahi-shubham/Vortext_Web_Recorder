import {
  bestFor, classNameFrom, codeFor, pageObjectJava, pageObjectTs,
  type Candidate, type Format, type PickResult, type PomItem,
} from '../engine';
import { addToCollected } from '../shared/collect';
import {
  DEFAULT_SETTINGS, ensureInjected, loadSettings, saveSettings,
  type CollectedItem, type FromContent, type LookupResponse, type ScanResponse, type Settings, type ToContent,
} from '../shared/protocol';

type Tab = 'inspect' | 'collected' | 'scan' | 'verify' | 'settings';
type Child = Node | string | null | undefined | false;

const state = {
  settings: { ...DEFAULT_SETTINGS } as Settings,
  tab: 'inspect' as Tab,
  last: null as { result: PickResult; title: string } | null,
  collected: [] as CollectedItem[],
  className: '',
  picking: false,
  scan: null as ScanResponse | null,
  scanning: false,
  verifyText: '',
  blocked: false,
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const view = $('view');

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === false || value === null || value === undefined) continue;
    if (key === 'class') el.className = String(value);
    else if (key === 'value') (el as HTMLInputElement).value = String(value);
    else if (key === 'checked') (el as HTMLInputElement).checked = Boolean(value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value as EventListener);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) if (child) el.append(child);
  return el;
}

let statusTimer = 0;
function status(text: string): void {
  const el = $('status');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => {
    el.classList.remove('show');
    el.textContent = '';
  }, 2200);
}

async function copy(text: string, label = 'Copied'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    status(label);
  } catch {
    status('Could not copy. Select the code and press Ctrl+C');
  }
}

/** panel.html?tabId=123 pins the panel to one tab, so it can also run detached in its own window. */
const pinnedTab = Number(new URLSearchParams(location.search).get('tabId')) || undefined;

async function activeTabId(): Promise<number | undefined> {
  if (pinnedTab !== undefined) return pinnedTab;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

/** Send to the page. frameId 0 = top frame only, undefined = every frame. */
async function toPage<T>(msg: ToContent, frameId?: number): Promise<T | undefined> {
  const tabId = await activeTabId();
  if (tabId === undefined) return undefined;
  const ok = await ensureInjected(tabId);
  if (state.blocked !== !ok) {
    state.blocked = !ok;
    render();
  }
  if (!ok) return undefined;
  try {
    return (await chrome.tabs.sendMessage(tabId, msg, frameId === undefined ? {} : { frameId })) as T;
  } catch {
    return undefined;
  }
}

const format = (): Format => state.settings.format;
const ext = () => (format() === 'playwright' ? 'ts' : 'java');

function stabilityBadge(c: Candidate): HTMLElement {
  return h('span', { class: `badge ${c.stability}`, title: `score ${c.score} of 100` }, `${c.stability} ${c.score}`);
}

// ------------------------------------------------------------------ Inspect
function candidateCard(c: Candidate, best: boolean): HTMLElement {
  const code = codeFor(c, format())!;
  const paramCode = c.param ? (format() === 'playwright' ? c.param.playwright : c.param.selenium) : null;
  return h(
    'div',
    { class: `cand${best ? ' best' : ''}` },
    h(
      'div',
      { class: 'row' },
      stabilityBadge(c),
      h('span', { class: 'badge' }, c.strategy),
      best && h('span', { class: 'badge' }, 'best'),
      h('span', { class: 'spacer' }),
      h('button', { onclick: () => copy(code) }, 'Copy'),
    ),
    h('code', { class: 'code' }, code),
    c.notes.length > 0 && h('ul', { class: 'notes' }, ...c.notes.map((n) => h('li', {}, n))),
    paramCode && h('details', {}, h('summary', {}, 'As a Page Object method (text is a parameter)'), h('code', { class: 'code' }, paramCode)),
  );
}

function renderInspect(): Child[] {
  if (!state.last) {
    return [
      h(
        'div',
        { class: 'empty' },
        h('p', {}, 'Pick an element to get ranked locators. Each one is checked against the page and matches exactly one element.'),
        h(
          'ul',
          {},
          h('li', {}, 'Click ', h('b', {}, 'Pick element'), ' or press ', h('kbd', {}, 'Alt+Shift+L'), ', then click anything on the page.'),
          h('li', {}, 'The best locator is copied to the clipboard straight away.'),
          h('li', {}, 'While picking: ', h('kbd', {}, '↑'), ' ', h('kbd', {}, '↓'), ' move to parent or child, ', h('kbd', {}, 'Shift'), ' picks the exact element under the cursor, ', h('kbd', {}, 'Esc'), ' stops.'),
          h('li', {}, 'Right-click an element and choose "Locator Scout: suggest locator" for a single pick.'),
        ),
      ),
    ];
  }
  const { result } = state.last;
  const { info } = result;
  const shown = result.candidates.filter((c) => codeFor(c, format()));
  const out: Child[] = [];

  out.push(
    h(
      'div',
      { class: 'element', onmouseenter: () => highlight(result.refId), onmouseleave: () => highlight(null) },
      h('div', {}, h('span', { class: 'tag' }, `<${info.tag}>`), ' ', h('code', {}, info.suggestedName)),
      h(
        'div',
        { class: 'meta' },
        [info.role ? `role ${info.role}` : 'no ARIA role', info.name ? `name "${info.name}"` : 'no accessible name'].join(' · '),
      ),
      (info.inShadow || info.frames.length > 0 || info.retargetedFrom) &&
        h(
          'div',
          { class: 'meta' },
          info.inShadow && h('span', { class: 'badge' }, 'shadow DOM'),
          info.frames.length > 0 && h('span', { class: 'badge' }, `iframe depth ${info.frames.length}`),
          info.retargetedFrom && h('span', { class: 'badge', title: 'Hold Shift while clicking to pick the exact element' }, `retargeted from ${info.retargetedFrom}`),
        ),
    ),
  );

  if (info.frames.length > 0) {
    const frame = info.frames[info.frames.length - 1];
    const text =
      format() === 'selenium'
        ? `Inside an iframe. Switch first: driver.switchTo().frame(driver.findElement(By.cssSelector("${frame.selector.replace(/"/g, '\\"')}")));`
        : info.frames.some((f) => !f.verified)
          ? 'Inside a cross-origin iframe. The frameLocator selector is a best guess, so check it once.'
          : '';
    if (text) out.push(h('p', { class: 'small dim' }, text));
  }

  if (!shown.length) {
    out.push(
      h(
        'p',
        { class: 'empty' },
        info.inShadow && format() === 'selenium'
          ? 'Selenium cannot address this element with a single By because it is inside shadow DOM. Use getShadowRoot() on the host, or switch to Playwright.'
          : 'No unique locator could be built for this element. Try its parent (↑ while picking).',
      ),
    );
  }
  shown.forEach((c, i) => out.push(candidateCard(c, i === 0)));

  if (!state.settings.autoCollect) {
    out.push(h('button', { onclick: async () => status((await addToCollected([result])) ? 'Added to Collected' : 'Already in Collected') }, 'Add to Collected'));
  }
  if (result.rejected.length) {
    out.push(
      h(
        'details',
        {},
        h('summary', {}, `Rule trace: ${result.rejected.length} locator${result.rejected.length > 1 ? 's' : ''} rejected`),
        h('ul', { class: 'trace' }, ...result.rejected.map((r) => h('li', {}, h('code', {}, r.locator), h('div', { class: 'dim' }, r.reason)))),
      ),
    );
  }
  out.push(h('p', { class: 'small dim', style: 'margin-top:10px' }, `Generated and verified in ${result.ms} ms`));
  return out;
}

// ------------------------------------------------------------------ Collected
function pomItems(): PomItem[] {
  return state.collected.map((item) => ({ name: item.name, candidate: bestFor(item.result.candidates, format(), item.chosen) }));
}

function pomCode(): string {
  const name = state.className || defaultClassName();
  return format() === 'playwright' ? pageObjectTs(name, pomItems()) : pageObjectJava(name, pomItems());
}

function defaultClassName(): string {
  const first = state.collected[0]?.result ?? state.last?.result;
  return classNameFrom(first?.title ?? '', first?.url ?? '');
}

async function saveCollected(next: CollectedItem[]): Promise<void> {
  state.collected = next;
  await chrome.storage.local.set({ collected: next });
}

function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderCollected(): Child[] {
  if (!state.collected.length) {
    return [h('p', { class: 'empty' }, 'Nothing collected yet. Every element you pick lands here, ready to export as one Page Object. Use the Scan tab to collect a whole page at once.')];
  }
  const className = state.className || defaultClassName();
  const out: Child[] = [
    h(
      'div',
      { class: 'bar' },
      h('input', {
        type: 'text',
        value: className,
        'aria-label': 'Page Object class name',
        style: 'flex:1;min-width:120px',
        onchange: (e: Event) => {
          state.className = (e.target as HTMLInputElement).value.trim().replace(/[^\w$]/g, '');
          void chrome.storage.local.set({ className: state.className });
          render();
        },
      }),
      h('button', { class: 'primary', onclick: () => copy(pomCode(), 'Page Object copied') }, 'Copy Page Object'),
      h('button', { onclick: () => download(`${className}.${ext()}`, pomCode()) }, `Download .${ext()}`),
    ),
  ];

  for (const item of state.collected) {
    const options = item.result.candidates.map((c, i) => ({ c, i })).filter(({ c }) => codeFor(c, format()));
    const chosen = bestFor(item.result.candidates, format(), item.chosen);
    const chosenIndex = chosen ? item.result.candidates.indexOf(chosen) : -1;
    const code = chosen ? codeFor(chosen, format())! : `no ${format() === 'selenium' ? 'Selenium' : 'Playwright'} locator for this element`;
    out.push(
      h(
        'div',
        { class: 'item', onmouseenter: () => highlight(item.result.refId), onmouseleave: () => highlight(null) },
        h(
          'div',
          { class: 'row' },
          h('input', {
            type: 'text',
            class: 'name',
            value: item.name,
            'aria-label': 'Field name',
            onchange: (e: Event) => {
              const value = (e.target as HTMLInputElement).value.trim().replace(/[^\w$]/g, '');
              if (value) item.name = value;
              void saveCollected([...state.collected]).then(render);
            },
          }),
          chosen && stabilityBadge(chosen),
          options.length > 1 &&
            h(
              'select',
              {
                'aria-label': 'Locator strategy',
                onchange: (e: Event) => {
                  item.chosen = Number((e.target as HTMLSelectElement).value);
                  void saveCollected([...state.collected]).then(render);
                },
              },
              ...options.map(({ c, i }) => h('option', { value: i, selected: i === chosenIndex }, `${c.strategy} (${c.score})`)),
            ),
          h('button', { class: 'ghost', title: 'Copy locator', disabled: !chosen, onclick: () => copy(code) }, 'Copy'),
          h('button', { class: 'ghost', title: 'Remove', onclick: () => void saveCollected(state.collected.filter((x) => x !== item)).then(render) }, '✕'),
        ),
        h('code', { class: 'code' }, chosen?.param ? `${code}\n// exported as ${item.name}(text)` : code),
      ),
    );
  }
  out.push(
    h('details', {}, h('summary', {}, 'Preview Page Object'), h('code', { class: 'code pom' }, pomCode())),
    h(
      'div',
      { class: 'bar', style: 'margin-top:12px' },
      h('span', { class: 'spacer' }),
      h('button', { onclick: () => void saveCollected([]).then(render) }, 'Clear all'),
    ),
  );
  return out;
}

// ------------------------------------------------------------------ Scan
async function runScan(): Promise<void> {
  state.scanning = true;
  render();
  const response = await toPage<ScanResponse>({ type: 'ls:scan' }, 0);
  state.scanning = false;
  state.scan = response ?? null;
  if (!response && !state.blocked) status('Scan failed. Reload the page and try again');
  render();
}

function renderScan(): Child[] {
  const out: Child[] = [
    h(
      'div',
      { class: 'bar' },
      h('button', { class: 'primary', disabled: state.scanning, onclick: runScan }, state.scanning ? 'Scanning...' : state.scan ? 'Scan again' : 'Scan page'),
      state.scan &&
        h(
          'button',
          {
            onclick: async () => {
              const added = await addToCollected(state.scan!.items.map((i) => i.result));
              status(`${added} locator${added === 1 ? '' : 's'} added to Collected`);
            },
          },
          'Collect all',
        ),
    ),
  ];
  if (!state.scan) {
    out.push(h('p', { class: 'empty' }, 'Finds every button, link, field and clickable element on the page and builds its best locator in one pass. Rows of the same list are folded into one parameterised locator.'));
    return out;
  }
  const { items, total, truncated, ms } = state.scan;
  const count = (s: string) => items.filter((i) => bestFor(i.result.candidates, format())?.stability === s).length;
  const none = items.filter((i) => !bestFor(i.result.candidates, format())).length;
  out.push(
    h(
      'div',
      { class: 'stats' },
      h('span', { class: 'badge' }, `${total} elements`),
      h('span', { class: 'badge' }, `${items.length} locators`),
      h('span', { class: 'badge high' }, `${count('high')} high`),
      h('span', { class: 'badge medium' }, `${count('medium')} medium`),
      h('span', { class: 'badge low' }, `${count('low')} low`),
      none > 0 && h('span', { class: 'badge' }, `${none} none`),
      h('span', { class: 'badge' }, `${ms} ms`),
    ),
  );
  if (truncated) out.push(h('p', { class: 'small dim' }, 'The page has more than 300 distinct controls. Only the first 300 are listed.'));

  for (const item of items) {
    const best = bestFor(item.result.candidates, format());
    const code = best ? codeFor(best, format())! : 'no unique locator';
    out.push(
      h(
        'div',
        { class: 'scan-row', onmouseenter: () => highlight(item.result.refId), onmouseleave: () => highlight(null) },
        h(
          'div',
          { class: 'row' },
          h('span', { class: 'name', title: item.result.info.name || item.result.info.text }, item.result.info.suggestedName, item.repeat > 0 ? ` (text) ×${item.repeat + 1}` : ''),
          best && stabilityBadge(best),
          h('button', { class: 'ghost', disabled: !best, onclick: () => copy(code) }, 'Copy'),
          h(
            'button',
            { class: 'ghost', title: 'Add to Collected', disabled: !best, onclick: async () => status((await addToCollected([item.result])) ? 'Added to Collected' : 'Already in Collected') },
            '+',
          ),
        ),
        h('code', { class: 'code' }, code),
      ),
    );
  }
  return out;
}

// ------------------------------------------------------------------ Verify
let verifyTimer = 0;
function renderVerify(): Child[] {
  const result = h('div', { class: 'result', style: 'display:none' });
  const run = async (expr: string) => {
    state.verifyText = expr;
    if (!expr.trim()) {
      result.style.display = 'none';
      void toPage({ type: 'ls:lookup', expr: '' }, 0);
      return;
    }
    const r = await toPage<LookupResponse>({ type: 'ls:lookup', expr }, 0);
    if (!r) return;
    result.style.display = 'block';
    result.className = `result ${r.error ? 'none' : r.count === 1 ? 'one' : r.count === 0 ? 'none' : 'many'}`;
    result.textContent = r.error
      ? `Invalid ${r.kind} locator: ${r.error}`
      : `${r.count} match${r.count === 1 ? '' : 'es'} · read as ${r.kind}${r.count > 1 ? ' · a strict-mode locator would fail' : ''}`;
  };
  const input = h('textarea', {
    placeholder: `Paste any locator, for example:\n#login button\n//button[normalize-space()='Save']\npage.getByRole('button', { name: 'Save' })\nBy.cssSelector("button.kebab")`,
    spellcheck: 'false',
    'aria-label': 'Locator to verify',
    oninput: (e: Event) => {
      const value = (e.target as HTMLTextAreaElement).value;
      clearTimeout(verifyTimer);
      verifyTimer = window.setTimeout(() => void run(value), 180);
    },
  });
  input.value = state.verifyText;
  if (state.verifyText) void run(state.verifyText);
  return [
    h('p', { class: 'dim' }, 'Type or paste a locator. Matches are highlighted on the page as you type. CSS, XPath, Playwright chains and Selenium By are understood.'),
    input,
    result,
    h('p', { class: 'small dim', style: 'margin-top:10px' }, 'Checks the top frame. frameLocator() chains are not evaluated here yet.'),
  ];
}

// ------------------------------------------------------------------ Settings
function renderSettings(): Child[] {
  const update = (patch: Partial<Settings>) => {
    state.settings = { ...state.settings, ...patch };
    void saveSettings(state.settings);
    render();
  };
  const check = (key: 'autoCopy' | 'keepPicking' | 'autoCollect', label: string, hint: string) =>
    h(
      'label',
      { class: 'check' },
      h('input', { type: 'checkbox', checked: state.settings[key], onchange: (e: Event) => update({ [key]: (e.target as HTMLInputElement).checked }) }),
      h('span', {}, label, h('div', { class: 'small dim' }, hint)),
    );
  return [
    h(
      'label',
      { class: 'field' },
      h('span', {}, 'Test id attributes'),
      h('input', {
        type: 'text',
        value: state.settings.testIdAttrs.join(', '),
        onchange: (e: Event) => {
          const attrs = (e.target as HTMLInputElement).value.split(',').map((s) => s.trim()).filter((s) => /^[a-zA-Z_][\w-]*$/.test(s));
          update({ testIdAttrs: attrs.length ? attrs : DEFAULT_SETTINGS.testIdAttrs });
        },
      }),
      h('div', { class: 'small dim' }, 'In priority order. The first one found on an element wins. getByTestId() is emitted for data-testid; other attributes are emitted as CSS.'),
    ),
    check('autoCopy', 'Copy the best locator on pick', 'Uses the output format selected at the top.'),
    check('keepPicking', 'Stay in pick mode after a click', 'Lets you go through a page element by element. Esc stops.'),
    check('autoCollect', 'Add every pick to Collected', 'Duplicates are skipped.'),
    h('h2', {}, 'How locators are ranked'),
    h('p', { class: 'small dim' }, 'test id 100 · role + name 92 · label 88 · id 86 · placeholder 84 · name 80 · text 74 · CSS on attributes 66 · CSS on classes 58 · XPath 28 to 60. Penalties apply for dynamic numbers, ancestor hops, :nth-of-type and anchoring. 80 and above is high, 50 and above is medium.'),
    h('p', { class: 'small dim' }, 'Generated ids and classes (hashes, counters, CSS-in-JS, framework ids) are never used. Everything runs locally in the page; nothing is sent anywhere.'),
  ];
}

// ------------------------------------------------------------------ shell
function highlight(refId: number | null | undefined): void {
  void toPage({ type: 'ls:highlight', refId: refId ?? null });
}

function render(): void {
  const pick = $('pick');
  pick.textContent = state.picking ? 'Stop picking' : 'Pick element';
  pick.classList.toggle('on', state.picking);
  for (const b of Array.from(document.querySelectorAll<HTMLElement>('#format button'))) b.classList.toggle('on', b.dataset.format === format());
  for (const b of Array.from(document.querySelectorAll<HTMLElement>('#tabs button'))) b.classList.toggle('on', b.dataset.tab === state.tab);
  $('count').textContent = String(state.collected.length);

  const children: Child[] = state.blocked
    ? [h('p', { class: 'empty' }, 'This page cannot be inspected. Chrome does not allow extensions on its own pages (chrome://, the Web Store, the new tab page). Open a normal web page.')]
    : state.tab === 'inspect'
      ? renderInspect()
      : state.tab === 'collected'
        ? renderCollected()
        : state.tab === 'scan'
          ? renderScan()
          : state.tab === 'verify'
            ? renderVerify()
            : renderSettings();
  const scroll = view.scrollTop;
  view.replaceChildren(...children.filter((c): c is Node | string => Boolean(c)));
  view.scrollTop = scroll;
}

async function syncPickState(): Promise<void> {
  const tabId = await activeTabId();
  if (tabId === undefined) return;
  try {
    state.picking = Boolean(await chrome.tabs.sendMessage(tabId, { type: 'ls:ping' } satisfies ToContent, { frameId: 0 }));
  } catch {
    state.picking = false;
  }
  render();
}

async function init(): Promise<void> {
  state.settings = await loadSettings();
  const local = await chrome.storage.local.get(['collected', 'className']);
  state.collected = local.collected ?? [];
  state.className = local.className ?? '';
  try {
    const session = await chrome.storage.session.get('last');
    state.last = session.last ?? null;
  } catch {
    state.last = null;
  }

  $('pick').addEventListener('click', async () => {
    const on = await toPage<boolean>({ type: 'ls:pick', on: 'toggle' }, 0);
    if (on !== undefined) state.picking = on;
    render();
  });
  $('format').addEventListener('click', (e) => {
    const f = (e.target as HTMLElement).dataset.format as Format | undefined;
    if (!f) return;
    state.settings = { ...state.settings, format: f };
    void saveSettings(state.settings);
    render();
  });
  $('tabs').addEventListener('click', (e) => {
    const tab = (e.target as HTMLElement).closest('button')?.dataset.tab as Tab | undefined;
    if (!tab) return;
    if (state.tab === 'verify' && tab !== 'verify') void toPage({ type: 'ls:lookup', expr: '' }, 0);
    state.tab = tab;
    render();
  });

  chrome.runtime.onMessage.addListener((msg: FromContent) => {
    if (msg.type === 'ls:pick-state') {
      state.picking = msg.on;
      render();
    }
    return false;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.last) {
      state.last = changes.last.newValue ?? null;
      if (state.tab !== 'collected') state.tab = 'inspect';
      render();
    }
    if (area === 'local' && changes.collected) {
      state.collected = changes.collected.newValue ?? [];
      if (state.tab === 'collected') render();
      else $('count').textContent = String(state.collected.length);
    }
    if (area === 'sync' && changes.settings) {
      state.settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue ?? {}) };
    }
  });
  const pageChanged = () => {
    state.scan = null;
    state.blocked = false;
    void syncPickState();
  };
  chrome.tabs.onActivated.addListener(pageChanged);
  chrome.tabs.onUpdated.addListener((_id, info, tab) => {
    if (tab.active && info.status === 'complete') pageChanged();
  });

  render();
  void syncPickState();
}

void init();
