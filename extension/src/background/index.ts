import { addToCollected } from '../shared/collect';
import { ensureInjected, loadSettings, type FromContent, type ToContent } from '../shared/protocol';

const MENU_ID = 'locator-scout-suggest';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: MENU_ID, title: 'Locator Scout: suggest locator', contexts: ['all'] }, () => void chrome.runtime.lastError);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'toggle-picker' || !tab?.id) return;
  const tabId = tab.id;
  chrome.sidePanel.open({ tabId }).catch(() => undefined); // must be called synchronously inside the gesture
  void ensureInjected(tabId).then((ok) => {
    if (ok) void chrome.tabs.sendMessage(tabId, { type: 'ls:pick', on: 'toggle' } satisfies ToContent, { frameId: 0 }).catch(() => undefined);
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;
  const tabId = tab.id;
  chrome.sidePanel.open({ tabId }).catch(() => undefined);
  void chrome.tabs.sendMessage(tabId, { type: 'ls:pick-context' } satisfies ToContent, { frameId: info.frameId ?? 0 }).catch(() => undefined);
});

chrome.runtime.onMessage.addListener((msg: FromContent, sender) => {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return false;
  if (msg.type === 'ls:pick-state') {
    // One frame changed state (Esc, single pick): bring every other frame in line.
    void chrome.tabs.sendMessage(tabId, { type: 'ls:pick', on: msg.on, relay: true } satisfies ToContent).catch(() => undefined);
  } else if (msg.type === 'ls:picked') {
    void chrome.storage.session.set({ last: { result: msg.result, title: msg.title } });
    // Collected locators live in storage, so nothing is lost if the side panel is closed while picking.
    void loadSettings().then((settings) => (settings.autoCollect ? addToCollected([msg.result]) : undefined));
  }
  return false;
});
