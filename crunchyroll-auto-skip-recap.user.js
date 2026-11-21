// ==UserScript==
// @name         Crunchyroll Auto Skip Recap
// @namespace    https://github.com/sudouser777
// @version      1.0
// @description  Auto-skips recaps & openings on Crunchyroll. Title-matching tuned for One Piece, with Crunchyroll skip-data + AniSkip fallbacks for other series. Skips credits and auto-plays the next episode. Seeks via the player's own API for instant, stall-free jumps. Hotkeys: S = mark content start, U = undo.
// @author       sudouser777
// @license      MIT
// @icon         https://www.google.com/s2/favicons?sz=64&domain=crunchyroll.com
// @match        https://www.crunchyroll.com/*
// @run-at       document-start
// @grant        none
// @homepageURL  https://github.com/sudouser777/crunchyroll-auto-skip-shortcuts
// @supportURL   https://github.com/sudouser777/crunchyroll-auto-skip-shortcuts/issues
// @downloadURL  https://raw.githubusercontent.com/sudouser777/crunchyroll-auto-skip-shortcuts/main/crunchyroll-auto-skip-recap.user.js
// @updateURL    https://raw.githubusercontent.com/sudouser777/crunchyroll-auto-skip-shortcuts/main/crunchyroll-auto-skip-recap.user.js
// ==/UserScript==

