import { recordVisit, rankTabs, frecency, urlKey, heatLevel } from './match.js';

const STORE_KEY = 'frecency';
const MAX_RESULTS = 50;

let db = null;
let popupWindowId = null;

async function loadDb() {
  if (db) return db;
  const r = await chrome.storage.local.get(STORE_KEY);
  db = r[STORE_KEY] || {};
  return db;
}

async function visit(url) {
  await loadDb();
  recordVisit(db, url);
  await chrome.storage.local.set({ [STORE_KEY]: db });
}

// ---- Frecency tracking (like `cd` hooks in zoxide) ----
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url) await visit(tab.url);
  } catch {
    /* tab closed */
  }
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.active) visit(changeInfo.url);
});

// ---- Opening the switcher ----
async function openSwitcher(tab) {
  if (!tab) [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

  // Toggle the fallback window if it is already open.
  if (popupWindowId !== null) {
    try {
      await chrome.windows.remove(popupWindowId);
      return;
    } catch {
      popupWindowId = null;
    }
  }

  try {
    // Overlay inside the current page (Spotlight style).
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['ui.js'] });
  } catch {
    // chrome:// pages, Web Store, PDF viewer etc. can't be scripted -> small centered window.
    await openFallbackWindow(tab);
  }
}

async function openFallbackWindow(tab) {
  const width = 680;
  const height = 480;
  let left;
  let top;
  if (tab?.windowId !== undefined) {
    const w = await chrome.windows.get(tab.windowId);
    left = Math.round(w.left + (w.width - width) / 2);
    top = Math.round(w.top + (w.height - height) / 4);
  }
  const url = chrome.runtime.getURL(`switcher.html?from=${tab?.id ?? ''}`);
  const win = await chrome.windows.create({ url, type: 'popup', width, height, left, top, focused: true });
  popupWindowId = win.id;
}

chrome.windows.onRemoved.addListener((id) => {
  if (id === popupWindowId) popupWindowId = null;
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'open-switcher') openSwitcher(tab);
});

chrome.action.onClicked.addListener((tab) => openSwitcher(tab));

// ---- Messages from the UI ----
async function search(query, currentTabId) {
  await loadDb();
  const tabs = await chrome.tabs.query({});
  const candidates = tabs.filter((t) => !t.url?.startsWith(chrome.runtime.getURL('')));
  const currentWindowId = tabs.find((t) => t.id === currentTabId)?.windowId;
  const now = Date.now();
  return rankTabs(candidates, query, db, currentTabId, now)
    .slice(0, MAX_RESULTS)
    .map((t) => ({
      id: t.id,
      windowId: t.windowId,
      title: t.title || t.url,
      url: t.url,
      favIconUrl: t.favIconUrl || '',
      current: t.id === currentTabId,
      pinned: !!t.pinned,
      audible: !!t.audible,
      otherWindow: currentWindowId !== undefined && t.windowId !== currentWindowId,
      heat: heatLevel(frecency(db[urlKey(t.url)], now)),
    }));
}

async function activate(tabId) {
  const tab = await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  if (popupWindowId !== null) {
    chrome.windows.remove(popupWindowId).catch(() => {});
    popupWindowId = null;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'search') {
    const current = msg.fromTabId ?? sender.tab?.id;
    search(msg.query || '', current).then(sendResponse);
    return true;
  }
  if (msg?.type === 'activate') {
    activate(msg.tabId).then(() => sendResponse(true), () => sendResponse(false));
    return true;
  }
  if (msg?.type === 'web-search') {
    // Uses the user's default search engine.
    chrome.search.query({ text: msg.query, disposition: 'NEW_TAB' }).then(
      () => sendResponse(true),
      () => sendResponse(false),
    );
    return true;
  }
  if (msg?.type === 'close-tab') {
    chrome.tabs.remove(msg.tabId).then(() => sendResponse(true), () => sendResponse(false));
    return true;
  }
  return false;
});
