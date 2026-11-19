# Changelog

All notable changes to this project are documented here.
This project follows the userscript `@version` numbering.

## 1.0 — 2026-11-19

Initial public release.

### Features
- Auto-skip for **Skip Intro**, **Skip Recap**, and **Skip Credits** buttons (500 ms polling, visibility/enablement checks, 1 s anti-double-fire cooldown).
- Support for both the aria-labelled skip buttons and the current Vilos player UI (`data-testid="skipIntroText"` / `skip-intro-icon`), making auto-skip work in all interface languages.
- Runs on both `www.crunchyroll.com` and the embedded player iframe (`static.crunchyroll.com/vilos-v2/...`).
- Enhanced keyboard shortcuts: play/pause (`Space`/`K`), ±10 s (`J`/`L`, arrows), ±30 s (`Shift`+arrows), ±60 s (`Ctrl`+arrows), 0–9 percentage jumps, volume (`↑`/`↓`), mute (`M`), fullscreen (`F`), picture-in-picture (`P`), subtitles (`C`), next episode (`N`), playback speed 0.25×–4× (`,`/`.`).
- Seek lock + guard interval that defeats React timeline snap-back; rapid presses accumulate from the locked target.
- React-native slider sync via the prototype value setter with `input`/`change` events.
- Capture-phase key handling with `stopImmediatePropagation()` to prevent the stock player from double-handling keys.

### Hardening
- Never intercepts keys while typing in inputs/textareas/contenteditable.
- Passes through browser/system combos: `Alt`+arrows and `Cmd`+arrows (back/forward), and all `Ctrl` combos except `Ctrl`+arrows.
- Safe promise handling for fullscreen and picture-in-picture; PiP availability check.
- Volume steps rounded to whole percentages (no float drift); volume-down no longer unmutes.

### Publishing metadata
- Proper `@namespace`, `@author`, `@license MIT`, `@icon`, `@homepageURL`, `@supportURL`, and `@downloadURL`/`@updateURL` for automatic updates from GitHub.