(function () {
    'use strict';

    // Set these to true only when troubleshooting (verbose logs / seek timeline).
    const DEBUG = false;
    const TRACE_SEEK = false;
    const ENABLE_ANISKIP = true;   // community fallback; see seasonal-show note below

    const log = (...a) => { if (DEBUG) console.log('[CR Skip Recap]', ...a); };
    const tlog = (...a) => { if (TRACE_SEEK) console.log('[CR Skip Trace]', ...a); };

    const TITLE_SEARCH_WINDOW_S = 8 * 60;
    const MATCH_THRESHOLD = 0.75;
    const MIN_SEEK_GAP_S = 4;
    const SEEK_OP_TIMEOUT_MS = 25000;
    const MAX_SEEK_RETRIES = 2;
    const SEEK_RETRY_SPACING_MS = 3000;
    const FETCH_RETRY_MS = 2000;
    const FALLBACK_GRACE_MS = 8000;
    const NO_MATCH_TICKS_BEFORE_FALLBACK = 6;
    const MAX_MANIFEST_CACHE = 5;

    const CREDITS_SKIP_SELECTORS = [
        'button[aria-label="Skip Credits"]',
        '[data-testid="skipCreditsText"]',
        '[data-testid="skip-credits"]',
        '[data-testid="skipCreditsButton"]'
    ];
    const NEXT_EPISODE_SELECTORS = [
        'button[data-testid="next-episode-button"]',
        'a[data-testid="next-episode-button"]',
        '[data-testid="next-episode-button"]',
        '[data-testid="next-episode"] a',
        '[data-t="next-episode"] a'
    ];
    const NEXT_EPISODE_WINDOW_MS = 60000;
    const NEXT_EPISODE_COOLDOWN_MS = 5000;

    // ---------------------------------------------------------------------
    // URL helpers
    // ---------------------------------------------------------------------
    function shortUrl(url) { try { const p = new URL(url); return p.origin + p.pathname; } catch (e) { return String(url); } }
    function absoluteUrl(value, base = location.href) {
        if (typeof value !== 'string' || !value) return null;
        try { return new URL(value, base).href; } catch (e) { return null; }
    }
    function urlKind(url) {
        if (/\.mpd(?:[?#]|$)/i.test(url)) return 'manifest';
        if (/\.vtt(?:[?#]|$)/i.test(url)) return 'caption';
        if (/static\.crunchyroll\.com\/skip-events\/production\//i.test(url)) return 'skipevents';
        return null;
    }
    // The manifest URL embeds the episode id — trust it over the page URL so a
    // stale request from the previous episode can't be misattributed.
    function episodeIdFromManifestUrl(url) { const m = String(url).match(/\/playback\/v\d+\/manifest\/([^/]+)\//i); return m ? m[1] : null; }
    function assetKey(url) { const m = String(url).match(/\/static\/majin\/([^/]+)\//i); return m ? m[1] : null; }
    function skipEventsUrl(id) { return `https://static.crunchyroll.com/skip-events/production/${encodeURIComponent(id)}.json`; }

    // ---------------------------------------------------------------------
    // Capture the player's manifest / caption / skip-event traffic
    // ---------------------------------------------------------------------
    const episodeManifests = new Map();
    const capturedText = new Map();
    let captureVersion = 0;
    let latestCaptionUrl = null;

    function rememberUrl(rawUrl) {
        const url = absoluteUrl(rawUrl);
        if (!url) return;
        const kind = urlKind(url);
        if (kind === 'manifest') {
            const epId = episodeIdFromManifestUrl(url) || getEpisodeId();
            episodeManifests.set(epId, url);
            if (episodeManifests.size > MAX_MANIFEST_CACHE) episodeManifests.delete(episodeManifests.keys().next().value);
        } else if (kind === 'caption') {
            if (latestCaptionUrl !== url) log('caption url:', shortUrl(url));
            latestCaptionUrl = url;
        }
    }
    function rememberText(url, text) {
        if (!url || !text) return;
        if (capturedText.has(url)) capturedText.delete(url);
        capturedText.set(url, text);
        captureVersion++;
        if (capturedText.size > 10) capturedText.delete(capturedText.keys().next().value);
    }

    // Keep a native reference so our own requests bypass the hook.
    const nativeFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
    if (nativeFetch) {
        window.fetch = function (input) {
            let url = null;
            try { url = absoluteUrl(typeof input === 'string' ? input : input && input.url); if (url) rememberUrl(url); } catch (e) {}
            const result = nativeFetch.apply(this, arguments);
            try {
                if (url && urlKind(url) && result && typeof result.then === 'function') {
                    result.then((response) => {
                        try {
                            if (!response || !response.ok) return;
                            response.clone().text().then((text) => {
                                if (!text) return;
                                rememberText(url, text);
                                log('captured', urlKind(url), 'body:', shortUrl(url), text.length, 'chars');
                            }).catch(() => {});
                        } catch (e) {}
                    }).catch(() => {});
                }
            } catch (e) {}
            return result;
        };
    }
    const originalXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
        try { this.__crSkipUrl = absoluteUrl(url); if (this.__crSkipUrl) rememberUrl(this.__crSkipUrl); } catch (e) {}
        return originalXhrOpen.apply(this, arguments);
    };
    const originalXhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function () {
        try {
            const url = this.__crSkipUrl;
            if (url && urlKind(url)) {
                this.addEventListener('load', () => {
                    try {
                        if (this.status < 200 || this.status >= 300) return;
                        let text = null;
                        if (this.responseType === '' || this.responseType === 'text') text = this.responseText;
                        else if (this.responseType === 'arraybuffer' && this.response) text = new TextDecoder('utf-8').decode(new Uint8Array(this.response));
                        if (!text) return;
                        rememberText(url, text);
                        log('captured', urlKind(url), 'body:', shortUrl(url), text.length, 'chars');
                    } catch (e) {}
                });
            }
        } catch (e) {}
        return originalXhrSend.apply(this, arguments);
    };
    function scanResourceTiming() {
        try { for (const e of performance.getEntriesByType('resource')) rememberUrl(e.name); } catch (e) {}
        try { for (const t of document.querySelectorAll('track[src]')) rememberUrl(t.getAttribute('src')); } catch (e) {}
    }

    // ---------------------------------------------------------------------
    // Page / player helpers
    // ---------------------------------------------------------------------
    function getEpisodeId() { const m = location.pathname.match(/^(?:\/[a-z]{2}(?:-[A-Z]{2})?)?\/watch\/([^/]+)/i); return m ? m[1] : location.href; }
    function getVideo() {
        return document.querySelector('#player-container video')
            || document.querySelector('.bitmovinplayer-container video')
            || document.querySelector('video');
    }
    function titleElement() {
        return document.querySelector('.current-media-header h1.title')
            || document.querySelector('h1.title')
            || document.querySelector('[class*="current-media-header"] h1');
    }
    function getEpisodeTitle() { const el = titleElement(); if (!el) return ''; return el.textContent.replace(/^E\d+\s*[-–—:]\s*/i, '').replace(/\s+/g, ' ').trim(); }
    function getEpisodeNumber() { const el = titleElement(); if (!el) return null; const m = el.textContent.match(/\bE(\d+)\b/i); return m ? parseInt(m[1], 10) : null; }
    function getSeriesTitle() {
        const el = document.querySelector('.current-media-header a[href*="/series/"]')
            || document.querySelector('[class*="current-media-header"] a[href*="/series/"]')
            || document.querySelector('a[href*="/series/"]');
        return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
    }
    function seekableEnd(video) { try { const s = video.seekable; return s.length ? s.end(s.length - 1) : 0; } catch (e) { return 0; } }
    function playerReady(video, target) {
        if (video.readyState < 3 || video.seeking) return false;
        if (seekableEnd(video) < target - 1) return false;
        return true;
    }

    // ---------------------------------------------------------------------
    // Bitmovin instance discovery.
    // The instance lives in the React fiber tree around the <video>, not on a
    // window global. Walk nearby objects and verify via getVideoElement()===video.
    // Approach inspired by Crunchyroll Video Playback Quality Controller (mahi1972, MIT).
    // ---------------------------------------------------------------------
    let bmPlayer = null;
    let bmScanCooldown = 0;
    function isObj(o) { return o !== null && (typeof o === 'object' || typeof o === 'function'); }
    function ownVal(o, k) { try { const d = Object.getOwnPropertyDescriptor(o, k); return d && 'value' in d ? d.value : null; } catch (e) { return null; } }
    function looksLikeBitmovin(p, video) {
        try {
            return isObj(p) && typeof p.seek === 'function'
                && typeof p.getVideoElement === 'function' && p.getVideoElement() === video;
        } catch (e) { return false; }
    }
    function findBitmovin(video, force) {
        if (bmPlayer && looksLikeBitmovin(bmPlayer, video)) return bmPlayer;
        bmPlayer = null;
        const now = performance.now();
        if (!force && now < bmScanCooldown) return null;
        bmScanCooldown = now + 1500;

        const seen = new WeakSet();
        const queue = [];
        const push = (o, depth) => {
            if (!isObj(o) || o === window || o === document || seen.has(o) || depth > 18 || queue.length > 12000) return;
            seen.add(o); queue.push({ o, depth });
        };
        const addElement = (el) => {
            if (!el) return;
            let names = []; try { names = Object.getOwnPropertyNames(el); } catch (e) {}
            for (const k of names) {
                if (/^__react(Fiber|Props|InternalInstance|Container)/.test(k) || /^(player|_player|playerInstance|engine|ui)$/.test(k)) {
                    push(ownVal(el, k), 0);
                }
            }
        };
        let el = video;
        for (let i = 0; el && i < 14; i++, el = el.parentElement) addElement(el);
        for (const r of document.querySelectorAll('.katamariDesktop, .player-container, #vilosRoot, #vilos-root, #player-container')) addElement(r);
        for (const k of ['player', 'bitmovinPlayer', 'katamariPlayer', 'vilos', 'shakaPlayer']) push(ownVal(window, k), 0);

        const priority = new Set(['current','ref','refs','player','_player','mediaEngine','_mediaEngine','_katamariPlayer','playerOrchestrator','playerActionsOrchestrator','memoizedProps','memoizedState','stateNode','child','return','next','value']);
        const skip = new Set(['alternate','_debugOwner','_debugInfo','_owner','ownerDocument','parentNode','parentElement','children','childNodes','window','document','location','src','currentSrc','manifest','manifest_','config','config_','configuration','networkingEngine_','drmEngine_','session','token','headers','request']);
        let head = 0, nodes = 0;
        const t0 = performance.now();
        while (head < queue.length && nodes < 6000 && performance.now() - t0 < 120) {
            const { o, depth } = queue[head++];
            nodes++;
            if (looksLikeBitmovin(o, video)) { bmPlayer = o; log('found Bitmovin player instance'); return bmPlayer; }
            if (o instanceof Node) { addElement(o); continue; }
            if (ArrayBuffer.isView(o) || o instanceof ArrayBuffer) continue;
            let keys = []; try { keys = Object.getOwnPropertyNames(o); } catch (e) {}
            keys.sort((a, b) => Number(priority.has(b)) - Number(priority.has(a)));
            for (const k of keys.slice(0, 100)) {
                if (skip.has(k)) continue;
                push(ownVal(o, k), depth + 1);
            }
        }
        return null;
    }

    // ---------------------------------------------------------------------
    // Seek timeline recorder (only active when TRACE_SEEK is true)
    // ---------------------------------------------------------------------
    let trace = null;
    const tracedVideos = new WeakSet();
    function bufferAheadStr(video) {
        try {
            const b = video.buffered, ct = video.currentTime;
            for (let i = 0; i < b.length; i++) if (b.start(i) <= ct && ct <= b.end(i)) return (b.end(i) - ct).toFixed(1);
            return 'none';
        } catch (e) { return '?'; }
    }
    function ensureTrace(video) {
        if (!TRACE_SEEK || tracedVideos.has(video)) return;
        tracedVideos.add(video);
        const evs = ['loadstart','loadeddata','canplay','canplaythrough','play','playing','pause','waiting','seeking','seeked','stalled','emptied','error','ratechange'];
        for (const ev of evs) video.addEventListener(ev, () => traceEvent(video, ev));
    }
    function traceBegin(video, target) {
        if (!TRACE_SEEK) return;
        traceEnd('superseded');
        trace = { t0: performance.now(), target, entries: [], video, timer: null };
        traceEvent(video, 'SKIP-ISSUED');
        trace.timer = setInterval(() => {
            if (!trace) return;
            traceEvent(video, 'sample');
            if (performance.now() - trace.t0 > 60000) traceEnd('60s-timeout');
        }, 1000);
    }
    function traceEvent(video, ev) {
        if (!trace || video !== trace.video) return;
        try {
            const entry = {
                t: +((performance.now() - trace.t0) / 1000).toFixed(2), ev,
                ct: +video.currentTime.toFixed(2), rs: video.readyState, ns: video.networkState,
                seeking: video.seeking, paused: video.paused, bufAhead: bufferAheadStr(video), seekEnd: +seekableEnd(video).toFixed(1)
            };
            trace.entries.push(entry);
            tlog(entry.t + 's', ev, 'ct=' + entry.ct, 'rs=' + entry.rs, 'seeking=' + entry.seeking, 'paused=' + entry.paused, 'buf=' + entry.bufAhead);
            if (ev === 'playing') traceEnd('playing');
        } catch (e) {}
    }
    function traceEnd(reason) {
        if (!trace) return;
        clearInterval(trace.timer);
        const entries = trace.entries;
        const find = (ev) => entries.find((e) => e.ev === ev);
        const seeked = find('seeked'), canplay = find('canplay'), playing = find('playing');
        console.info('[CR Skip Trace] target=' + trace.target.toFixed(1) + 's | end=' + reason +
            ' | seeked@' + (seeked ? seeked.t + 's' : '—') +
            ' | canplay@' + (canplay ? canplay.t + 's' : '—') +
            ' | playing@' + (playing ? playing.t + 's' : '—'));
        try { console.table(entries); } catch (e) {}
        window.__crSkipLastTrace = entries;
        trace = null;
    }
    if (TRACE_SEEK) window.__crSkipTrace = () => { try { console.table(window.__crSkipLastTrace || []); } catch (e) {} };

    // ---------------------------------------------------------------------
    // Text fetching
    // ---------------------------------------------------------------------
    function isSameOrigin(url) { try { return new URL(url).origin === location.origin; } catch (e) { return false; } }
    function cachedTextFor(url) {
        if (capturedText.has(url)) return capturedText.get(url);
        let key; try { const p = new URL(url); key = p.origin + p.pathname; } catch (e) { return null; }
        for (const [capturedUrl, text] of capturedText) { try { const p = new URL(capturedUrl); if (p.origin + p.pathname === key) return text; } catch (e) {} }
        return null;
    }
    async function fetchText(url) {
        const captured = cachedTextFor(url);
        if (captured) { log('using captured body for', shortUrl(url)); return captured; }
        if (!nativeFetch) return null;
        try {
            const response = await nativeFetch(url, { credentials: isSameOrigin(url) ? 'include' : 'omit' });
            if (!response.ok) { log('request failed', shortUrl(url), 'HTTP', response.status); return null; }
            const text = await response.text();
            rememberText(url, text);
            return text;
        } catch (error) { log('request failed', shortUrl(url), (error && error.message) || error); return null; }
    }
    async function plainFetchText(url, opts) {
        if (!nativeFetch) return null;
        try { const r = await nativeFetch(url, opts || { credentials: 'omit' }); if (!r.ok) return null; return await r.text(); } catch (e) { return null; }
    }

    // ---------------------------------------------------------------------
    // Caption loading
    // ---------------------------------------------------------------------
    function preferredLanguages() {
        const langs = [];
        const dl = (document.documentElement.lang || '').toLowerCase(); if (dl) langs.push(dl);
        const nl = (navigator.language || '').toLowerCase(); if (nl && !langs.includes(nl)) langs.push(nl);
        if (!langs.some((l) => l.startsWith('en'))) langs.push('en');
        return langs;
    }
    async function captionUrlsFromManifest(manifestUrl) {
        const xml = await fetchText(manifestUrl);
        if (!xml) return [];
        let doc; try { doc = new DOMParser().parseFromString(xml, 'application/xml'); } catch (e) { return []; }
        const prefs = preferredLanguages();
        const rank = (language) => { for (let i = 0; i < prefs.length; i++) { const p = prefs[i]; if (language === p || language.startsWith(p + '-') || p.startsWith(language + '-')) return i; } return prefs.length; };
        const tracks = [];
        for (const set of Array.from(doc.getElementsByTagNameNS('*', 'AdaptationSet'))) {
            const mimeType = (set.getAttribute('mimeType') || '').toLowerCase();
            const contentType = (set.getAttribute('contentType') || '').toLowerCase();
            if (!mimeType.includes('vtt') && !(contentType === 'text' && mimeType.includes('text'))) continue;
            const baseUrl = set.getElementsByTagNameNS('*', 'BaseURL')[0];
            if (!baseUrl) continue;
            const url = absoluteUrl(baseUrl.textContent.trim(), manifestUrl);
            if (!url) continue;
            const lang = (set.getAttribute('lang') || set.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'lang') || '').toLowerCase();
            tracks.push({ language: lang, url });
        }
        tracks.sort((a, b) => rank(a.language) - rank(b.language));
        log('caption tracks in manifest:', tracks.length, tracks.map((t) => t.language || '?'));
        return tracks.map((t) => t.url);
    }
    function parseTimestamp(value) {
        const parts = value.trim().replace(',', '.').split(':').map(Number);
        if (parts.some((p) => !Number.isFinite(p))) return NaN;
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        return NaN;
    }
    function parseVtt(text) {
        const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
        const timing = /^((?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{2,3})\s*-->\s*((?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{2,3})/;
        const cues = [];
        let i = 0;
        while (i < lines.length) {
            const match = timing.exec(lines[i]);
            if (!match) { i++; continue; }
            const start = parseTimestamp(match[1]); const end = parseTimestamp(match[2]); i++;
            const textLines = [];
            while (i < lines.length && lines[i].trim() !== '' && !timing.test(lines[i])) { textLines.push(lines[i]); i++; }
            const cueText = textLines.join(' ').replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '')
                .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
            if (Number.isFinite(start) && Number.isFinite(end) && cueText) cues.push({ start, end, text: cueText });
        }
        return cues;
    }
    function cuesFromTextTracks() {
        const video = getVideo();
        if (!video || !video.textTracks) return null;
        for (const track of Array.from(video.textTracks)) {
            if (track.kind !== 'subtitles' && track.kind !== 'captions') continue;
            if (!track.cues || !track.cues.length) continue;
            const cues = [];
            for (const cue of Array.from(track.cues)) {
                const text = String(cue.text || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
                if (text) cues.push({ start: cue.startTime, end: cue.endTime, text });
            }
            if (cues.length) return cues;
        }
        return null;
    }
    async function loadCueLists(manifestUrl) {
        scanResourceTiming();
        const urls = [];
        const seenKeys = new Set();
        const addUrl = (u) => {
            if (!u) return;
            // The same caption file is served under /cenc/dash/ and a plain path;
            // normalize so we don't fetch and parse it twice.
            const key = u.replace(/\/cenc\/dash\//i, '/');
            if (seenKeys.has(key)) return;
            seenKeys.add(key);
            urls.push(u);
        };
        if (manifestUrl) { for (const u of await captionUrlsFromManifest(manifestUrl)) addUrl(u); }
        if (latestCaptionUrl) {
            const sameAsset = !manifestUrl || assetKey(latestCaptionUrl) === assetKey(manifestUrl);
            if (sameAsset) addUrl(latestCaptionUrl);
        }
        const lists = [];
        for (const url of urls.slice(0, 4)) {
            const text = await fetchText(url);
            if (!text) continue;
            const cues = parseVtt(text);
            log('caption file', shortUrl(url), 'cues:', cues.length);
            if (cues.length) lists.push(cues);
        }
        const trackCues = cuesFromTextTracks();
        if (trackCues) lists.push(trackCues);
        return lists;
    }

    // ---------------------------------------------------------------------
    // Title matching
    // ---------------------------------------------------------------------
    const STOP_WORDS = new Set(['a','an','the','of','to','and','in','on','at','for','with','his','her','their','its','is','are','be','vs','versus']);
    function normalizeText(value) {
        return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/['’`]/g, '').replace(/[^a-z0-9]+/gi, ' ').toLowerCase().trim();
    }
    function words(n) { return n.split(' ').filter(Boolean); }
    function matchScore(title, cueText) {
        const titleNorm = normalizeText(title); const cueNorm = normalizeText(cueText);
        // Non-Latin titles: exact substring on whitespace-stripped raw strings.
        if (!titleNorm && title.length > 0) {
            const rawTitle = title.replace(/\s+/g, '').toLowerCase(); const rawCue = cueText.replace(/\s+/g, '').toLowerCase();
            return rawCue.includes(rawTitle) ? 1 : 0;
        }
        if (!titleNorm || !cueNorm) return 0;
        const haystack = ' ' + cueNorm + ' '; const needle = ' ' + titleNorm + ' ';
        const nonStopWords = words(titleNorm).filter((w) => !STOP_WORDS.has(w));
        // Gate short titles so 1-word titles can't match random dialogue.
        if (nonStopWords.length >= 2 && haystack.includes(needle)) return 1;
        if (nonStopWords.length < 3) return 0;
        const cueWords = new Set(words(cueNorm));
        let hits = 0; for (const w of nonStopWords) if (cueWords.has(w)) hits++;
        return hits / nonStopWords.length;
    }
    function findTitleCue(cues, title) {
        let best = null;
        for (let i = 0; i < cues.length; i++) {
            const cue = cues[i];
            if (cue.start > TITLE_SEARCH_WINDOW_S) break;
            let combinedText = cue.text, combinedEnd = cue.end, chained = 0;
            for (let j = i + 1; j < cues.length && chained < 5; j++) {
                const next = cues[j];
                if (next.start > combinedEnd + 3.0) break;
                combinedText += ' ' + next.text; combinedEnd = next.end; chained++;
            }
            for (const variant of [{ text: cue.text, end: cue.end }, { text: combinedText, end: combinedEnd }]) {
                const score = matchScore(title, variant.text);
                if (score < MATCH_THRESHOLD) continue;
                if (!best || score > best.score || (score === best.score && cue.start < best.start)) best = { start: cue.start, end: variant.end, score, text: variant.text };
            }
        }
        return best;
    }

    // ---------------------------------------------------------------------
    // Fallback 1: Crunchyroll's own skip-events JSON
    // ---------------------------------------------------------------------
    function parseSkipEvents(raw) {
        const segs = [];
        if (!raw || typeof raw !== 'object') return segs;
        for (const type of ['recap', 'intro', 'credits', 'preview']) {
            const e = raw[type];
            if (!e || typeof e !== 'object') continue;
            if (!Number.isFinite(e.start) || !Number.isFinite(e.end) || e.end <= e.start) continue;
            segs.push({ type, start: e.start, end: e.end });
        }
        return segs.sort((a, b) => a.start - b.start);
    }
    async function loadSkipEvents(episodeId) {
        const text = await fetchText(skipEventsUrl(episodeId));
        if (!text) return [];
        try { return parseSkipEvents(JSON.parse(text)); } catch (e) { return []; }
    }
    function skipEventsTarget(segs, duration) {
        if (!segs || !segs.length) return null;
        const win = TITLE_SEARCH_WINDOW_S;
        const recap = segs.find((s) => s.type === 'recap' && s.start < win && s.end < duration * 0.5);
        const intro = segs.find((s) => s.type === 'intro' && s.start < win && s.end < duration * 0.5);
        if (recap && intro && intro.start >= recap.start && intro.start - recap.end < 120) return intro.end;
        if (intro) return intro.end;
        if (recap) return recap.end;
        return null;
    }

    // ---------------------------------------------------------------------
    // Fallback 2: AniSkip (community). Seasonal shows may map to the wrong MAL
    // entry; pin the right one via localStorage 'crskip-mal-override:<series>' = <malId>,
    // or set ENABLE_ANISKIP = false.
    // ---------------------------------------------------------------------
    async function resolveMalId(seriesTitle) {
        const norm = seriesTitle.toLowerCase().trim();
        const override = localStorage.getItem('crskip-mal-override:' + norm);
        if (override) return parseInt(override, 10) || null;
        const key = 'crskip-mal:' + norm;
        const cached = localStorage.getItem(key);
        if (cached) return cached === '0' ? null : parseInt(cached, 10);
        const text = await plainFetchText('https://graphql.anilist.co', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, credentials: 'omit',
            body: JSON.stringify({ query: 'query($s:String){Media(search:$s,type:ANIME,sort:SEARCH_MATCH){idMal}}', variables: { s: seriesTitle } })
        });
        let id = null; try { id = (JSON.parse(text).data || {}).Media?.idMal || null; } catch (e) {}
        try { localStorage.setItem(key, id ? String(id) : '0'); } catch (e) {}
        return id;
    }
    async function loadAniSkipTarget(seriesTitle, episodeNumber, duration) {
        if (!seriesTitle || !episodeNumber) return null;
        const malId = await resolveMalId(seriesTitle);
        if (!malId) return null;
        const url = `https://api.aniskip.com/v2/skip-times/${malId}/${episodeNumber}?types[]=op&types[]=mixed-op&types[]=recap&episodeLength=0`;
        const text = await plainFetchText(url);
        if (!text) return null;
        let data; try { data = JSON.parse(text); } catch (e) { return null; }
        if (!data.found || !Array.isArray(data.results)) return null;
        let best = null;
        for (const r of data.results) {
            if (!r.interval) continue;
            // Soft length check: CR trims tails, so allow a generous window.
            if (Math.abs((r.episodeLength || duration) - duration) > 90) continue;
            const { startTime, endTime } = r.interval;
            if (!(startTime < TITLE_SEARCH_WINDOW_S) || !(endTime < duration * 0.5) || endTime <= startTime) continue;
            if (best === null || endTime > best) best = endTime;
        }
        return best;
    }

    // ---------------------------------------------------------------------
    // Per-episode state + seeking (through the Bitmovin API when available)
    // ---------------------------------------------------------------------
    function createState(episodeId) {
        return {
            episodeId, cueLists: null, loadedManifestUrl: null, loadedCaptionUrl: null,
            nextFetchAt: 0, fetching: false, lastAttemptVersion: -1,
            done: false, seekOp: null,
            noCueLogged: false, loggedTitle: false, loggedNoMatch: false, loggedNonLatin: false,
            noMatchTicks: 0, startedAt: 0,
            skipEvents: null, skipEventsTried: false, aniSkipTarget: null, aniSkipTried: false
        };
    }
    let state = createState(null);
    let lastUndo = null;

    function applySeek(video, target) {
        if (state.seekOp) state.seekOp.lastApplyAt = performance.now();
        const p = findBitmovin(video, true);
        if (p && typeof p.seek === 'function') {
            try { p.seek(target); log('seek via Bitmovin API to', target.toFixed(2)); return; }
            catch (e) { log('Bitmovin seek failed, falling back to currentTime', e); }
        }
        log('Bitmovin instance not found; using currentTime');
        try { video.currentTime = target; } catch (e) {}
    }
    function startSeek(video, target) {
        const now = performance.now();
        const wasPlaying = !video.paused && !video.ended;
        lastUndo = { episodeId: state.episodeId, from: video.currentTime, to: target, wasPlaying };
        ensureTrace(video);
        traceBegin(video, target);
        state.seekOp = { target, wasPlaying, issuedAt: now, lastApplyAt: now, lastResumeAt: 0, attempts: 1, finished: false };
        applySeek(video, target);
        log('seek to', target.toFixed(2), 's');
        showToast('Skipped ahead — press U to undo');
    }
    function serviceSeekOp(video) {
        const op = state.seekOp;
        if (!op || op.finished) return;
        const now = performance.now();
        const target = op.target;
        const finish = (reason) => { op.finished = true; state.seekOp = null; state.done = true; log('seek op finished:', reason, 'at', video.currentTime.toFixed(2)); };
        if (!video.isConnected) { finish('video gone'); return; }
        if (video.currentTime > target + 15) { finish('moved past target'); return; }
        const landed = video.currentTime >= target - 1;
        if (landed && !video.seeking) {
            if (!video.paused) { finish('playing at target'); return; }
            if (!op.wasPlaying) { finish('landed (was paused)'); return; }
            if (video.readyState >= 3 && now - op.lastResumeAt > 1000) { op.lastResumeAt = now; const p = video.play(); if (p && p.catch) p.catch(() => {}); }
            return;
        }
        if (!video.seeking && video.currentTime < target - Math.max(MIN_SEEK_GAP_S, 8)) {
            if (op.attempts < 1 + MAX_SEEK_RETRIES && now - op.lastApplyAt > SEEK_RETRY_SPACING_MS && video.readyState >= 3) {
                op.attempts++; log('snap-back, re-seeking (apply #' + op.attempts + ')'); applySeek(video, target);
            } else if (op.attempts >= 1 + MAX_SEEK_RETRIES) { finish('gave up after snap-backs'); }
            return;
        }
        if (now - op.issuedAt > SEEK_OP_TIMEOUT_MS) {
            if (op.wasPlaying && video.paused) { const p = video.play(); if (p && p.catch) p.catch(() => {}); }
            finish('timeout');
        }
    }
    function cueSourcesChanged(currentManifestUrl) {
        if (currentManifestUrl && currentManifestUrl !== state.loadedManifestUrl) return true;
        if (!state.loadedManifestUrl && latestCaptionUrl && latestCaptionUrl !== state.loadedCaptionUrl) return true;
        return false;
    }
    function readMark(episodeId) { try { const v = parseFloat(localStorage.getItem('crskip-mark:' + episodeId)); return Number.isFinite(v) && v > 0 ? v : null; } catch (e) { return null; } }

    async function tick() {
        const episodeId = getEpisodeId();
        if (episodeId !== state.episodeId) { state = createState(episodeId); latestCaptionUrl = null; bmPlayer = null; log('episode changed to', episodeId); }
        if (state.done) return;
        const video = getVideo();
        if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
        if (!document.hidden) findBitmovin(video, false);   // pre-warm the instance cache
        if (state.seekOp) { serviceSeekOp(video); return; }
        if (video.currentTime <= 1 || video.seeking) return;
        if (!state.startedAt) state.startedAt = performance.now();

        // Highest priority: a user-saved mark for this episode.
        const mark = readMark(episodeId);
        if (mark !== null && mark > video.currentTime + MIN_SEEK_GAP_S && mark <= TITLE_SEARCH_WINDOW_S && mark < video.duration * 0.5) {
            if (playerReady(video, mark)) { log('applying saved mark', mark.toFixed(2)); startSeek(video, mark); }
            return;
        }

        const currentManifestUrl = episodeManifests.get(episodeId) || null;
        const needsCaptionReload = state.cueLists && cueSourcesChanged(currentManifestUrl);
        const needsCaptionLoad = !state.cueLists || needsCaptionReload;
        const now = performance.now();
        const captionThrottled = needsCaptionLoad && now < state.nextFetchAt && captureVersion === state.lastAttemptVersion;
        const doCaptionLoad = needsCaptionLoad && !captionThrottled;
        const needsSkipEvents = !state.skipEventsTried;
        const needsAniSkip = ENABLE_ANISKIP && !state.aniSkipTried && !!getSeriesTitle() && !!getEpisodeNumber();

        if ((doCaptionLoad || needsSkipEvents || needsAniSkip) && !state.fetching) {
            state.fetching = true;
            state.lastAttemptVersion = captureVersion;
            if (needsCaptionReload) state.cueLists = null;
            try {
                const [se, lists, ani] = await Promise.all([
                    needsSkipEvents ? loadSkipEvents(episodeId) : Promise.resolve(state.skipEvents),
                    doCaptionLoad ? loadCueLists(currentManifestUrl) : Promise.resolve(null),
                    needsAniSkip ? loadAniSkipTarget(getSeriesTitle(), getEpisodeNumber(), video.duration) : Promise.resolve(state.aniSkipTarget)
                ]);
                if (getEpisodeId() !== episodeId) return;
                if (needsSkipEvents) { state.skipEvents = se; state.skipEventsTried = true; }
                if (needsAniSkip) { state.aniSkipTarget = ani; state.aniSkipTried = true; }
                if (doCaptionLoad) {
                    if (currentManifestUrl && episodeManifests.get(episodeId) !== currentManifestUrl) {
                        state.nextFetchAt = 0;
                    } else if (lists && lists.length) {
                        state.cueLists = lists; state.loadedManifestUrl = currentManifestUrl; state.loadedCaptionUrl = latestCaptionUrl;
                        state.noMatchTicks = 0; state.loggedNoMatch = false;
                        log('loaded caption cues:', lists.reduce((t, c) => t + c.length, 0));
                    } else {
                        state.nextFetchAt = performance.now() + FETCH_RETRY_MS;
                        if (!state.noCueLogged) { state.noCueLogged = true; log('no captions yet. manifest:', !!currentManifestUrl, 'caption:', !!latestCaptionUrl, 'bodies:', capturedText.size); }
                    }
                }
            } finally { state.fetching = false; }
            return;
        }

        // Primary signal: the episode title in the captions.
        const title = getEpisodeTitle();
        if (state.cueLists && title) {
            if (!state.loggedTitle) { state.loggedTitle = true; log('page title:', title); }
            if (!normalizeText(title) && !state.loggedNonLatin) { state.loggedNonLatin = true; log('title normalized empty (non-Latin?); using raw substring fallback'); }
            let best = null;
            for (const cues of state.cueLists) {
                const m = findTitleCue(cues, title);
                if (!m) continue;
                if (!best || m.score > best.score || (m.score === best.score && m.start < best.start)) best = m;
            }
            if (best) {
                const target = Math.max(0, best.start);
                if (video.currentTime >= target - MIN_SEEK_GAP_S) { state.done = true; log('already at title cue'); return; }
                log('title cue at', best.start.toFixed(2), '-', best.end.toFixed(2), 'score', best.score.toFixed(2));
                if (playerReady(video, target)) startSeek(video, target);
                return;
            }
            state.noMatchTicks++;
            if (!state.loggedNoMatch) { state.loggedNoMatch = true; log('no cue matched title. cue count:', state.cueLists.reduce((s, c) => s + c.length, 0)); }
        }

        // Fallback chain once the title matcher has had a fair chance.
        const graceDone = (performance.now() - state.startedAt) > FALLBACK_GRACE_MS;
        const sourcesSettled = state.skipEventsTried && (!ENABLE_ANISKIP || state.aniSkipTried || graceDone);
        const captionSettled = state.cueLists ? state.noMatchTicks >= NO_MATCH_TICKS_BEFORE_FALLBACK : graceDone;
        if (sourcesSettled && (captionSettled || graceDone)) {
            const candidates = [skipEventsTarget(state.skipEvents, video.duration), state.aniSkipTarget];
            let target = null;
            for (const t of candidates) {
                if (t === null || t === undefined) continue;
                if (t <= video.currentTime + MIN_SEEK_GAP_S) continue;
                if (t > TITLE_SEARCH_WINDOW_S || t >= video.duration * 0.5) continue;
                if (target === null || t > target) target = t;
            }
            if (target !== null) { log('fallback skip to', target.toFixed(2), 's'); if (playerReady(video, target)) startSeek(video, target); return; }
        }

        if (video.currentTime > TITLE_SEARCH_WINDOW_S) { state.done = true; log('past search window; no skip target found'); }
    }

    // ---------------------------------------------------------------------
    // Toast + hotkeys (S = mark content start, U = undo last skip)
    // ---------------------------------------------------------------------
    let toastEl = null, toastTimer = null;
    function showToast(msg) {
        try {
            if (!toastEl) {
                toastEl = document.createElement('div');
                toastEl.style.cssText = 'position:fixed;left:16px;bottom:84px;z-index:99999;background:rgba(0,0,0,.82);color:#fff;padding:8px 12px;border-radius:6px;font:13px/1.4 sans-serif;pointer-events:none;transition:opacity .3s;max-width:70vw;';
                document.body.appendChild(toastEl);
            }
            toastEl.textContent = '[CR Skip] ' + msg;
            toastEl.style.opacity = '1';
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => { if (toastEl) toastEl.style.opacity = '0'; }, 2600);
        } catch (e) {}
    }
    window.addEventListener('keydown', (e) => {
        if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
        if (!location.pathname.includes('/watch/')) return;
        if (e.target && e.target.closest && e.target.closest('input,textarea,[contenteditable]')) return;
        const video = getVideo();
        if (!video) return;
        if (e.code === 'KeyS') {
            try { localStorage.setItem('crskip-mark:' + getEpisodeId(), String(video.currentTime)); showToast('Marked content start at ' + video.currentTime.toFixed(1) + 's'); } catch (err) {}
        } else if (e.code === 'KeyU') {
            if (lastUndo && lastUndo.episodeId === getEpisodeId()) {
                state.seekOp = null; state.done = true;
                try { video.currentTime = lastUndo.from; } catch (err) {}
                if (lastUndo.wasPlaying) { const p = video.play(); if (p && p.catch) p.catch(() => {}); }
                traceEnd('undo'); showToast('Skip undone'); lastUndo = null;
            }
        }
    });

    // ---------------------------------------------------------------------
    // Skip credits + auto-play the next episode
    // ---------------------------------------------------------------------
    function isClickable(el) {
        if (!el || !el.isConnected || el.disabled) return false;
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0.1 && style.pointerEvents !== 'none';
    }
    function findClickable(selectors) {
        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (!el) continue;
            const target = el.closest('button, a, [role="button"]') || el;
            if (isClickable(target)) return target;
        }
        return null;
    }
    let creditsEpisodeId = null, creditsHandled = false, nextEpisodeClicked = false;
    let nextEpisodeWindowUntil = 0, lastNextEpisodeClickAt = 0;
    function autoAdvanceTick() {
        if (!location.pathname.includes('/watch/')) return;
        const episodeId = getEpisodeId();
        if (episodeId !== creditsEpisodeId) { creditsEpisodeId = episodeId; creditsHandled = false; nextEpisodeClicked = false; nextEpisodeWindowUntil = 0; lastNextEpisodeClickAt = 0; }
        const now = performance.now();
        if (!creditsHandled) {
            const creditsButton = findClickable(CREDITS_SKIP_SELECTORS);
            if (creditsButton) { creditsHandled = true; nextEpisodeWindowUntil = now + NEXT_EPISODE_WINDOW_MS; log('credits detected, skipping them'); creditsButton.click(); }
        }
        if (nextEpisodeClicked) return;
        if (now - lastNextEpisodeClickAt < NEXT_EPISODE_COOLDOWN_MS) return;
        const video = getVideo();
        const ended = !!video && video.ended;
        if (!creditsHandled && !ended) return;
        if (creditsHandled && now > nextEpisodeWindowUntil) return;
        const nextButton = findClickable(NEXT_EPISODE_SELECTORS);
        if (!nextButton) return;
        nextEpisodeClicked = true; lastNextEpisodeClickAt = now;
        log('advancing to the next episode'); nextButton.click();
    }

    setInterval(autoAdvanceTick, 500);
    let ticking = false;
    function safeTick() {
        if (ticking || !location.pathname.includes('/watch/')) return;
        ticking = true;
        tick().catch((e) => log('tick failed', e)).finally(() => { ticking = false; });
    }
    setInterval(safeTick, 500);

    console.info('[CR Skip Recap] v1.0 active');
})();
