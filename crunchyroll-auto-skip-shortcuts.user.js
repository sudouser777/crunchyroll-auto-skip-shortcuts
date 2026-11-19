// ==UserScript==
// @name         Crunchyroll Auto Skip & Enhanced Shortcuts
// @namespace    https://github.com/sudouser777
// @version      1.0
// @description  Auto-clicks "Skip Intro"/"Recap"/"Credits" and adds reliable keyboard shortcuts. Fully hardened against React desync and native event hijacking.
// @author       sudouser777
// @license      MIT
// @icon         https://www.google.com/s2/favicons?sz=64&domain=crunchyroll.com
// @match        https://www.crunchyroll.com/*
// @match        https://static.crunchyroll.com/vilos-v2/web/vilos/*
// @run-at       document-start
// @grant        none
// @homepageURL  https://github.com/sudouser777/crunchyroll-auto-skip-shortcuts
// @supportURL   https://github.com/sudouser777/crunchyroll-auto-skip-shortcuts/issues
// @downloadURL  https://raw.githubusercontent.com/sudouser777/crunchyroll-auto-skip-shortcuts/main/crunchyroll-auto-skip-shortcuts.user.js
// @updateURL    https://raw.githubusercontent.com/sudouser777/crunchyroll-auto-skip-shortcuts/main/crunchyroll-auto-skip-shortcuts.user.js
// ==/UserScript==

