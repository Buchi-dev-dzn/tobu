import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchScore, rankTabs, recordVisit, frecency, urlKey, heatLevel } from './match.js';

test('heatLevel maps frecency to 0\u20134 bars', () => {
  assert.equal(heatLevel(0), 0);
  assert.equal(heatLevel(0.25), 1);
  assert.equal(heatLevel(10), 2);
  assert.equal(heatLevel(100), 4);
  assert.equal(heatLevel(1e6), 4);
});

const now = 1_700_000_000_000;
const tabs = [
  { id: 1, title: 'GitHub - ajeetdsouza/zoxide', url: 'https://github.com/ajeetdsouza/zoxide', lastAccessed: 10 },
  { id: 2, title: 'Gmail - Inbox', url: 'https://mail.google.com/mail/u/0/', lastAccessed: 30 },
  { id: 3, title: 'Google Docs', url: 'https://docs.google.com/document/d/x', lastAccessed: 20 },
  { id: 4, title: 'YouTube', url: 'https://www.youtube.com/', lastAccessed: 40 },
  { id: 5, title: 'GitHub Issues', url: 'https://github.com/foo/bar/issues', lastAccessed: 5 },
];

test('non-matching keyword excludes the tab', () => {
  assert.equal(matchScore('zzz', 'GitHub', 'https://github.com'), 0);
});

test('all keywords must match (zoxide semantics)', () => {
  const ids = rankTabs(tabs, 'git zox', {}, undefined, now).map((t) => t.id);
  assert.deepEqual(ids, [1]);
});

test('closest match wins without history', () => {
  assert.equal(rankTabs(tabs, 'youtube', {}, undefined, now)[0].id, 4);
  assert.equal(rankTabs(tabs, 'gmail', {}, undefined, now)[0].id, 2);
});

test('fuzzy subsequence still matches', () => {
  assert.equal(rankTabs(tabs, 'ytb', {}, undefined, now)[0].id, 4);
});

test('frecency breaks ties between similar matches', () => {
  const db = {};
  for (let i = 0; i < 20; i++) recordVisit(db, tabs[4].url, now);
  const ranked = rankTabs(tabs, 'github', db, undefined, now).map((t) => t.id);
  assert.deepEqual(ranked.slice(0, 2), [5, 1]);
});

test('current tab is deprioritized', () => {
  const ranked = rankTabs(tabs, 'github', {}, 1, now).map((t) => t.id);
  assert.equal(ranked[0], 5);
});

test('empty query is MRU with current tab last', () => {
  const ids = rankTabs(tabs, '', {}, 4, now).map((t) => t.id);
  assert.deepEqual(ids, [2, 3, 1, 5, 4]);
});

test('frecency decays with age', () => {
  const e = { rank: 8, last: now };
  assert.equal(frecency(e, now), 32);
  assert.equal(frecency(e, now + 2 * 3600e3), 16);
  assert.equal(frecency(e, now + 3 * 86400e3), 4);
  assert.equal(frecency(e, now + 30 * 86400e3), 2);
});

test('urlKey drops hash and ignores new tab page', () => {
  assert.equal(urlKey('https://a.com/x#y'), 'https://a.com/x');
  assert.equal(urlKey('chrome://newtab/'), null);
});

test('aging keeps total rank bounded', () => {
  const db = {};
  for (let i = 0; i < 12000; i++) recordVisit(db, `https://a.com/${i % 50}`, now);
  const total = Object.values(db).reduce((s, e) => s + e.rank, 0);
  assert.ok(total <= 10000);
});
