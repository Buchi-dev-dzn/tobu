// Spotlight-like switcher UI.
// Runs either as an injected content script (overlay on the current page)
// or inside switcher.html (fallback window for pages that can't be scripted).
(() => {
  const STANDALONE = location.href.startsWith(chrome.runtime.getURL(''));

  if (!STANDALONE && window.__tobu) {
    window.__tobu.toggle();
    return;
  }

  const fromTabId = STANDALONE
    ? Number(new URLSearchParams(location.search).get('from')) || undefined
    : undefined;

  const ROW = 52; // px, fixed row height (lets the indicator & scrolling be pure math)
  const PAD = 6; // list padding
  const SEARCH_H = 60;
  const FOOTER_H = 36;
  const IS_MAC = /Mac/.test(navigator.platform);
  const MOD = IS_MAC ? '⌘' : 'Ctrl';

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }

    .root {
      --ink: #15171c;
      --muted: #6b7280;
      --faint: rgba(21, 23, 28, .07);
      --glass: rgba(248, 249, 251, .82);
      --accent: #3d5afe;
      --sel: #3d5afe;
      --on-sel: #fff;
      --tile: #fff;
      --spring: cubic-bezier(.16, 1, .3, 1);
      --snap: cubic-bezier(.3, 1.35, .5, 1);

      position: fixed; inset: 0; z-index: 2147483647;
      display: flex; justify-content: center; align-items: flex-start;
      padding-top: 16vh;
      font: 14px/1.35 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Hiragino Sans", "Segoe UI", system-ui, sans-serif;
      color: var(--ink);
      -webkit-font-smoothing: antialiased;
      text-align: left;
    }
    @media (prefers-color-scheme: dark) {
      .root {
        --ink: #eceef2;
        --muted: #9097a3;
        --faint: rgba(255, 255, 255, .08);
        --glass: rgba(30, 31, 36, .78);
        --accent: #8c9eff;
        --sel: #4a5cf0;
        --tile: rgba(255, 255, 255, .94);
      }
    }

    /* ---------- shell ---------- */
    .backdrop {
      position: absolute; inset: 0;
      background: rgba(10, 12, 20, .16);
      animation: fade-in 180ms ease-out both;
    }
    .panel {
      position: relative;
      width: min(680px, calc(100vw - 32px));
      display: flex; flex-direction: column;
      background: var(--glass);
      backdrop-filter: blur(30px) saturate(1.8);
      -webkit-backdrop-filter: blur(30px) saturate(1.8);
      border-radius: 16px;
      box-shadow:
        0 0 0 .5px rgba(0, 0, 0, .2),
        inset 0 .5px 0 rgba(255, 255, 255, .55),
        0 32px 80px -12px rgba(10, 12, 30, .45),
        0 10px 24px -10px rgba(10, 12, 30, .3);
      overflow: hidden;
      transform-origin: 50% 0;
      animation: panel-in 280ms var(--spring) both;
    }
    .closing .panel { animation: panel-out 140ms cubic-bezier(.4, 0, 1, 1) both; }
    .closing .backdrop { animation: fade-out 140ms ease-in both; }

    @keyframes fade-in { from { opacity: 0; } }
    @keyframes fade-out { to { opacity: 0; } }
    @keyframes panel-in { from { opacity: 0; transform: translateY(-10px) scale(.965); } }
    @keyframes panel-out { to { opacity: 0; transform: translateY(-4px) scale(.98); } }

    /* ---------- search field ---------- */
    .search {
      height: ${SEARCH_H}px; flex: none;
      display: flex; align-items: center; gap: 12px;
      padding: 0 18px 0 20px;
    }
    .search svg { flex: none; color: var(--muted); transition: color 160ms; }
    .search.typing svg { color: var(--accent); }
    input {
      all: unset; flex: 1; min-width: 0;
      font-size: 22px; font-weight: 400; letter-spacing: -.012em;
      color: var(--ink); caret-color: var(--accent);
    }
    input::placeholder { color: var(--muted); opacity: .7; }
    .count {
      flex: none; font-size: 12px; color: var(--muted);
      font-variant-numeric: tabular-nums;
      transition: opacity 160ms;
    }

    /* ---------- results ---------- */
    .body { flex: none; border-top: 1px solid transparent; transition: border-color 160ms; }
    .body.has-content { border-top-color: var(--faint); }
    .list {
      position: relative;
      height: 0;
      overflow-y: auto; overflow-x: hidden;
      padding: ${PAD}px;
      transition: height 220ms var(--spring);
      scrollbar-width: thin;
      overscroll-behavior: contain;
    }
    .list.empty-list { padding: 0; }
    .indicator {
      position: absolute; left: ${PAD}px; right: ${PAD}px; top: 0;
      height: ${ROW}px; border-radius: 11px;
      background: var(--sel);
      box-shadow: 0 6px 16px -8px var(--sel), inset 0 .5px 0 rgba(255, 255, 255, .25);
      transition: transform 210ms var(--snap), opacity 120ms;
      pointer-events: none;
    }
    .indicator.instant { transition: none; }
    .indicator.hidden { opacity: 0; }
    .indicator.press { animation: press 160ms ease-out; }
    @keyframes press { 50% { scale: .985; filter: brightness(1.12); } }

    .row {
      position: relative; z-index: 1;
      height: ${ROW}px;
      display: grid; grid-template-columns: 28px minmax(0, 1fr) auto;
      align-items: center; column-gap: 12px;
      padding: 0 12px 0 10px;
      border-radius: 11px;
      cursor: default; user-select: none;
      transition: color 120ms;
    }
    .row.enter { animation: row-in 260ms var(--spring) both; }
    @keyframes row-in { from { opacity: 0; transform: translateY(6px); } }
    .row.removing { animation: row-out 170ms ease-in both; }
    @keyframes row-out { to { opacity: 0; transform: translateX(18px); } }

    .tile {
      width: 28px; height: 28px; border-radius: 7px;
      display: grid; place-items: center;
      background: var(--tile);
      box-shadow: 0 0 0 .5px rgba(0, 0, 0, .14), 0 1px 2px rgba(0, 0, 0, .08);
      overflow: hidden;
    }
    .tile img { width: 18px; height: 18px; display: block; }
    .tile.letter { color: #fff; font-size: 13px; font-weight: 650; box-shadow: inset 0 .5px 0 rgba(255,255,255,.3); }

    .text { min-width: 0; }
    .title, .url { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .title { font-size: 14px; font-weight: 500; letter-spacing: -.005em; }
    .url { font-size: 12px; color: var(--muted); margin-top: 1px; transition: color 120ms; }
    .url .host { color: var(--ink); opacity: .72; transition: color 120ms; }
    mark { background: none; color: var(--accent); font-weight: 600; }

    .meta { display: flex; align-items: center; gap: 10px; color: var(--muted); transition: color 120ms; }
    .meta svg { display: block; }
    .tag { font-size: 11px; }
    .heat { display: flex; align-items: flex-end; gap: 2px; height: 13px; }
    .heat i { width: 3px; border-radius: 1px; background: currentColor; opacity: .18; }
    .heat i.on { opacity: .85; }
    .heat i:nth-child(1) { height: 4px; }
    .heat i:nth-child(2) { height: 7px; }
    .heat i:nth-child(3) { height: 10px; }
    .heat i:nth-child(4) { height: 13px; }
    .enter-key {
      display: none;
      font-size: 11px; line-height: 18px; height: 18px; min-width: 22px; padding: 0 5px;
      text-align: center; border-radius: 5px;
      background: rgba(255, 255, 255, .2);
    }

    .row.sel { color: var(--on-sel); }
    .row.sel .url, .row.sel .meta { color: rgba(255, 255, 255, .78); }
    .row.sel .url .host { color: #fff; opacity: .95; }
    .row.sel mark { color: inherit; text-decoration: underline; text-decoration-thickness: 1.5px; text-underline-offset: 2px; }
    .row.sel .enter-key { display: block; animation: fade-in 140ms ease-out; }

    /* ---------- empty state ---------- */
    .empty { padding: 18px 20px 20px; animation: fade-in 160ms ease-out; }
    .empty[hidden] { display: none; }
    .empty strong { display: block; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .empty span { display: block; margin-top: 2px; font-size: 12px; color: var(--muted); }

    /* ---------- footer ---------- */
    footer {
      height: ${FOOTER_H}px; flex: none;
      display: flex; align-items: center; gap: 16px;
      padding: 0 14px;
      border-top: 1px solid var(--faint);
      font-size: 11.5px; color: var(--muted);
    }
    footer .push { margin-left: auto; }
    footer span { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
    kbd {
      font-family: inherit; font-size: 11px; font-weight: 500; line-height: 18px;
      min-width: 18px; height: 18px; padding: 0 5px;
      text-align: center; border-radius: 5px;
      background: var(--faint); color: var(--ink);
      box-shadow: inset 0 -.5px 0 rgba(0, 0, 0, .12);
    }

    /* ---------- standalone (fallback window) ---------- */
    .root.standalone { position: static; padding: 0; height: 100vh; }
    .standalone .backdrop { display: none; }
    .standalone .panel { width: 100%; height: 100vh; border-radius: 0; box-shadow: none; animation: none; }
    .standalone .body { flex: 1; }
    .standalone footer { margin-top: auto; }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: 1ms !important; animation-delay: 0ms !important; transition: none !important; }
    }
  `;

  const TILE_COLORS = ['#e5484d', '#f76b15', '#d6a10b', '#30a46c', '#12a594', '#0090ff', '#3e63dd', '#8e4ec6', '#d6409f', '#6f6e77'];

  const ICONS = {
    search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    pin: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M16 3H8v2l1 1v5l-3 3v2h5v6l1 1 1-1v-6h5v-2l-3-3V6l1-1z"/></svg>',
    audio: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    window: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="14" height="12" rx="2"/><path d="M7 21h12a2 2 0 0 0 2-2V9"/></svg>',
  };

  // ---------- DOM ----------
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>${CSS}</style>
    <div class="root${STANDALONE ? ' standalone' : ''}">
      <div class="backdrop"></div>
      <div class="panel" role="dialog" aria-label="Tobu: jump to a tab">
        <label class="search">
          ${ICONS.search}
          <input type="text" placeholder="Jump to a tab" spellcheck="false" autocomplete="off"
                 role="combobox" aria-expanded="true" aria-controls="tobu-list" />
          <span class="count"></span>
        </label>
        <div class="body">
          <div class="list" id="tobu-list" role="listbox"><div class="indicator hidden"></div></div>
          <div class="empty" hidden><strong></strong><span>Try fewer or shorter words, or search the web instead.</span></div>
        </div>
        <footer></footer>
      </div>
    </div>`;

  const rootEl = shadow.querySelector('.root');
  const backdrop = shadow.querySelector('.backdrop');
  const searchEl = shadow.querySelector('.search');
  const input = shadow.querySelector('input');
  const countEl = shadow.querySelector('.count');
  const body = shadow.querySelector('.body');
  const list = shadow.querySelector('.list');
  const indicator = shadow.querySelector('.indicator');
  const emptyEl = shadow.querySelector('.empty');
  const footer = shadow.querySelector('footer');

  // ---------- state ----------
  let results = [];
  let selected = 0;
  let seq = 0;
  let open = false;
  let firstRender = true;
  let prevFocus = null;
  let closeTimer = null;

  const send = (msg) => chrome.runtime.sendMessage(msg);

  // ---------- helpers ----------
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function highlight(text, keywords) {
    if (!keywords.length) return esc(text);
    const lower = text.toLowerCase();
    const marks = new Array(text.length).fill(false);
    for (const kw of keywords) {
      for (let i = lower.indexOf(kw); i !== -1; i = lower.indexOf(kw, i + kw.length)) {
        for (let j = i; j < i + kw.length; j++) marks[j] = true;
      }
    }
    let out = '';
    let on = false;
    for (let i = 0; i < text.length; i++) {
      if (marks[i] !== on) {
        out += marks[i] ? '<mark>' : '</mark>';
        on = marks[i];
      }
      out += esc(text[i]);
    }
    return on ? out + '</mark>' : out;
  }

  function splitUrl(url) {
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        const host = u.host.replace(/^www\./, '');
        const rest = (u.pathname === '/' ? '' : u.pathname) + u.search;
        return { host, rest };
      }
      return { host: u.protocol.replace(':', '') + '://' + u.host, rest: u.pathname };
    } catch {
      return { host: url || '', rest: '' };
    }
  }

  function letterTile(r) {
    const { host } = splitUrl(r.url);
    const label = (host.replace(/^[a-z]+:\/\//, '') || r.title || '?').trim()[0]?.toUpperCase() || '?';
    // FNV-1a hash -> curated palette, so the same site always gets the same color.
    let h = 0x811c9dc5;
    for (const c of host) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
    const el = document.createElement('div');
    el.className = 'tile letter';
    el.style.background = TILE_COLORS[(h >>> 0) % TILE_COLORS.length];
    el.textContent = label;
    return el;
  }

  function tileFor(r) {
    if (!r.favIconUrl || r.favIconUrl.startsWith('chrome://')) return letterTile(r);
    const el = document.createElement('div');
    el.className = 'tile';
    const img = document.createElement('img');
    img.alt = '';
    img.src = r.favIconUrl;
    img.addEventListener('error', () => el.replaceWith(letterTile(r)), { once: true });
    el.appendChild(img);
    return el;
  }

  function maxVisibleRows() {
    if (STANDALONE) return Math.max(3, (innerHeight - SEARCH_H - FOOTER_H - PAD * 2) / ROW);
    return 7.5; // the half row hints that the list scrolls
  }

  // ---------- rendering ----------
  function renderFooter() {
    const q = input.value.trim();
    const parts = [];
    if (results.length) {
      const sel = results[selected];
      parts.push(`<span><kbd>↵</kbd>${sel?.current ? 'Stay here' : 'Switch to tab'}</span>`);
      parts.push('<span><kbd>↑</kbd><kbd>↓</kbd>Select</span>');
      if (!q) parts.push(`<span><kbd>${MOD}</kbd><kbd>⌫</kbd>Close tab</span>`);
    } else if (q) {
      parts.push('<span><kbd>↵</kbd>Search the web</span>');
    }
    parts.push(`<span class="push"><kbd>esc</kbd>${q ? 'Clear' : 'Dismiss'}</span>`);
    footer.innerHTML = parts.join('');
  }

  function render() {
    const q = input.value.trim();
    const keywords = q.toLowerCase().split(/\s+/).filter(Boolean);

    const rows = results.map((r, i) => {
      const row = document.createElement('div');
      row.className = 'row' + (i === selected ? ' sel' : '');
      if (firstRender && i < 9) {
        row.classList.add('enter');
        row.style.animationDelay = `${40 + i * 18}ms`;
      }
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(i === selected));

      const { host, rest } = splitUrl(r.url);
      const heat = [1, 2, 3, 4].map((n) => `<i class="${n <= r.heat ? 'on' : ''}"></i>`).join('');
      const tags = [
        r.current ? '<span class="tag">Current tab</span>' : '',
        r.pinned ? `<span title="Pinned">${ICONS.pin}</span>` : '',
        r.audible ? `<span title="Playing audio">${ICONS.audio}</span>` : '',
        r.otherWindow ? `<span title="In another window">${ICONS.window}</span>` : '',
      ].join('');

      row.innerHTML = `
        <div class="text">
          <div class="title">${highlight(r.title || r.url || '', keywords)}</div>
          <div class="url"><span class="host">${highlight(host, keywords)}</span>${highlight(rest, keywords)}</div>
        </div>
        <div class="meta">${tags}<span class="heat" title="How often you visit">${heat}</span><span class="enter-key">↵</span></div>`;
      row.prepend(tileFor(r));

      row.addEventListener('mousemove', () => {
        if (selected !== i) setSelected(i, false);
      });
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        choose(i);
      });
      return row;
    });

    list.replaceChildren(indicator, ...rows);

    // Panel height follows the number of results.
    const n = results.length;
    list.classList.toggle('empty-list', n === 0);
    list.style.height = n ? `${Math.min(n, maxVisibleRows()) * ROW + PAD * 2}px` : '0px';

    emptyEl.hidden = n > 0 || !q;
    if (!emptyEl.hidden) emptyEl.querySelector('strong').textContent = `No open tab matches “${q}”`;
    body.classList.toggle('has-content', n > 0 || !!q);
    searchEl.classList.toggle('typing', !!q);
    countEl.textContent = n ? `${n} ${n === 1 ? 'tab' : 'tabs'}` : '';

    placeIndicator(firstRender);
    renderFooter();
    firstRender = false;
  }

  function placeIndicator(instant) {
    indicator.classList.toggle('hidden', results.length === 0);
    if (instant) indicator.classList.add('instant');
    indicator.style.transform = `translateY(${PAD + selected * ROW}px)`;
    if (instant) requestAnimationFrame(() => indicator.classList.remove('instant'));
  }

  function setSelected(i, scroll = true) {
    selected = i;
    const rows = list.querySelectorAll('.row');
    rows.forEach((row, j) => {
      row.classList.toggle('sel', j === i);
      row.setAttribute('aria-selected', String(j === i));
    });
    placeIndicator(false);
    if (scroll) {
      const top = PAD + i * ROW;
      if (top - PAD < list.scrollTop) list.scrollTop = top - PAD;
      else if (top + ROW + PAD > list.scrollTop + list.clientHeight) list.scrollTop = top + ROW + PAD - list.clientHeight;
    }
    renderFooter();
  }

  // ---------- actions ----------
  async function refresh() {
    const mySeq = ++seq;
    const r = await send({ type: 'search', query: input.value, fromTabId });
    if (mySeq !== seq || !open) return; // stale
    results = r || [];
    selected = 0;
    list.scrollTop = 0;
    render();
  }

  async function choose(i) {
    const r = results[i];
    if (!r) return;
    if (r.current) {
      indicator.classList.add('press');
      close();
      return;
    }
    // We are leaving this page, so remove instantly; an exit animation would be invisible
    // and would leave the overlay behind in the background tab.
    close(true);
    await send({ type: 'activate', tabId: r.id });
  }

  async function closeTab(i) {
    const r = results[i];
    if (!r) return;
    const row = list.querySelectorAll('.row')[i];
    row?.classList.add('removing');
    indicator.classList.add('hidden');
    await Promise.all([send({ type: 'close-tab', tabId: r.id }), new Promise((res) => setTimeout(res, 160))]);
    const mySeq = ++seq;
    const next = await send({ type: 'search', query: input.value, fromTabId });
    if (mySeq !== seq) return;
    results = next || [];
    selected = Math.min(i, Math.max(0, results.length - 1));
    render();
  }

  function webSearch() {
    const q = input.value.trim();
    if (!q) return;
    close(true);
    send({ type: 'web-search', query: q });
  }

  function move(d) {
    if (!results.length) return;
    setSelected((selected + d + results.length) % results.length);
  }

  function onKeyDown(e) {
    e.stopPropagation();
    if (e.isComposing || e.keyCode === 229) return; // IME composition (e.g. Japanese input)
    const ctrl = e.ctrlKey && !e.metaKey && !e.altKey;
    const key = e.key;

    if (key === 'ArrowDown' || (ctrl && (key === 'n' || key === 'j')) || (key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      move(1);
    } else if (key === 'ArrowUp' || (ctrl && (key === 'p' || key === 'k')) || (key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      move(-1);
    } else if (key === 'Enter') {
      e.preventDefault();
      if (results.length) choose(selected);
      else webSearch();
    } else if (key === 'Escape') {
      e.preventDefault();
      if (input.value) {
        input.value = '';
        refresh();
      } else close();
    } else if (key === 'Backspace' && (e.metaKey || e.ctrlKey) && !input.value) {
      e.preventDefault();
      closeTab(selected);
    }
  }

  // Keep page shortcuts from seeing our keystrokes.
  input.addEventListener('keydown', onKeyDown);
  input.addEventListener('keyup', (e) => e.stopPropagation());
  input.addEventListener('keypress', (e) => e.stopPropagation());
  input.addEventListener('input', refresh);
  backdrop.addEventListener('mousedown', (e) => {
    e.preventDefault();
    close();
  });

  // ---------- open / close ----------
  function show() {
    if (open) return;
    clearTimeout(closeTimer);
    open = true;
    firstRender = true;
    prevFocus = document.activeElement;
    rootEl.classList.remove('closing');
    (STANDALONE ? document.body : document.documentElement).appendChild(host);
    input.value = '';
    input.focus();
    refresh();
  }

  function close(instant = false) {
    if (!open) return;
    open = false;
    seq++; // drop in-flight searches
    if (STANDALONE) {
      window.close();
      return;
    }
    const finish = () => {
      host.remove();
      rootEl.classList.remove('closing');
      indicator.classList.remove('press');
    };
    try {
      prevFocus?.focus?.({ preventScroll: true });
    } catch {
      /* ignore */
    }
    if (instant || document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finish();
    } else {
      rootEl.classList.add('closing');
      closeTimer = setTimeout(finish, 150);
    }
  }

  // If the user leaves this tab some other way, don't leave the overlay behind.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && open) close(true);
  });

  if (STANDALONE) {
    window.addEventListener('blur', () => window.close());
  } else {
    window.__tobu = { toggle: () => (open ? close() : show()) };
  }

  show();
})();