(function () {
    'use strict';

    const DEBUG = false;

    // Covers both the aria-labelled buttons and the current Vilos player UI
    // (data-testid is language-independent, so localized skip buttons work too).
    const SKIP_SELECTORS = [
        'button[aria-label="Skip Intro"]',
        'button[aria-label="Skip Recap"]',
        'button[aria-label="Skip Credits"]',
        '[data-testid="skipIntroText"]',
        '[data-testid="skip-intro-icon"]'
    ];

    // Prevents double-firing (e.g. skipping two segments in a row) while React
    // tears the clicked button down.
    const SKIP_COOLDOWN_MS = 1000;
    let lastSkipClickAt = 0;

    function isClickable(el) {
        if (!el || el.disabled) return false;
        const s = getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0.1 && s.pointerEvents !== 'none';
    }

    function tryClick() {
        if (performance.now() - lastSkipClickAt < SKIP_COOLDOWN_MS) return;
        for (const sel of SKIP_SELECTORS) {
            const el = document.querySelector(sel);
            if (!el) continue;
            const target = el.closest('button') || el;
            if (isClickable(target)) {
                target.click();
                lastSkipClickAt = performance.now();
                if (DEBUG) console.log('[CR Auto Skip] Clicked:', target.getAttribute('aria-label') || target.getAttribute('data-testid') || sel);
                return; // one skip per tick
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setInterval(tryClick, 500));
    } else {
        setInterval(tryClick, 500);
    }

    function getVideo() {
        return document.querySelector('.bitmovinplayer-container video, [data-testid="player-container"] video')
            || document.querySelector('video');
    }

    let seekTarget = null;
    let seekAppliedAt = 0;
    let seekLockUntil = 0;
    let seekGuard = null;
    let lastTrackIdx = 0;

    function applySeek(video) {
        seekAppliedAt = performance.now();
        video.currentTime = seekTarget;
    }

    function seekTo(seconds) {
        const v = getVideo();
        if (!v || !Number.isFinite(v.duration)) return;

        seekTarget = Math.max(0, Math.min(v.duration - 0.5, seconds));
        seekLockUntil = performance.now() + 900;
        applySeek(v);

        const slider = document.querySelector('input[aria-label="Video timeline"]');
        if (slider) {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(slider, seekTarget);
            slider.dispatchEvent(new Event('input', { bubbles: true }));
            slider.dispatchEvent(new Event('change', { bubbles: true }));
        }

        clearInterval(seekGuard);
        seekGuard = setInterval(() => {
            const vid = getVideo();
            if (!vid || seekTarget === null || performance.now() > seekLockUntil) {
                clearInterval(seekGuard);
                seekGuard = null;
                seekTarget = null;
                return;
            }
            const drift = vid.paused ? 0 : ((performance.now() - seekAppliedAt) / 1000) * vid.playbackRate;
            if (Math.abs(vid.currentTime - (seekTarget + drift)) > 2 && !vid.seeking) applySeek(vid);
        }, 60);
    }

    function seekBy(delta) {
        const v = getVideo();
        if (!v || !Number.isFinite(v.duration)) return;
        const base = (seekTarget !== null && performance.now() < seekLockUntil) ? seekTarget : v.currentTime;
        seekTo(base + delta);
    }

    const OWNED_KEYS = new Set([
        'arrowleft', 'arrowright', 'arrowup', 'arrowdown',
        'n', 'c', 'f', 'm', 'p', ',', '.', '<', '>',
        'j', 'k', 'l', ' ', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
    ]);

    // Returns true for browser/system combos we must never hijack
    // (Alt+Left / Cmd+Left = Back, Cmd+Right = Forward, Ctrl+L, Ctrl+F, ...).
    function isReservedCombo(e, key) {
        if (e.altKey || e.metaKey) return true;
        if (e.ctrlKey && !['arrowleft', 'arrowright'].includes(key)) return true;
        return false;
    }

    function isTypingTarget(e) {
        const tag = e.target?.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable;
    }

    function onKeyDown(e) {
        if (isTypingTarget(e)) return;

        const key = e.key.toLowerCase();
        if (isReservedCombo(e, key)) return;
        if (!OWNED_KEYS.has(key)) return;

        const video = getVideo();
        if (!video) return;

        e.preventDefault();
        e.stopImmediatePropagation();

        switch (key) {
            case 'n': {
                const nextBtn = document.querySelector('button[data-testid="next-episode-button"]')
                    || document.querySelector('[data-t="next-episode"] a');
                if (nextBtn) nextBtn.click();
                break;
            }
            case 'c': {
                const textTracks = Array.from(video.textTracks).filter(t => t.kind === 'subtitles' || t.kind === 'captions');
                if (textTracks.length > 0) {
                    const active = textTracks.find(t => t.mode === 'showing');
                    if (active) {
                        lastTrackIdx = textTracks.indexOf(active);
                        active.mode = 'hidden';
                    } else {
                        if (textTracks[lastTrackIdx]) textTracks[lastTrackIdx].mode = 'showing';
                        else textTracks[0].mode = 'showing';
                    }
                } else {
                    const trackBtn = document.querySelector('[data-testid="track-selection-button"]');
                    if (trackBtn) trackBtn.click();
                }
                break;
            }
            case 'f': {
                if (document.fullscreenElement) {
                    document.exitFullscreen().catch(() => {});
                } else {
                    const playerContainer = document.querySelector('.bitmovinplayer-container, [class*="player-container"], [data-testid="player-container"]') || document.documentElement;
                    playerContainer.requestFullscreen().catch(() => {});
                }
                break;
            }
            case 'm':
                video.muted = !video.muted;
                break;
            case 'p': {
                if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
                else if (document.pictureInPictureEnabled) video.requestPictureInPicture().catch(() => {});
                break;
            }
            case ' ':
            case 'k':
                if (video.paused) video.play().catch(() => {});
                else video.pause();
                break;
            case 'j':
                seekBy(-10);
                break;
            case 'l':
                seekBy(10);
                break;
            case ',':
            case '<':
                if (video.playbackRate > 0.25) video.playbackRate = Math.round((video.playbackRate - 0.25) * 100) / 100;
                break;
            case '.':
            case '>':
                if (video.playbackRate < 4.0) video.playbackRate = Math.round((video.playbackRate + 0.25) * 100) / 100;
                break;
            case '0': case '1': case '2': case '3': case '4':
            case '5': case '6': case '7': case '8': case '9':
                seekTo(video.duration * (parseInt(key, 10) / 10));
                break;
            case 'arrowleft': {
                let seekAmount = 10;
                if (e.shiftKey) seekAmount = 30;
                else if (e.ctrlKey) seekAmount = 60;
                seekBy(-seekAmount);
                break;
            }
            case 'arrowright': {
                let seekAmount = 10;
                if (e.shiftKey) seekAmount = 30;
                else if (e.ctrlKey) seekAmount = 60;
                seekBy(seekAmount);
                break;
            }
            case 'arrowup': {
                const newVol = Math.min(1, Math.round((video.volume + 0.05) * 100) / 100);
                video.volume = newVol;
                if (newVol > 0) video.muted = false;
                break;
            }
            case 'arrowdown': {
                video.volume = Math.max(0, Math.round((video.volume - 0.05) * 100) / 100);
                break;
            }
        }
    }

    function onKeyUp(e) {
        if (isTypingTarget(e)) return;

        const key = e.key.toLowerCase();
        if (isReservedCombo(e, key)) return;
        if (!OWNED_KEYS.has(key)) return;
        if (!getVideo()) return;

        e.preventDefault();
        e.stopImmediatePropagation();
    }

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);

    if (DEBUG) console.log('[CR Auto Skip & Shortcuts v1.0] Script loaded successfully!');
})();
