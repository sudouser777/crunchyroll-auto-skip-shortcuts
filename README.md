# Crunchyroll Auto Skip & Enhanced Shortcuts

[![Version](https://img.shields.io/badge/version-1.0-f47521)](https://github.com/sudouser777/crunchyroll-auto-skip-shortcuts/releases/tag/v1.0)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-compatible-green)](https://www.tampermonkey.net/)
[![Violentmonkey](https://img.shields.io/badge/Violentmonkey-compatible-green)](https://violentmonkey.github.io/)

A lightweight userscript for [Crunchyroll](https://www.crunchyroll.com) that **automatically skips intros, recaps, and credits**, and adds a full set of **reliable, YouTube-style keyboard shortcuts** to the web player — hardened against React state desync and the player's native event hijacking.

No configuration needed. Install it and it just works.

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
2. **[Click here to install the script](https://raw.githubusercontent.com/sudouser777/crunchyroll-auto-skip-shortcuts/main/crunchyroll-auto-skip-shortcuts.user.js)** — your userscript manager will open an install prompt.
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

Browser and system combinations (`Alt`/`Cmd` + arrows, `Ctrl+F`, `Ctrl+L`, …) are always passed through untouched.

## ⏭️ How Auto-Skip Works

Every 500 ms the script looks for a visible, enabled skip button and clicks it once:

- `button[aria-label="Skip Intro" / "Skip Recap" / "Skip Credits"]` (aria-labelled UI)
- `[data-testid="skipIntroText"]` and `[data-testid="skip-intro-icon"]` (current Vilos player UI — these test IDs are language-independent, so localized buttons like "ÜBERSPRINGEN" or "スキップ" work too)

A 1-second cooldown prevents double-firing while the player re-renders, so you never skip two segments by accident.

**Note:** Crunchyroll only shows skip buttons on supported series and for Premium accounts (it's a Crunchyroll feature, not something the script can add). Wherever the button appears, the script clicks it.

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
- **Debug logging** — set `const DEBUG = false;` to `true` near the top of the script to see skip/load logs in the console.

## 🔒 Privacy

The script runs entirely locally in your browser. It makes **no network requests**, collects **no data**, and uses `@grant none` (no special userscript APIs). The only things it touches are the player's DOM and the `<video>` element.

## ⚠️ Disclaimer

This project is **not affiliated with, endorsed by, or connected to Crunchyroll** in any way. It only automates clicks on buttons Crunchyroll already provides and controls the standard HTML5 video element. "Crunchyroll" is a trademark of its respective owners. Use at your own discretion; site updates may temporarily break selectors — issues and PRs welcome.

## 📄 License

[MIT](LICENSE) © sudouser777
