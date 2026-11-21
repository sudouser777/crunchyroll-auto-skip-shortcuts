# Crunchyroll Auto Skip & Enhanced Shortcuts

[![Version](https://img.shields.io/badge/version-1.0-f47521)](https://github.com/sudouser777/crunchyroll-auto-skip-shortcuts/releases/tag/v1.0)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-compatible-green)](https://www.tampermonkey.net/)
[![Violentmonkey](https://img.shields.io/badge/Violentmonkey-compatible-green)](https://violentmonkey.github.io/)

A lightweight userscript for [Crunchyroll](https://www.crunchyroll.com) that **automatically skips intros, recaps, and credits**, and adds a full set of **reliable, YouTube-style keyboard shortcuts** to the web player — hardened against React state desync and the player's native event hijacking.

No configuration needed. Install it and it just works.

## 📜 The Scripts

| Script | What it does |
| --- | --- |
| [`crunchyroll-auto-skip-shortcuts.user.js`](https://raw.githubusercontent.com/sudouser777/crunchyroll-auto-skip-shortcuts/main/crunchyroll-auto-skip-shortcuts.user.js) | Clicks Crunchyroll's own skip buttons and adds the enhanced keyboard shortcuts. |
| [`crunchyroll-auto-skip-recap.user.js`](https://raw.githubusercontent.com/sudouser777/crunchyroll-auto-skip-shortcuts/main/crunchyroll-auto-skip-recap.user.js) | Skips recaps that have **no** skip button by matching the episode title in the captions, falls back to Crunchyroll skip data / AniSkip, and auto-plays the next episode once the credits start. |

The two scripts are independent — install either one, or both.

## ✨ Features

- **Auto-skip** — clicks *Skip Intro*, *Skip Recap*, and *Skip Credits* the moment they appear (works with the current Vilos player UI and in every interface language).
- **Enhanced keyboard shortcuts** — play/pause, ±10/30/60 s seeking, volume, speed, fullscreen, picture-in-picture, subtitles, next episode, and 0–9 percentage jumps.
- **Rock-solid seeking** — a seek guard re-applies your target if the player's React state tries to snap the timeline back, and rapid key presses accumulate correctly instead of fighting each other.
- **Event hijacking protection** — shortcuts are handled in the capture phase so the stock player can't swallow or double-handle them.
- **Browser-friendly** — never steals keys while you're typing, and leaves browser combos like `Alt+←` / `Cmd+←` (Back) and `Ctrl+F` alone.
- **Zero dependencies, zero tracking** — plain JavaScript, `@grant none`, no network requests, no data collection.

## 📦 Installation

1. Install a userscript manager for your browser:
   - [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Edge, Firefox, Safari, Opera)
   - [Violentmonkey](https://violentmonkey.github.io/) (Chrome, Edge, Firefox)
   - [Greasemonkey](https://addons.mozilla.org/firefox/addon/greasemonkey/) (Firefox)
2. Install the script(s) you want — your userscript manager will open an install prompt:
   - **[Crunchyroll Auto Skip & Enhanced Shortcuts](https://raw.githubusercontent.com/sudouser777/crunchyroll-auto-skip-shortcuts/main/crunchyroll-auto-skip-shortcuts.user.js)** — skip buttons + keyboard shortcuts.
   - **[Crunchyroll Auto Skip Recap](https://raw.githubusercontent.com/sudouser777/crunchyroll-auto-skip-shortcuts/main/crunchyroll-auto-skip-recap.user.js)** — skips unskippable recaps and auto-advances to the next episode.
3. Confirm the installation, then open (or reload) any Crunchyroll watch page.

> **Chrome / Edge note:** recent Chrome versions require Developer Mode for userscripts. Go to `chrome://extensions` → enable **Developer mode** (top-right toggle), or in Tampermonkey's settings follow the "enable user scripts" prompt. Without this, Tampermonkey cannot inject any script.

Updates are delivered automatically: the script's `@updateURL` points at this repository, so your manager picks up new versions when they're published.

## ⌨️ Keyboard Shortcuts

Shortcuts are active on watch pages whenever you're not typing in a text field. Click the player once if keys don't respond (the player lives in an iframe and needs focus).

### Playback

| Key | Action |
| --- | --- |
| `Space` / `K` | Play / pause |
| `J` / `L` | Seek −10 s / +10 s |
| `←` / `→` | Seek −10 s / +10 s |
| `Shift` + `←` / `→` | Seek −30 s / +30 s |
| `Ctrl` + `←` / `→` | Seek −60 s / +60 s |
| `0` – `9` | Jump to 0% – 90% of the episode |
| `N` | Next episode |

### Audio & Video

| Key | Action |
| --- | --- |
| `↑` / `↓` | Volume up / down (5% steps, unmutes on volume up) |
| `M` | Mute / unmute |
| `F` | Toggle fullscreen |
| `P` | Toggle picture-in-picture |
| `C` | Toggle subtitles (falls back to opening the track menu) |
| `,` / `.` | Playback speed −0.25× / +0.25× (0.25× – 4×) |

### Recap Script Only

| Key | Action |
| --- | --- |
| `S` | Mark the current position as the content start for this episode |
| `U` | Undo the last automatic skip |

Browser and system combinations (`Alt`/`Cmd` + arrows, `Ctrl+F`, `Ctrl+L`, …) are always passed through untouched.

## ⏭️ How Auto-Skip Works

Every 500 ms the script looks for a visible, enabled skip button and clicks it once:

- `button[aria-label="Skip Intro" / "Skip Recap" / "Skip Credits"]` (aria-labelled UI)
- `[data-testid="skipIntroText"]` and `[data-testid="skip-intro-icon"]` (current Vilos player UI — these test IDs are language-independent, so localized buttons like "ÜBERSPRINGEN" or "スキップ" work too)

A 1-second cooldown prevents double-firing while the player re-renders, so you never skip two segments by accident.

**Note:** Crunchyroll only shows skip buttons on supported series and for Premium accounts (it's a Crunchyroll feature, not something the script can add). Wherever the button appears, the script clicks it.

## 🎬 Auto Skip Recap (recaps with no skip button)

Some recaps — most notably older and long-running series like *One Piece* — are burnt into the episode and never show a *Skip Recap* button. `crunchyroll-auto-skip-recap.user.js` handles that case by using the episode's own captions as the signal.

### How it works

1. **Captures the player's own traffic.** At `document-start` the script wraps `fetch`/`XHR` to keep the signed `.mpd` manifest and WebVTT caption bodies the player already downloaded (re-fetching those URLs later returns HTTP 401, so the captured bodies are reused).
2. **Looks for the title in the captions.** The episode title is read from the page header and matched against caption cues in the first 8 minutes, with normalization (diacritics, punctuation, apostrophes), a stop-word-aware word-overlap score, and cue chaining for titles split across two cues. If nothing matches, the script leaves the timeline alone.
3. **Seeks to the title.** The jump goes through the player's own Bitmovin API rather than `video.currentTime`, which makes it instant and avoids a stall or a snap-back. If the API can't be reached, it falls back to `currentTime`.
4. **Fallbacks for other series.** When the title can't be matched, it uses Crunchyroll's own skip-event JSON for the episode, then community [AniSkip](https://aniskip.com) data (resolved through AniList).
5. **Credits → next episode.** The player's *Skip Credits* control is clicked as soon as it appears, then the next-episode button is clicked once, with a cooldown so it can't fire twice.

### Notes

- A saved mark (`S`) always takes priority over title matching, which is handy when an episode's captions don't contain the title.
- AniSkip matches by MyAnimeList ID. A seasonal show that maps to the wrong MAL entry can be pinned per series with `localStorage['crskip-mal-override:<series name, lowercase>'] = '<malId>'`, or AniSkip can be disabled entirely via `ENABLE_ANISKIP = false`.
- `DEBUG` and `TRACE_SEEK` near the top of the script turn on verbose logging and a seek timeline table in the console.
- This script runs on `www.crunchyroll.com` only (it needs the watch page, not the player iframe).

## 🔧 How the Shortcuts Stay Reliable

Crunchyroll's player is a React app that aggressively manages its own state. Naive scripts break in two ways: the timeline snaps back after a seek, and the player's own key handlers double-fire. This script counters both:

- **Capture-phase listeners** on `window` with `stopImmediatePropagation()` — your key press is handled exactly once, before the player's handlers ever see it.
- **Seek lock + guard interval** — after a seek, the target is held for 900 ms and re-applied if the player drifts more than 2 s away, while accounting for playback rate. Rapid presses accumulate from the locked target, so `L L L` reliably means +30 s.
- **Native slider sync** — the timeline `<input>` is updated through React's own value setter with proper `input`/`change` events, keeping the UI in sync with the video.

## 🌐 Compatibility

| Browser | Manager | Status |
| --- | --- | --- |
| Chrome / Edge / Brave / Opera | Tampermonkey or Violentmonkey | ✅ Supported |
| Firefox | Tampermonkey, Violentmonkey, or Greasemonkey | ✅ Supported |
| Safari | Tampermonkey / Userscripts | ✅ Should work |

The script runs on both `www.crunchyroll.com` and the embedded player at `static.crunchyroll.com/vilos-v2/...`, so it works regardless of which document has focus.

## 🩺 Troubleshooting

- **Nothing happens at all** — on Chrome/Edge, enable Developer Mode in `chrome://extensions` (see installation note). Check that the script is enabled in your manager's dashboard.
- **Shortcuts don't respond** — click anywhere on the video first so the player iframe has keyboard focus.
- **Auto-skip doesn't trigger** — the episode must actually show a skip button (Premium + supported series). If Crunchyroll shows the button but it isn't clicked, please [open an issue](https://github.com/sudouser777/crunchyroll-auto-skip-shortcuts/issues) with the episode URL.
- **Picture-in-picture unavailable** — some browsers/platforms disable PiP; the key is safely ignored there.
- **Debug logging** — set `const DEBUG = false;` to `true` near the top of the script to see skip/load logs in the console. In the recap script, `TRACE_SEEK = true` additionally prints a seek timeline.
- **Recap didn't skip** — confirm the script is enabled and check the console for `no cue matched title`. If the captions simply don't contain the title, press `S` at the content start once; the mark is remembered for that episode. Also note that only the first 8 minutes are searched.

## 🔒 Privacy

Both scripts run locally in your browser, collect **no data**, and use `@grant none` (no special userscript APIs). They only touch the player's DOM, the `<video>` element, and `localStorage` (marks and AniSkip caching).

The shortcuts script makes **no network requests**. The recap script makes requests only for what it needs to find a skip point: the episode manifest and caption files (usually served from the player's own cached responses) and, when title matching fails, public [AniSkip](https://aniskip.com) / [AniList](https://anilist.co) endpoints.

## ⚠️ Disclaimer

This project is **not affiliated with, endorsed by, or connected to Crunchyroll** in any way. It only automates clicks on buttons Crunchyroll already provides and controls the standard HTML5 video element. "Crunchyroll" is a trademark of its respective owners. Use at your own discretion; site updates may temporarily break selectors — issues and PRs welcome.

## 📄 License

[MIT](LICENSE) © sudouser777
