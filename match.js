// Pure ranking logic (no chrome.* APIs) so it can be unit-tested with Node.

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** Max total rank before aging kicks in (same idea as zoxide's _ZO_MAXAGE). */
export const MAX_AGE = 10000;

/** Normalize a URL into a frecency key: drop the hash, keep everything else. */
export function urlKey(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol === 'chrome:' && u.hostname === 'newtab') return null;
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

/** Record a visit in-place. Returns the db. */
export function recordVisit(db, url, now = Date.now()) {
  const key = urlKey(url);
  if (!key) return db;
  const entry = db[key] || { rank: 0, last: 0 };
  entry.rank += 1;
  entry.last = now;
  db[key] = entry;

  // zoxide-style aging: when the sum exceeds MAX_AGE, decay everything.
  let total = 0;
  for (const k in db) total += db[k].rank;
  if (total > MAX_AGE) {
    for (const k in db) {
      db[k].rank *= 0.9;
      if (db[k].rank < 1) delete db[k];
    }
  }
  return db;
}

/** zoxide's frecency formula. */
export function frecency(entry, now = Date.now()) {
  if (!entry) return 0;
  const age = now - entry.last;
  if (age < HOUR) return entry.rank * 4;
  if (age < DAY) return entry.rank * 2;
  if (age < WEEK) return entry.rank / 2;
  return entry.rank / 4;
}

/** Map frecency to 0–4 bars for the UI heat meter (log scale). */
export function heatLevel(f) {
  if (!f || f <= 0) return 0;
  return Math.max(1, Math.min(4, Math.ceil(Math.log2(1 + f) / 2)));
}

const BOUNDARY = /[\s/.\-_:?#=&|,()[\]「」・｜]/;

function substringScore(text, kw) {
  const i = text.indexOf(kw);
  if (i === -1) return 0;
  let s = 10;
  if (i === 0) s += 6;
  else if (BOUNDARY.test(text[i - 1])) s += 4;
  if (text.length === kw.length) s += 4;
  return s;
}

/** Subsequence match; returns 0 when not a subsequence, otherwise up to ~5. */
function fuzzyScore(text, kw) {
  let ti = 0;
  let start = -1;
  for (const ch of kw) {
    ti = text.indexOf(ch, ti);
    if (ti === -1) return 0;
    if (start === -1) start = ti;
    ti += 1;
  }
  const span = ti - start;
  return (5 * kw.length) / span;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Score how well a tab matches the query. Returns 0 if any keyword fails to match.
 * Like zoxide, every whitespace-separated keyword must match.
 */
export function matchScore(query, title, url) {
  const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (keywords.length === 0) return 1;
  const t = (title || '').toLowerCase();
  const u = (url || '').toLowerCase().replace(/^[a-z-]+:\/\//, '');
  const h = hostOf(url).toLowerCase();

  let total = 0;
  for (const kw of keywords) {
    let best = Math.max(
      substringScore(t, kw) * 1.0,
      substringScore(h, kw) * 1.2,
      substringScore(u, kw) * 0.8,
    );
    if (best === 0) best = Math.max(fuzzyScore(t, kw), fuzzyScore(u, kw) * 0.8);
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

/**
 * Rank open tabs for a query.
 * @param {Array<{id:number,title:string,url:string,lastAccessed?:number}>} tabs
 * @param {string} query
 * @param {object} db frecency db
 * @param {number|undefined} currentTabId tab the user is switching *from*
 */
export function rankTabs(tabs, query, db, currentTabId, now = Date.now()) {
  const q = query.trim();
  if (!q) {
    // Empty query: most-recently-used first, current tab last (quick "switch back").
    return [...tabs].sort((a, b) => {
      if (a.id === currentTabId) return 1;
      if (b.id === currentTabId) return -1;
      return (b.lastAccessed || 0) - (a.lastAccessed || 0);
    });
  }

  const scored = [];
  for (const tab of tabs) {
    const m = matchScore(q, tab.title, tab.url);
    if (m === 0) continue;
    const f = frecency(db[urlKey(tab.url)], now);
    let score = m * (1 + 0.15 * Math.log2(1 + f));
    if (tab.id === currentTabId) score *= 0.3;
    scored.push({ tab, score });
  }
  scored.sort(
    (a, b) => b.score - a.score || (b.tab.lastAccessed || 0) - (a.tab.lastAccessed || 0),
  );
  return scored.map((s) => s.tab);
}
