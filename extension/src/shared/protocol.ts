import { DEFAULT_ENGINE_SETTINGS, type Format, type PickResult } from '../engine';

export interface Settings {
  testIdAttrs: string[];
  format: Format;
  autoCopy: boolean;
  keepPicking: boolean;
  autoCollect: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  testIdAttrs: DEFAULT_ENGINE_SETTINGS.testIdAttrs,
  format: 'playwright',
  autoCopy: true,
  keepPicking: true,
  autoCollect: true,
};

export async function loadSettings(): Promise<Settings> {
  try {
    const stored = await chrome.storage.sync.get('settings');
    return { ...DEFAULT_SETTINGS, ...(stored.settings ?? {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set({ settings });
}

export interface CollectedItem {
  id: string;
  name: string;
  result: PickResult;
  /** Index into result.candidates the user chose. */
  chosen: number;
}

export interface ScanItem {
  result: PickResult;
  /** How many more elements share this parameterised locator (other rows of the same list). */
  repeat: number;
}

export interface ScanResponse {
  items: ScanItem[];
  total: number;
  truncated: boolean;
  ms: number;
  title: string;
  url: string;
}

export interface LookupResponse {
  kind: string;
  count: number;
  error?: string;
}

export type ToContent =
  | { type: 'ls:ping' }
  | { type: 'ls:pick'; on: boolean | 'toggle'; relay?: boolean }
  | { type: 'ls:pick-context' }
  | { type: 'ls:scan' }
  | { type: 'ls:lookup'; expr: string }
  | { type: 'ls:highlight'; refId: number | null };

export type FromContent =
  | { type: 'ls:picked'; result: PickResult; title: string }
  | { type: 'ls:pick-state'; on: boolean };

/** Make sure the content script is alive in the tab (it is missing in tabs opened before install). */
export async function ensureInjected(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'ls:ping' } satisfies ToContent, { frameId: 0 });
    return true;
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] });
      return true;
    } catch {
      return false;
    }
  }
}
