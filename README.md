# Tobu

> **Tobu** (跳ぶ) means "to jump" in Japanese.

A Chrome extension that opens a macOS Spotlight-style search bar from a keyboard shortcut and jumps to the **currently open tab** that best matches what you typed.
Like [zoxide](https://github.com/ajeetdsouza/zoxide), it learns how often and how recently you visit each tab (frecency) and ranks the tabs you use most higher.

## Installation

1. Open `chrome://extensions`
2. Turn on **Developer mode** in the top-right corner
3. Click **Load unpacked** and select this folder

Works the same way in Chromium-based browsers: Edge, Brave, and Arc.

## Usage

| Key | Action |
| --- | --- |
| `⌘⇧Space` (Windows/Linux: `Ctrl+Shift+Space`) | Open or close the switcher. Clicking the toolbar icon also works |
| Type | Narrow down by title or URL. Separate keywords with spaces for an AND search, e.g. `git zox` |
| `↵` | Switch to the selected tab, including tabs in other windows. With no results, search the web using your default search engine |
| `↑` `↓` / `Ctrl+N` `Ctrl+P` / `Tab` | Move the selection |
| `⌘⌫` (with an empty query) | Close the selected tab |
| `Esc` | Clear the query if there is one; otherwise close the switcher |
| Click outside | Close the switcher |

- The bars on the right of each row show frecency in 4 levels. The icons mark 📌 pinned tabs, 🔊 tabs playing audio, and ⧉ tabs in another window.
- With an empty query, tabs are listed in most-recently-used order, so `⌘⇧Space` → `↵` takes you back to the previous tab.
- To change the shortcut, go to `chrome://extensions/shortcuts`.
- Scripts can't be injected into pages like `chrome://` pages or the Chrome Web Store. On those pages the switcher opens in a small centered window instead.

## How ranking works

- **Match score**: each keyword is scored as a substring of the title, host, or URL. Matches at the start of the text or at a word boundary score higher. If there is no substring match, a subsequence fuzzy match (e.g. `ytb` → YouTube) is tried. A tab is excluded unless every keyword matches.
- **Frecency**: computed with zoxide's formula, based on how often each URL has been made the active tab. Visits within the last hour count ×4, within a day ×2, within a week ×½, and older ×¼. When the total exceeds 10000, all scores are multiplied by 0.9 and stale entries are removed.
- **Final score**: `match × (1 + 0.15·log2(1 + frecency))`. The current tab is moved down.

History is stored only in `chrome.storage.local` and is never sent anywhere.

## Development

```sh
node --test   # unit tests for the ranking logic in match.js
```
