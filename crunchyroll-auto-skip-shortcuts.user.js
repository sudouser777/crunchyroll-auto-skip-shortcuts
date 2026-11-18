// ==UserScript==
// @name         Crunchyroll Auto Skip & Enhanced Shortcuts
// @namespace    https://violentmonkey.github.io/
// @version      1.0
// @description  Auto-clicks "Skip Intro"/"Recap"/"Credits" and adds reliable keyboard shortcuts. Fully hardened against React desync and native event hijacking.
// @match        https://www.crunchyroll.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const DEBUG = false;

    const SKIP_SELECTORS = [
        'button[aria-label="Skip Intro"]',
        'button[aria-label="Skip Recap"]',
        'button[aria-label="Skip Credits"]'
    ];

    function isClickable(el) {
        if (!el || el.disabled) return false;
        const s = getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0.1 && s.pointerEvents !== 'none';
    }

    function tryClick() {
        for (const sel of SKIP_SELECTORS) {
            const btn = document.querySelector(sel);
            if (isClickable(btn)) {
                btn.click();
                if (DEBUG) console.log('[CR Auto Skip] Clicked:', btn.getAttribute('aria-label'));
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

    function onKeyDown(e) {
        const tag = e.target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;

        const key = e.key.toLowerCase();
        if ((e.ctrlKey || e.metaKey) && !['arrowleft', 'arrowright'].includes(key)) return;
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
                if (document.pictureInPictureElement) document.exitPictureInPicture();
                else video.requestPictureInPicture().catch(() => {});
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
                else if (e.ctrlKey || e.metaKey) seekAmount = 60;
                seekBy(-seekAmount);
                break;
            }
            case 'arrowright': {
                let seekAmount = 10;
                if (e.shiftKey) seekAmount = 30;
                else if (e.ctrlKey || e.metaKey) seekAmount = 60;
                seekBy(seekAmount);
                break;
            }
            case 'arrowup': {
                const newVol = Math.min(1, video.volume + 0.05);
                video.volume = newVol;
                if (newVol > 0) video.muted = false;
                break;
            }
            case 'arrowdown': {
                const newVol = Math.max(0, video.volume - 0.05);
                video.volume = newVol;
                if (newVol > 0) video.muted = false;
                break;
            }
        }
    }

    function onKeyUp(e) {
        const tag = e.target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;

        const key = e.key.toLowerCase();
        if ((e.ctrlKey || e.metaKey) && !['arrowleft', 'arrowright'].includes(key)) return;
        if (!OWNED_KEYS.has(key)) return;
        if (!getVideo()) return;

        e.preventDefault();
        e.stopImmediatePropagation();
    }

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);

    if (DEBUG) console.log('[CR Auto Skip & Shortcuts v1.0] Script loaded successfully!');
})();
