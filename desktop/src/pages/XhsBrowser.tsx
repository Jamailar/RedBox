import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Link2, Loader2, Moon, Plus, RefreshCw, Save, Sun, X } from 'lucide-react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WebViewElement = any;

type SaveStatus = 'idle' | 'saving' | 'success' | 'error';

interface NoteDetection {
    isNote: boolean;
    noteType: 'image' | 'video';
    title: string;
}

interface NotePayload {
    noteId: string;
    title: string;
    author: string;
    content: string;
    text: string;
    images: string[];
    coverUrl: string | null;
    videoUrl: string | null;
    stats: {
        likes: number;
        collects: number;
    };
    source: string;
}

interface BrowserTab {
    id: string;
    url: string;
    title: string;
    isLoading: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
    note: NoteDetection | null;
    saveStatus: SaveStatus;
}

interface LayoutSnapshot {
    width: number;
    height: number;
    viewportWidth: number;
    ua: string;
}

interface ElementLayoutSnapshot {
    hostWidth: number;
    hostHeight: number;
    webviewWidth: number;
    webviewHeight: number;
}

interface ManagedWebviewProps {
    tab: BrowserTab;
    onRefChange: (tabId: string, webview: WebViewElement | null) => void;
    onElementLayout: (tabId: string, snapshot: ElementLayoutSnapshot) => void;
    onDidStartLoading: (tabId: string) => void;
    onDidStopLoading: (tabId: string) => void;
    onDidNavigate: (tabId: string, url: string) => void;
    onTitleUpdated: (tabId: string, title: string) => void;
    onOpenInNewTab: (url: string) => void;
    onConsoleMessage: (tabId: string, message: string) => void;
    onDomReady: (tabId: string) => void;
}

const DEFAULT_URL = 'https://www.xiaohongshu.com/';
const NOTES_API = 'http://127.0.0.1:23456/api/notes';
const YOUTUBE_NOTES_API = 'http://127.0.0.1:23456/api/youtube-notes';
const SAVE_TRIGGER_MARKER = '[RC_XHS_SAVE_TRIGGER]';
const CLIPBOARD_POLL_INTERVAL_MS = 1600;
const MIN_XHS_CAPTURE_INTERVAL_MS = 5000;
const XHS_WEBVIEW_PARTITION = 'persist:redbox-xhs-browser';
const XHS_WEB_NIGHT_FILTER_STORAGE_KEY = 'redbox:xhs-web-night-filter:v1';

function getAlignedXhsUserAgent(): string {
    const base = String(navigator.userAgent || '').trim();
    if (!base) {
        return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    }

    // Remove Electron/app tokens to reduce obvious non-browser fingerprints.
    const sanitized = base
        .replace(/\sElectron\/[^\s]+/gi, '')
        .replace(/\sRedBox\/[^\s]+/gi, '')
        .replace(/\sRedConvert\/[^\s]+/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

    if (/Chrome\/\d+/i.test(sanitized) && /Safari\/\d+/i.test(sanitized)) {
        return sanitized;
    }

    return `${sanitized} Chrome/120.0.0.0 Safari/537.36`.trim();
}

interface YouTubeClipboardCandidate {
    videoId: string;
    videoUrl: string;
    rawUrl: string;
}

function parseYouTubeCandidateFromUrl(rawInput: string): YouTubeClipboardCandidate | null {
    const trimmed = String(rawInput || '').trim();
    if (!trimmed) return null;

    const sanitized = trimmed
        .replace(/[)\]}>,.!?，。！？、]+$/g, '')
        .replace(/^<|>$/g, '');

    let parsed: URL;
    try {
        parsed = new URL(sanitized);
    } catch {
        return null;
    }

    const host = parsed.hostname.toLowerCase();
    const isYouTubeHost = host === 'youtu.be'
        || host.endsWith('.youtu.be')
        || host === 'youtube.com'
        || host.endsWith('.youtube.com');
    if (!isYouTubeHost) return null;

    let videoId = '';
    if (host.includes('youtu.be')) {
        videoId = parsed.pathname.split('/').filter(Boolean)[0] || '';
    } else {
        const pathParts = parsed.pathname.split('/').filter(Boolean);
        if (pathParts[0] === 'watch') {
            videoId = parsed.searchParams.get('v') || '';
        } else if (pathParts[0] === 'shorts' || pathParts[0] === 'embed' || pathParts[0] === 'live') {
            videoId = pathParts[1] || '';
        } else if (pathParts[0] === 'clip') {
            videoId = parsed.searchParams.get('v') || '';
        }
    }

    const normalizedVideoId = videoId.trim();
    if (!normalizedVideoId || !/^[a-zA-Z0-9_-]{6,}$/.test(normalizedVideoId)) {
        return null;
    }

    return {
        videoId: normalizedVideoId,
        videoUrl: `https://www.youtube.com/watch?v=${normalizedVideoId}`,
        rawUrl: sanitized,
    };
}

function extractYouTubeCandidateFromClipboard(text: string): YouTubeClipboardCandidate | null {
    const raw = String(text || '').trim();
    if (!raw) return null;

    const direct = parseYouTubeCandidateFromUrl(raw);
    if (direct) return direct;

    const matches = raw.match(/https?:\/\/[^\s"'<>]+/gi) || [];
    for (const item of matches) {
        const candidate = parseYouTubeCandidateFromUrl(item);
        if (candidate) {
            return candidate;
        }
    }
    return null;
}

const XHS_SHARED_SCRIPT = `
function parseCountText(value) {
  if (!value) return 0;
  const text = String(value).trim();
  const cleaned = text.replace(/[\\s,]/g, '').replace(/[^0-9.\\u4e00-\\u9fa5]/g, '');
  if (!cleaned) return 0;
  if (cleaned.includes('亿')) {
    const num = parseFloat(cleaned.replace('亿', ''));
    return Number.isNaN(num) ? 0 : Math.round(num * 100000000);
  }
  if (cleaned.includes('万')) {
    const num = parseFloat(cleaned.replace('万', ''));
    return Number.isNaN(num) ? 0 : Math.round(num * 10000);
  }
  const num = parseFloat(cleaned);
  return Number.isNaN(num) ? 0 : Math.round(num);
}

function getNoteTitle() {
  const explicitTitle = document.querySelector('#detail-title')?.innerText?.trim();
  if (explicitTitle) return explicitTitle;

  const root = getCurrentNoteRoot();
  if (root) {
    const scopedTitle =
      root.querySelector('#detail-title')?.innerText?.trim() ||
      root.querySelector('.note-title')?.innerText?.trim() ||
      root.querySelector('.title')?.innerText?.trim();
    if (scopedTitle) return scopedTitle;
  }

  return '笔记';
}

function getNoteTextEls() {
  const root = getCurrentNoteRoot();
  if (root) {
    let scoped = Array.from(root.querySelectorAll('#detail-desc .note-text'));
    if (scoped.length === 0) {
      scoped = Array.from(root.querySelectorAll('.desc .note-text'));
    }
    if (scoped.length === 0) {
      scoped = Array.from(root.querySelectorAll('.note-content .note-text'));
    }
    if (scoped.length > 0) return scoped;
  }

  let els = Array.from(document.querySelectorAll('#detail-desc .note-text'));
  if (els.length === 0) {
    els = Array.from(document.querySelectorAll('.desc .note-text'));
  }
  if (els.length === 0) {
    els = Array.from(document.querySelectorAll('.note-content .note-text'));
  }
  return els;
}

function getActiveNoteDetailMask() {
  const strictMasks = Array.from(document.querySelectorAll('.note-detail-mask[note-id]'));
  const looseMasks = Array.from(document.querySelectorAll('.note-detail-mask'));
  const masks = strictMasks.length > 0 ? strictMasks : looseMasks;
  if (masks.length === 0) return null;
  const scored = masks
    .filter((mask) => mask instanceof Element)
    .map((mask, index) => {
      const style = window.getComputedStyle(mask);
      const rect = mask.getBoundingClientRect();
      const visible = style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 80 && rect.height > 80;
      const container = mask.querySelector('#noteContainer.note-container, #noteContainer, .note-container');
      const titleEl = container?.querySelector?.('#detail-title, .note-content #detail-title, .note-content .title');
      const titleText = (titleEl?.textContent || '').trim();
      const area = Math.max(0, rect.width * rect.height);
      let score = 0;
      if (visible) score += 100000;
      if (container) score += 10000;
      if (titleText) score += 1000;
      score += Math.floor(area / 100);
      score += index; // newer node tends to be later in DOM
      return { mask, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.mask || masks[masks.length - 1] || null;
}

function getCurrentOpenedNoteId() {
  const mask = getActiveNoteDetailMask();
  if (!mask) return '';
  const id = mask.getAttribute('note-id') || '';
  return id.trim();
}

function getCurrentStateNoteEntry() {
  try {
    const detailMap = getInitialState()?.note?.noteDetailMap || {};
    const keys = Object.keys(detailMap);
    if (keys.length === 0) return null;

    const candidates = [];
    const openedNoteId = getCurrentOpenedNoteId();
    if (openedNoteId) candidates.push(openedNoteId);
    const pathPart = location.pathname.split('/').filter(Boolean).pop() || '';
    if (pathPart) candidates.push(pathPart);
    try {
      const search = new URLSearchParams(location.search);
      ['noteId', 'note_id', 'id', 'itemId'].forEach((name) => {
        const value = search.get(name);
        if (value) candidates.push(value);
      });
    } catch {}

    const uniqCandidates = Array.from(new Set(candidates.filter(Boolean)));
    for (const candidate of uniqCandidates) {
      if (detailMap[candidate]) return detailMap[candidate];
      const matchedKey = keys.find((key) => key === candidate || key.includes(candidate) || candidate.includes(key));
      if (matchedKey) return detailMap[matchedKey];
      const matchedByEntry = keys.find((key) => {
        const entry = detailMap[key];
        const note = entry?.note || entry;
        const entryIds = [note?.noteId, note?.id, entry?.noteId, entry?.id]
          .filter(Boolean)
          .map((id) => String(id));
        return entryIds.some((id) => id === candidate || id.includes(candidate) || candidate.includes(id));
      });
      if (matchedByEntry) return detailMap[matchedByEntry];
    }

    const normalize = (value) => String(value || '').replace(/\\s+/g, '').trim();
    const currentTitle = normalize(getNoteTitle());
    if (currentTitle) {
      const titleMatchedKey = keys.find((key) => {
        const entry = detailMap[key];
        const note = entry?.note || entry;
        const entryTitle = normalize(note?.title || note?.noteTitle || '');
        return entryTitle && (entryTitle === currentTitle || entryTitle.includes(currentTitle) || currentTitle.includes(entryTitle));
      });
      if (titleMatchedKey) return detailMap[titleMatchedKey];
    }

    const hasVisibleMainVideo = Boolean(getCurrentMainVideoElement());
    if (hasVisibleMainVideo) {
      const videoMatchedKey = keys.find((key) => {
        const entry = detailMap[key];
        const note = entry?.note || entry;
        const typeHint = String(note?.type || note?.noteType || '').toLowerCase();
        if (typeHint.includes('video')) return true;
        if (note?.video && typeof note.video === 'object') return true;
        const masterUrl = findKeyInObject(note, 'masterUrl');
        return typeof masterUrl === 'string' && /^https?:\\/\\//i.test(masterUrl);
      });
      if (videoMatchedKey) return detailMap[videoMatchedKey];
    }

    if (keys.length === 1) {
      return detailMap[keys[0]];
    }
    return null;
  } catch (e) {
    console.warn('[XHS] resolve state note entry failed', e);
    return null;
  }
}

function getCurrentStateNote() {
  const entry = getCurrentStateNoteEntry();
  return entry?.note || entry || null;
}

function normalizeTitle(value) {
  return String(value || '').replace(/\\s+/g, '').trim();
}

function isStateAlignedWithDomTitle() {
  const note = getCurrentStateNote();
  if (!note) return false;
  const openedNoteId = getCurrentOpenedNoteId();
  const stateIds = [note?.noteId, note?.id, note?.note_id]
    .filter(Boolean)
    .map((id) => String(id).trim());
  if (openedNoteId && stateIds.length > 0) {
    return stateIds.some((id) => id === openedNoteId || id.includes(openedNoteId) || openedNoteId.includes(id));
  }
  const domTitle = normalizeTitle(getNoteTitle());
  const stateTitle = normalizeTitle(note?.title || note?.noteTitle || '');
  if (domTitle && stateTitle) {
    return domTitle === stateTitle || domTitle.includes(stateTitle) || stateTitle.includes(domTitle);
  }
  if (domTitle && !stateTitle) {
    return false;
  }
  return true;
}

function isCommentRelatedNode(el) {
  if (!el || !el.closest) return false;
  return Boolean(
    el.closest('.comments-el') ||
    el.closest('.comment-list') ||
    el.closest('.comment-item') ||
    el.closest('.comment-container') ||
    el.closest('.comments-container') ||
    el.closest('[class*="comment"]') ||
    el.closest('[id*="comment"]')
  );
}

function getCurrentNoteRoot() {
  const directRoot =
    document.querySelector('#noteContainer.note-container[data-render-status]') ||
    document.querySelector('#noteContainer.note-container') ||
    document.querySelector('#noteContainer');
  if (directRoot) {
    return directRoot;
  }

  const mask = getActiveNoteDetailMask();
  if (mask) {
    const scoped =
      mask.querySelector('#noteContainer.note-container') ||
      mask.querySelector('#noteContainer') ||
      mask.querySelector('.note-container') ||
      null;
    if (scoped) return scoped;
  }

  const anchor =
    document.querySelector('#detail-desc') ||
    document.querySelector('#detail-title') ||
    document.querySelector('.note-content') ||
    null;
  if (!anchor) return null;
  return (
    anchor.closest('#noteContainer.note-container') ||
    anchor.closest('#noteContainer') ||
    anchor.closest('.note-container') ||
    anchor.closest('#detail-container') ||
    anchor.closest('.note-content') ||
    anchor.closest('[class*="note-container"]') ||
    anchor.closest('[class*="note-content"]') ||
    anchor.parentElement ||
    null
  );
}

function isNodeVisible(el) {
  if (!el || !(el instanceof Element)) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 24 && rect.height > 24;
}

function isLivePhotoNote() {
  const root = getCurrentNoteRoot();
  if (!root) return false;
  return Boolean(root.querySelector('img.live-img, .live-img.live-img-visible, [class*="live-img"]'));
}

function getCurrentMainVideoElement() {
  const root = getCurrentNoteRoot();
  if (!root) return null;
  const candidates = Array.from(root.querySelectorAll('video, video[mediatype="video"], .xgplayer video'));
  const visible = candidates.find((el) => !isCommentRelatedNode(el) && isNodeVisible(el));
  if (visible) return visible;
  const tagged = candidates.find((el) => {
    if (isCommentRelatedNode(el)) return false;
    if (el.getAttribute('mediatype') === 'video') return true;
    const src = (el.getAttribute('src') || '').trim();
    if (src.startsWith('blob:')) return true;
    if (/^https?:\\/\\//i.test(src)) return true;
    const hasSource = el.querySelector('source[src^="blob:"], source[src^="http"]');
    return Boolean(hasSource);
  });
  return tagged || null;
}

function getCurrentNoteImgEls() {
  const root = getCurrentNoteRoot();
  let els = root
    ? Array.from(root.querySelectorAll('.img-container img, .note-content .img-container img, .swiper-slide img'))
    : [];
  if (els.length === 0) {
    els = Array.from(document.querySelectorAll('.note-content .img-container img, .img-container img, .swiper-slide img'));
  }
  return els.filter((img) => {
    if (isCommentRelatedNode(img)) return false;
    if (img.closest('.avatar,[class*="avatar"]')) return false;
    const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
    return /^https?:\\/\\//i.test(src);
  });
}

function getImageUrlsFromState() {
  const urls = [];
  const note = getCurrentStateNote();
  if (!note) return urls;
  if (!isStateAlignedWithDomTitle()) return urls;

  const imageList = Array.isArray(note?.imageList)
    ? note.imageList
    : Array.isArray(note?.images)
      ? note.images
      : [];

  imageList.forEach((item) => {
    if (typeof item === 'string') {
      pushUniqueUrl(urls, item);
      return;
    }
    pushUniqueUrl(urls, item?.urlDefault);
    pushUniqueUrl(urls, item?.urlPre);
    pushUniqueUrl(urls, item?.url);
    pushUniqueUrl(urls, item?.urlDefaultWebp);
    if (Array.isArray(item?.infoList)) {
      item.infoList.forEach((info) => {
        pushUniqueUrl(urls, info?.url);
        pushUniqueUrl(urls, info?.urlPre);
      });
    }
  });

  return urls;
}

function getCurrentNoteImageUrls() {
  const urls = [];
  const stateImageUrls = getImageUrlsFromState();
  stateImageUrls.forEach((url) => pushUniqueUrl(urls, url));
  if (urls.length > 0) return urls;

  getCurrentNoteImgEls().forEach((img) => {
    pushUniqueUrl(urls, img.getAttribute('src') || img.getAttribute('data-src') || '');
  });
  if (urls.length > 0) return urls;

  const root = getCurrentNoteRoot();
  if (root) {
    const bgEls = Array.from(root.querySelectorAll('.swiper-slide[style*="background"], .swiper-slide[style*="background-image"]'));
    bgEls.forEach((el) => {
      const styleText = el.getAttribute('style') || '';
      const matched = styleText.match(/url\\((['"]?)(https?:\\/\\/[^)'"]+)\\1\\)/i);
      if (matched && matched[2]) {
        pushUniqueUrl(urls, matched[2]);
      }
    });
  }

  return urls;
}

function getCoverImageUrl() {
  const videoEl = getCurrentNoteRoot()?.querySelector('video') || document.querySelector('.note-content video');
  if (videoEl && videoEl.getAttribute('poster')) {
    return videoEl.getAttribute('poster');
  }
  const firstImageUrl = getCurrentNoteImageUrls()[0];
  if (firstImageUrl) {
    return firstImageUrl;
  }
  const metaOg = document.querySelector('meta[property="og:image"], meta[name="og:image"]');
  if (metaOg && metaOg.getAttribute('content')) {
    return metaOg.getAttribute('content');
  }
  return null;
}

function getInitialState() {
  const scripts = document.querySelectorAll('script');
  for (const script of scripts) {
    if (script.textContent && script.textContent.includes('window.__INITIAL_STATE__=')) {
      try {
        const jsonText = script.textContent
          .replace('window.__INITIAL_STATE__=', '')
          .replace(/undefined/g, 'null')
          .replace(/;$/, '');
        return JSON.parse(jsonText);
      } catch (e) {
        console.warn('[XHS] parse __INITIAL_STATE__ failed', e);
      }
    }
  }
  return null;
}

function findKeyInObject(obj, key) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj[key]) return obj[key];
  for (const k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      const result = findKeyInObject(obj[k], key);
      if (result) return result;
    }
  }
  return null;
}

function pushUniqueUrl(list, value) {
  if (!value || typeof value !== 'string') return;
  const url = value.trim();
  if (!url) return;
  if (!/^https?:\\/\\//i.test(url)) return;
  if (!list.includes(url)) {
    list.push(url);
  }
}

function getVideoUrlsFromState() {
  const urls = [];
  const note = getCurrentStateNote();
  if (!note) return urls;

  const videoNode = note?.video || null;
  const h264 = videoNode?.media?.stream?.h264;
  const h265 = videoNode?.media?.stream?.h265;

  const collectStreams = (streamList) => {
    if (!Array.isArray(streamList)) return;
    streamList.forEach((item) => {
      pushUniqueUrl(urls, item?.masterUrl);
      if (Array.isArray(item?.backupUrls)) {
        item.backupUrls.forEach((backup) => pushUniqueUrl(urls, backup));
      }
    });
  };

  collectStreams(h264);
  collectStreams(h265);

  pushUniqueUrl(urls, videoNode?.media?.masterUrl);
  pushUniqueUrl(urls, videoNode?.media?.url);
  pushUniqueUrl(urls, videoNode?.url);

  try {
    const masterUrl = findKeyInObject(note, 'masterUrl');
    if (typeof masterUrl === 'string') {
      pushUniqueUrl(urls, masterUrl);
    }
    const backups = findKeyInObject(note, 'backupUrls');
    if (Array.isArray(backups)) {
      backups.forEach((backup) => pushUniqueUrl(urls, backup));
    }
  } catch (e) {
    console.warn('[XHS] parse state video failed', e);
  }

  return urls;
}

function hasVideoShapeInState(note) {
  if (!note || typeof note !== 'object') return false;
  const videoNode = note?.video;
  if (videoNode && typeof videoNode === 'object') {
    if (videoNode?.media || videoNode?.stream || videoNode?.consumer) return true;
    if (Array.isArray(videoNode) && videoNode.length > 0) return true;
  }
  return false;
}

function hasVideoInState() {
  const note = getCurrentStateNote();
  if (!note) return false;
  if (isLivePhotoNote()) return false;
  if (!isStateAlignedWithDomTitle()) return false;
  const typeHint = String(note?.type || note?.noteType || '').toLowerCase();
  if (typeHint.includes('video')) return true;
  if (hasVideoShapeInState(note)) return true;
  return getVideoUrlsFromState().length > 0;
}

function hasCurrentNoteVideoElement() {
  if (isLivePhotoNote()) return false;
  return Boolean(getCurrentMainVideoElement());
}

function getVideoUrlsFromPerformance() {
  const urls = [];
  try {
    const entries = performance.getEntriesByType('resource') || [];
    entries.forEach((entry) => {
      const name = entry && typeof entry.name === 'string' ? entry.name : '';
      if (!name || !/^https?:\\/\\//i.test(name)) return;
      const lower = name.toLowerCase();
      const looksLikeVideo =
        lower.includes('.mp4') ||
        lower.includes('.m3u8') ||
        lower.includes('/hls/') ||
        lower.includes('/video/') ||
        lower.includes('sns-video') ||
        lower.includes('xhscdn');
      if (looksLikeVideo) {
        pushUniqueUrl(urls, name);
      }
    });
  } catch (e) {
    console.warn('[XHS] parse performance video failed', e);
  }
  return urls;
}

function getCurrentNoteVideoUrlsFromDom() {
  const urls = [];
  const root = getCurrentNoteRoot();
  const videoEls = root
    ? Array.from(root.querySelectorAll('video'))
    : [];
  videoEls.forEach((videoEl) => {
    if (isCommentRelatedNode(videoEl)) return;
    pushUniqueUrl(urls, videoEl?.src || '');
    const sourceEls = Array.from(videoEl.querySelectorAll('source'));
    sourceEls.forEach((source) => pushUniqueUrl(urls, source?.src || ''));
  });
  return urls;
}

function getCurrentNoteVideoUrls() {
  const urls = [];
  getVideoUrlsFromState().forEach((url) => pushUniqueUrl(urls, url));
  if (urls.length > 0) return urls;
  if (hasCurrentNoteVideoElement()) {
    getVideoUrlsFromPerformance().forEach((url) => pushUniqueUrl(urls, url));
    if (urls.length > 0) return urls;
  }
  getCurrentNoteVideoUrlsFromDom().forEach((url) => pushUniqueUrl(urls, url));

  return urls;
}

function getCurrentNoteVideoUrl() {
  const urls = getCurrentNoteVideoUrls();
  return urls[0] || null;
}

function hasNoteDataInState() {
  try {
    const detailMap = getInitialState()?.note?.noteDetailMap || {};
    return Object.keys(detailMap).length > 0;
  } catch (e) {
    return false;
  }
}

function getAuthorInfo() {
  try {
    const root = getCurrentNoteRoot();
    const infoEl = root
      ? (root.querySelector('.author .info') || root.querySelector('.author-wrapper .info') || root.querySelector('.info'))
      : document.querySelector('.info');
    if (!infoEl) return null;

    const usernameEl = infoEl.querySelector('.username');
    const authorName = usernameEl ? usernameEl.innerText.trim() : '';
    const avatarEl = infoEl.querySelector('.avatar-item');
    const avatarUrl = avatarEl ? avatarEl.getAttribute('src') : '';
    const profileLinkEl = infoEl.querySelector('a[href*="/user/profile/"]');
    const profileUrl = profileLinkEl ? profileLinkEl.getAttribute('href') : '';

    if (!authorName) return null;

    return {
      name: authorName,
      avatar: avatarUrl,
      profile: profileUrl
    };
  } catch (e) {
    console.error('[XHS] get author failed', e);
    return null;
  }
}
`;

const DETECT_NOTE_SCRIPT = `
(() => {
  ${XHS_SHARED_SCRIPT}
  const hasText = getNoteTextEls().length > 0;
  const hasContainer = Boolean(getCurrentNoteRoot());
  const stateImageUrls = getImageUrlsFromState();
  const imageCount = stateImageUrls.length > 0 ? stateImageUrls.length : getCurrentNoteImgEls().length;
  const primaryVideoUrl = getCurrentNoteVideoUrl();
  const stateHasVideo = hasVideoInState();
  const hasDomVideoElement = hasCurrentNoteVideoElement();
  const livePhoto = isLivePhotoNote();
  const hasImage = imageCount > 0;
  const hasVideo = stateHasVideo || hasDomVideoElement || Boolean(primaryVideoUrl);
  const hasStateData = hasNoteDataInState();
  const isNote = hasContainer || hasText || hasImage || hasVideo || hasStateData;
  // 优先以当前笔记 state 的视频字段判定；仅在 state 缺失时回退到 DOM 媒体启发式
  const isVideoNote = !livePhoto && (stateHasVideo || hasDomVideoElement || (Boolean(primaryVideoUrl) && imageCount <= 1));

  return {
    isNote,
    noteType: isVideoNote ? 'video' : 'image',
    title: isNote ? getNoteTitle() : ''
  };
})();
`;

const GET_NOTE_DATA_SCRIPT = `
(() => {
  ${XHS_SHARED_SCRIPT}

  const title = getNoteTitle();
  const textEls = getNoteTextEls();
  const content = textEls
    .map((el) => el.innerText?.trim())
    .filter(Boolean)
    .join('\\n\\n');
  const authorInfo = getAuthorInfo();

  const images = getCurrentNoteImageUrls().slice(0, 9);
  const videoUrls = getCurrentNoteVideoUrls();
  const stateHasVideo = hasVideoInState();
  const hasDomVideoElement = hasCurrentNoteVideoElement();
  const livePhoto = isLivePhotoNote();
  // 优先以 state 判断视频笔记，避免评论区/推荐区媒体干扰
  const isVideoNote = !livePhoto && (stateHasVideo || hasDomVideoElement || (videoUrls.length > 0 && images.length <= 1));
  const selectedVideoUrl = isVideoNote ? videoUrls[0] : null;

  let stats = { likes: 0, collects: 0 };
  try {
    const likeEl = Array.from(document.querySelectorAll('.like-wrapper .count,[class*="like-wrapper"] .count,[class*="like"] .count'))
      .find((el) => !el.closest('.comments-el') && !el.closest('[class*="comments-el"]'));
    const collectEl = Array.from(document.querySelectorAll('.collect-wrapper .count,[class*="collect-wrapper"] .count,[class*="collect"] .count'))
      .find((el) => !el.closest('.comments-el') && !el.closest('[class*="comments-el"]'));

    if (likeEl) stats.likes = parseCountText(likeEl.innerText);
    if (collectEl) stats.collects = parseCountText(collectEl.innerText);
  } catch (e) {
    console.warn('[XHS] parse stats failed', e);
  }

  const noteId = 'xhs_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

  return {
    noteId,
    title,
    author: authorInfo?.name || '未知',
    content,
    text: content,
    images,
    coverUrl: getCoverImageUrl(),
    videoUrl: selectedVideoUrl,
    stats,
    source: window.location.href
  };
})();
`;

const INJECT_SAVE_BUTTON_SCRIPT = `
(() => {
  if (!location.hostname.includes('xiaohongshu.com')) {
    return { success: false, reason: 'not-xhs' };
  }

  const BTN_ID = 'redconvert-save-button';

  const findFollowButton = () => {
    const byClass = document.querySelector('button.follow-button');
    if (byClass) return byClass;

    const candidates = Array.from(document.querySelectorAll('button.reds-button-new'));
    return candidates.find((btn) => (btn.innerText || '').trim() === '关注') || null;
  };

  const followButton = findFollowButton();
  if (!followButton) {
    return { success: false, reason: 'follow-not-found' };
  }

  let saveButton = document.getElementById(BTN_ID);
  if (saveButton) {
    return { success: true, injected: false };
  }

  saveButton = followButton.cloneNode(true);
  saveButton.id = BTN_ID;
  saveButton.classList.remove('follow-button');
  saveButton.style.marginLeft = '8px';
  saveButton.setAttribute('type', 'button');
  saveButton.dataset.redconvertState = 'idle';

  const textEl = saveButton.querySelector('.reds-button-new-text');
  if (textEl) {
    textEl.textContent = '保存';
  } else {
    saveButton.textContent = '保存';
  }

  saveButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (saveButton.dataset.redconvertState === 'saving') return;
    console.log('${SAVE_TRIGGER_MARKER}');
  });

  followButton.insertAdjacentElement('afterend', saveButton);

  return { success: true, injected: true };
})();
`;

const FORCE_LAYOUT_SCRIPT = `
(() => {
  window.dispatchEvent(new Event('resize'));
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    viewportWidth: document.documentElement?.clientWidth || 0,
    ua: navigator.userAgent
  };
})();
`;

function buildSetInjectedButtonStateScript(status: SaveStatus): string {
    const labelMap: Record<SaveStatus, string> = {
        idle: '保存',
        saving: '保存中...',
        success: '已保存',
        error: '保存失败',
    };
    const disabled = status === 'saving' ? 'true' : 'false';

    return `
(() => {
  const saveButton = document.getElementById('redconvert-save-button');
  if (!saveButton) return false;

  saveButton.dataset.redconvertState = '${status}';
  if (${disabled}) {
    saveButton.setAttribute('disabled', 'true');
  } else {
    saveButton.removeAttribute('disabled');
  }

  const textEl = saveButton.querySelector('.reds-button-new-text');
  if (textEl) {
    textEl.textContent = '${labelMap[status]}';
  } else {
    saveButton.textContent = '${labelMap[status]}';
  }

  return true;
})();
`;
}

function createTab(url: string = DEFAULT_URL): BrowserTab {
    return {
        id: `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        url,
        title: '新标签页',
        isLoading: true,
        canGoBack: false,
        canGoForward: false,
        note: null,
        saveStatus: 'idle',
    };
}

function normalizeUrl(input: string): string {
    const value = input.trim();
    if (!value) return DEFAULT_URL;

    if (/^https?:\/\//i.test(value)) {
        return value;
    }

    if (value.includes('.')) {
        return `https://${value}`;
    }

    return `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(value)}`;
}

function formatTabTitle(title: string, url: string): string {
    const cleanTitle = title?.trim();
    if (cleanTitle) return cleanTitle;

    try {
        return new URL(url).hostname;
    } catch {
        return '新标签页';
    }
}

function buildSetWebNightFilterScript(enabled: boolean): string {
    const stateLiteral = enabled ? 'true' : 'false';
    return `
(() => {
  const CLASS_NAME = 'redbox-web-night-filter';
  const STYLE_ID = 'redbox-web-night-filter-style';
  const root = document.documentElement;
  if (!root) return false;

  let styleEl = document.getElementById(STYLE_ID);
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = STYLE_ID;
    styleEl.textContent = [
      'html.redbox-web-night-filter {',
      '  background: #0b1220 !important;',
      '  filter: invert(0.92) hue-rotate(180deg) contrast(0.95) saturate(0.9) !important;',
      '}',
      'html.redbox-web-night-filter body { background: #0b1220 !important; }',
      'html.redbox-web-night-filter img,',
      'html.redbox-web-night-filter video,',
      'html.redbox-web-night-filter picture,',
      'html.redbox-web-night-filter canvas,',
      'html.redbox-web-night-filter svg {',
      '  filter: invert(1) hue-rotate(180deg) contrast(1.05) !important;',
      '}',
    ].join('\\n');
    const mountTarget = document.head || document.documentElement;
    mountTarget.appendChild(styleEl);
  }

  root.classList.toggle(CLASS_NAME, ${stateLiteral});
  return true;
})();
`;
}

function ManagedWebview({
    tab,
    onRefChange,
    onElementLayout,
    onDidStartLoading,
    onDidStopLoading,
    onDidNavigate,
    onTitleUpdated,
    onOpenInNewTab,
    onConsoleMessage,
    onDomReady,
}: ManagedWebviewProps) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const webviewRef = useRef<WebViewElement | null>(null);

    const normalizeWebviewZoom = useCallback(() => {
        const webview = webviewRef.current;
        if (!webview) return;

        try {
            const currentZoom = typeof webview.getZoomFactor === 'function' ? webview.getZoomFactor() : 1;
            if (Math.abs((currentZoom || 1) - 1) > 0.001 && typeof webview.setZoomFactor === 'function') {
                webview.setZoomFactor(1);
            }
        } catch (error) {
            console.warn('[XHS] reset zoom factor failed:', error);
        }

        try {
            if (typeof webview.setVisualZoomLevelLimits === 'function') {
                const maybePromise = webview.setVisualZoomLevelLimits(1, 1);
                if (maybePromise && typeof maybePromise.catch === 'function') {
                    maybePromise.catch(() => {
                        // ignore
                    });
                }
            }
        } catch (error) {
            console.warn('[XHS] set visual zoom limits failed:', error);
        }
    }, []);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;

        const webview = document.createElement('webview') as WebViewElement;
        const alignedUserAgent = getAlignedXhsUserAgent();
        webview.setAttribute('src', tab.url);
        webview.setAttribute('webpreferences', 'contextIsolation=yes');
        webview.setAttribute('partition', XHS_WEBVIEW_PARTITION);
        webview.setAttribute('useragent', alignedUserAgent);
        webview.setAttribute('allowpopups', 'true');
        webview.setAttribute('autosize', 'on');
        webview.style.position = 'absolute';
        webview.style.top = '0';
        webview.style.right = '0';
        webview.style.bottom = '0';
        webview.style.left = '0';
        webview.style.display = 'inline-flex';
        webview.style.width = '100%';
        webview.style.height = '100%';

        host.appendChild(webview);
        webviewRef.current = webview;
        onRefChange(tab.id, webview);
        try {
            if (typeof webview.setMaxListeners === 'function') {
                webview.setMaxListeners(32);
            }
        } catch {
            // ignore
        }

        return () => {
            onRefChange(tab.id, null);
            if (host.contains(webview)) {
                host.removeChild(webview);
            }
            webviewRef.current = null;
        };
    }, [tab.id, onRefChange]);

    useEffect(() => {
        const host = hostRef.current;
        const webview = webviewRef.current;
        if (!host || !webview) return;

        const syncSize = () => {
            const rect = host.getBoundingClientRect();
            const width = Math.max(1, Math.floor(rect.width));
            const height = Math.max(1, Math.floor(rect.height));

            webview.style.display = 'inline-flex';
            webview.style.width = `${width}px`;
            webview.style.height = `${height}px`;
            webview.style.minWidth = `${width}px`;
            webview.style.minHeight = `${height}px`;
            webview.setAttribute('autosize', 'on');
            webview.setAttribute('minwidth', `${width}`);
            webview.setAttribute('minheight', `${height}`);
            webview.setAttribute('maxwidth', `${width}`);
            webview.setAttribute('maxheight', `${height}`);

            const webviewRect = webview.getBoundingClientRect();
            onElementLayout(tab.id, {
                hostWidth: width,
                hostHeight: height,
                webviewWidth: Math.floor(webviewRect.width),
                webviewHeight: Math.floor(webviewRect.height),
            });
        };

        syncSize();
        const observer = new ResizeObserver(syncSize);
        observer.observe(host);
        window.addEventListener('resize', syncSize);

        return () => {
            observer.disconnect();
            window.removeEventListener('resize', syncSize);
        };
    }, [onElementLayout, tab.id]);

    useEffect(() => {
        const webview = webviewRef.current;
        if (!webview) return;

        const handleDidStartLoading = () => onDidStartLoading(tab.id);
        const handleDidStopLoading = () => onDidStopLoading(tab.id);
        const handleDidNavigate = (event: { url: string }) => onDidNavigate(tab.id, event.url);
        const handleDidNavigateInPage = (event: { url: string }) => onDidNavigate(tab.id, event.url);
        const handlePageTitleUpdated = (event: { title: string }) => onTitleUpdated(tab.id, event.title || '新标签页');
        const handleDomReady = () => {
            normalizeWebviewZoom();
            onDomReady(tab.id);
        };
        const handleNewWindow = (event: { url: string; preventDefault?: () => void }) => {
            if (event.preventDefault) {
                event.preventDefault();
            }
            if (event.url) {
                onOpenInNewTab(event.url);
            }
        };
        const handleConsoleMessage = (event: { message: string }) => onConsoleMessage(tab.id, event.message || '');

        webview.addEventListener('did-start-loading', handleDidStartLoading);
        webview.addEventListener('did-stop-loading', handleDidStopLoading);
        webview.addEventListener('did-navigate', handleDidNavigate);
        webview.addEventListener('did-navigate-in-page', handleDidNavigateInPage);
        webview.addEventListener('page-title-updated', handlePageTitleUpdated);
        webview.addEventListener('dom-ready', handleDomReady);
        webview.addEventListener('new-window', handleNewWindow);
        webview.addEventListener('console-message', handleConsoleMessage);

        return () => {
            webview.removeEventListener('did-start-loading', handleDidStartLoading);
            webview.removeEventListener('did-stop-loading', handleDidStopLoading);
            webview.removeEventListener('did-navigate', handleDidNavigate);
            webview.removeEventListener('did-navigate-in-page', handleDidNavigateInPage);
            webview.removeEventListener('page-title-updated', handlePageTitleUpdated);
            webview.removeEventListener('dom-ready', handleDomReady);
            webview.removeEventListener('new-window', handleNewWindow);
            webview.removeEventListener('console-message', handleConsoleMessage);
        };
    }, [tab.id, onDidNavigate, onDidStartLoading, onDidStopLoading, onTitleUpdated, onDomReady, onOpenInNewTab, onConsoleMessage, normalizeWebviewZoom]);

    return <div ref={hostRef} className="absolute inset-0" />;
}

export function XhsBrowser() {
    const initialTab = useMemo(() => createTab(), []);
    const [tabs, setTabs] = useState<BrowserTab[]>([initialTab]);
    const [activeTabId, setActiveTabId] = useState(initialTab.id);
    const [addressInput, setAddressInput] = useState(DEFAULT_URL);
    const [layoutSnapshots, setLayoutSnapshots] = useState<Record<string, LayoutSnapshot>>({});
    const [elementSnapshots, setElementSnapshots] = useState<Record<string, ElementLayoutSnapshot>>({});
    const [clipboardCandidate, setClipboardCandidate] = useState<YouTubeClipboardCandidate | null>(null);
    const [isCapturePromptOpen, setIsCapturePromptOpen] = useState(false);
    const [captureStatus, setCaptureStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
    const [captureMessage, setCaptureMessage] = useState('');
    const [isWebNightFilterEnabled, setIsWebNightFilterEnabled] = useState(() => {
        try {
            return window.localStorage.getItem(XHS_WEB_NIGHT_FILTER_STORAGE_KEY) === '1';
        } catch {
            return false;
        }
    });

    const webviewRefs = useRef<Record<string, WebViewElement | null>>({});
    const detectTimerRef = useRef<Record<string, number>>({});
    const saveResetTimerRef = useRef<Record<string, number>>({});
    const lastOpenedTabRef = useRef<{ url: string; ts: number } | null>(null);
    const lastXhsCaptureAtRef = useRef<number>(0);
    const lastClipboardTextRef = useRef('');
    const clipboardPollingRef = useRef(false);
    const capturedYouTubeSetRef = useRef<Set<string>>(new Set());

    const activeTab = useMemo(() => tabs.find(tab => tab.id === activeTabId) ?? tabs[0], [tabs, activeTabId]);

    useEffect(() => {
        if (activeTab?.url) {
            setAddressInput(activeTab.url);
        }
    }, [activeTab?.url]);

    useEffect(() => {
        return () => {
            Object.values(detectTimerRef.current).forEach(window.clearTimeout);
            Object.values(saveResetTimerRef.current).forEach(window.clearTimeout);
        };
    }, []);

    const updateTab = useCallback((tabId: string, patch: Partial<BrowserTab>) => {
        setTabs(prev => prev.map(tab => (tab.id === tabId ? { ...tab, ...patch } : tab)));
    }, []);

    const clearTimersForTab = useCallback((tabId: string) => {
        const detectTimer = detectTimerRef.current[tabId];
        if (detectTimer) {
            window.clearTimeout(detectTimer);
            delete detectTimerRef.current[tabId];
        }

        const saveTimer = saveResetTimerRef.current[tabId];
        if (saveTimer) {
            window.clearTimeout(saveTimer);
            delete saveResetTimerRef.current[tabId];
        }
    }, []);

    const runScriptInTab = useCallback(async <T,>(tabId: string, script: string): Promise<T | null> => {
        const webview = webviewRefs.current[tabId];
        if (!webview) return null;

        try {
            const result = await webview.executeJavaScript(script);
            return result as T;
        } catch (error) {
            console.error('[XHS] executeJavaScript failed:', error);
            return null;
        }
    }, []);

    const applyWebNightFilterToTab = useCallback(async (tabId: string, enabled: boolean) => {
        await runScriptInTab(tabId, buildSetWebNightFilterScript(enabled));
    }, [runScriptInTab]);

    useEffect(() => {
        try {
            window.localStorage.setItem(XHS_WEB_NIGHT_FILTER_STORAGE_KEY, isWebNightFilterEnabled ? '1' : '0');
        } catch {
            // ignore storage errors
        }
    }, [isWebNightFilterEnabled]);

    useEffect(() => {
        tabs.forEach((tab) => {
            void applyWebNightFilterToTab(tab.id, isWebNightFilterEnabled);
        });
    }, [tabs, isWebNightFilterEnabled, applyWebNightFilterToTab]);

    const forceTabLayout = useCallback(async (tabId: string) => {
        const result = await runScriptInTab<LayoutSnapshot>(tabId, FORCE_LAYOUT_SCRIPT);
        if (!result) return;
        setLayoutSnapshots((prev) => ({ ...prev, [tabId]: result }));
        console.log('[XHS] layout info:', tabId, result);
    }, [runScriptInTab]);

    const syncTabNavState = useCallback((tabId: string, nextUrl?: string) => {
        const webview = webviewRefs.current[tabId];
        if (!webview) return;

        const patch: Partial<BrowserTab> = {};

        try {
            const currentUrl = webview.getURL?.();
            if (currentUrl) {
                patch.url = currentUrl;
            }
        } catch {
            if (nextUrl) {
                patch.url = nextUrl;
            }
        }

        if (!patch.url && nextUrl) {
            patch.url = nextUrl;
        }

        try {
            patch.canGoBack = Boolean(webview.canGoBack?.());
            patch.canGoForward = Boolean(webview.canGoForward?.());
        } catch {
            patch.canGoBack = false;
            patch.canGoForward = false;
        }

        updateTab(tabId, patch);
    }, [updateTab]);

    const checkForNote = useCallback(async (
        tabId: string,
        options?: { retries?: number; intervalMs?: number }
    ) => {
        const retries = options?.retries ?? 4;
        const intervalMs = options?.intervalMs ?? 260;
        let latest: NoteDetection | null = null;

        for (let attempt = 0; attempt <= retries; attempt++) {
            const result = await runScriptInTab<NoteDetection>(tabId, DETECT_NOTE_SCRIPT);
            if (result) {
                latest = result;
                const normalizedTitle = (result.title || '').trim();
                const hasReliableTitle = normalizedTitle.length > 0 && normalizedTitle !== '笔记';
                if (result.isNote && (hasReliableTitle || attempt === retries)) {
                    break;
                }
            }
            if (attempt < retries) {
                await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
            }
        }

        if (!latest) return;
        updateTab(tabId, { note: latest });
    }, [runScriptInTab, updateTab]);

    const injectSaveButton = useCallback(async (tabId: string) => {
        await runScriptInTab(tabId, INJECT_SAVE_BUTTON_SCRIPT);
    }, [runScriptInTab]);

    const setInjectedSaveButtonState = useCallback(async (tabId: string, status: SaveStatus) => {
        await runScriptInTab(tabId, buildSetInjectedButtonStateScript(status));
    }, [runScriptInTab]);

    const setTabSaveStatus = useCallback((tabId: string, status: SaveStatus, autoReset = false) => {
        updateTab(tabId, { saveStatus: status });
        void setInjectedSaveButtonState(tabId, status);

        const existingReset = saveResetTimerRef.current[tabId];
        if (existingReset) {
            window.clearTimeout(existingReset);
            delete saveResetTimerRef.current[tabId];
        }

        if (autoReset && (status === 'success' || status === 'error')) {
            saveResetTimerRef.current[tabId] = window.setTimeout(() => {
                updateTab(tabId, { saveStatus: 'idle' });
                void setInjectedSaveButtonState(tabId, 'idle');
                delete saveResetTimerRef.current[tabId];
            }, 2200);
        }
    }, [setInjectedSaveButtonState, updateTab]);

    const saveNoteFromTab = useCallback(async (tabId: string) => {
        const now = Date.now();
        const elapsed = now - lastXhsCaptureAtRef.current;
        if (elapsed < MIN_XHS_CAPTURE_INTERVAL_MS) {
            const remainSeconds = Math.ceil((MIN_XHS_CAPTURE_INTERVAL_MS - elapsed) / 1000);
            window.alert(`采集过于频繁，请至少间隔 5 秒后再试（约 ${remainSeconds} 秒）。`);
            return;
        }
        lastXhsCaptureAtRef.current = now;

        setTabSaveStatus(tabId, 'saving');

        try {
            let noteData: NotePayload | null = null;
            for (let attempt = 0; attempt < 5; attempt++) {
                const result = await runScriptInTab<NotePayload>(tabId, GET_NOTE_DATA_SCRIPT);
                if (result) {
                    noteData = result;
                    const title = (result.title || '').trim();
                    const hasValidTitle = title.length > 0 && title !== '笔记';
                    const hasMedia = Array.isArray(result.images) && result.images.length > 0;
                    const hasText = Boolean(result.content?.trim());
                    const hasVideo = Boolean(result.videoUrl);
                    if (hasValidTitle && (hasMedia || hasText || hasVideo)) {
                        break;
                    }
                }
                await new Promise((resolve) => window.setTimeout(resolve, 280));
            }
            if (!noteData) {
                throw new Error('未获取到笔记数据');
            }

            const hasMedia = Array.isArray(noteData.images) && noteData.images.length > 0;
            const hasText = Boolean(noteData.content?.trim());
            const hasVideo = Boolean(noteData.videoUrl);

            if (!hasMedia && !hasText && !hasVideo) {
                throw new Error('笔记内容为空');
            }

            const ipcResult = await window.ipcRenderer.invoke('xhs:save-note', noteData) as { success?: boolean; error?: string } | null;
            if (!ipcResult || ipcResult.success === false) {
                const controller = new AbortController();
                const timeout = window.setTimeout(() => controller.abort(), 15000);
                const response = await fetch(NOTES_API, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(noteData),
                    signal: controller.signal,
                }).finally(() => {
                    window.clearTimeout(timeout);
                });
                const result = await response.json().catch(() => null) as { success?: boolean; error?: string } | null;
                if (!response.ok || result?.success === false) {
                    throw new Error(result?.error || ipcResult?.error || '保存失败');
                }
            }

            setTabSaveStatus(tabId, 'success', true);
            await checkForNote(tabId, { retries: 2, intervalMs: 180 });
        } catch (error) {
            console.error('[XHS] 保存失败:', error);
            setTabSaveStatus(tabId, 'error', true);
        }
    }, [checkForNote, runScriptInTab, setTabSaveStatus]);

    const enqueueYoutubeFromClipboard = useCallback(async (candidate: YouTubeClipboardCandidate) => {
        const payload = {
            videoId: candidate.videoId,
            videoUrl: candidate.videoUrl,
            title: `YouTube_${candidate.videoId}`,
            description: '',
            thumbnailUrl: '',
        };

        const ipcResult = await window.ipcRenderer.invoke('youtube:save-note', payload) as {
            success?: boolean;
            duplicate?: boolean;
            error?: string;
            noteId?: string;
        } | null;
        if (ipcResult?.success) {
            return ipcResult;
        }

        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch(YOUTUBE_NOTES_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
            const result = await response.json().catch(() => null) as {
                success?: boolean;
                duplicate?: boolean;
                error?: string;
                noteId?: string;
            } | null;
            if (!response.ok || result?.success === false) {
                throw new Error(result?.error || ipcResult?.error || `HTTP ${response.status}`);
            }
            return result;
        } finally {
            window.clearTimeout(timeout);
        }
    }, []);

    const closeCapturePrompt = useCallback(() => {
        if (captureStatus === 'saving') return;
        setIsCapturePromptOpen(false);
        setClipboardCandidate(null);
        setCaptureStatus('idle');
        setCaptureMessage('');
    }, [captureStatus]);

    const confirmCaptureFromClipboard = useCallback(async () => {
        if (!clipboardCandidate || captureStatus === 'saving') return;

        setCaptureStatus('saving');
        setCaptureMessage('正在加入后台采集...');

        try {
            const result = await enqueueYoutubeFromClipboard(clipboardCandidate);
            capturedYouTubeSetRef.current.add(clipboardCandidate.videoId);
            setCaptureStatus('success');
            setCaptureMessage(
                result?.duplicate
                    ? '该视频已在知识库中，已跳过重复采集。'
                    : '已加入后台采集，稍后可在知识库看到处理结果。'
            );
            window.setTimeout(() => {
                setIsCapturePromptOpen(false);
                setClipboardCandidate(null);
                setCaptureStatus('idle');
                setCaptureMessage('');
            }, 1000);
        } catch (error) {
            console.error('[XHS] clipboard YouTube capture failed:', error);
            const message = error instanceof Error ? error.message : String(error);
            setCaptureStatus('error');
            setCaptureMessage(`采集失败：${message}`);
        }
    }, [captureStatus, clipboardCandidate, enqueueYoutubeFromClipboard]);

    useEffect(() => {
        if ((window as unknown as { __redboxGlobalClipboardWatcher?: boolean }).__redboxGlobalClipboardWatcher) {
            return;
        }

        const timer = window.setInterval(() => {
            void (async () => {
                if (clipboardPollingRef.current) return;
                if (isCapturePromptOpen || captureStatus === 'saving') return;
                clipboardPollingRef.current = true;
                try {
                    const text = await window.ipcRenderer.invoke('clipboard:read-text') as string;
                    const normalizedText = String(text || '').trim();
                    if (!normalizedText || normalizedText === lastClipboardTextRef.current) {
                        return;
                    }
                    lastClipboardTextRef.current = normalizedText;

                    const candidate = extractYouTubeCandidateFromClipboard(normalizedText);
                    if (!candidate) return;
                    if (capturedYouTubeSetRef.current.has(candidate.videoId)) return;

                    console.log('[XHS] detected YouTube link from clipboard:', candidate.videoUrl);
                    setClipboardCandidate(candidate);
                    setCaptureStatus('idle');
                    setCaptureMessage('检测到剪贴板里的 YouTube 链接，是否开始后台采集？');
                    setIsCapturePromptOpen(true);
                } catch (error) {
                    console.warn('[XHS] read clipboard failed:', error);
                } finally {
                    clipboardPollingRef.current = false;
                }
            })();
        }, CLIPBOARD_POLL_INTERVAL_MS);

        return () => window.clearInterval(timer);
    }, [captureStatus, isCapturePromptOpen]);

    const schedulePostLoadTasks = useCallback((tabId: string) => {
        const timer = detectTimerRef.current[tabId];
        if (timer) {
            window.clearTimeout(timer);
        }

        detectTimerRef.current[tabId] = window.setTimeout(() => {
            void forceTabLayout(tabId);
            void checkForNote(tabId);
            void injectSaveButton(tabId);
            delete detectTimerRef.current[tabId];
        }, 1200);
    }, [checkForNote, forceTabLayout, injectSaveButton]);

    const handleNewTab = useCallback((targetUrl: string = DEFAULT_URL, activate = true) => {
        const tab = createTab(targetUrl);
        setTabs(prev => [...prev, tab]);
        if (activate) {
            setActiveTabId(tab.id);
            setAddressInput(tab.url);
        }
    }, []);

    const openNewTabWithDedupe = useCallback((targetUrl: string) => {
        const normalized = targetUrl.trim();
        if (!normalized) return;

        const now = Date.now();
        const last = lastOpenedTabRef.current;
        if (last && last.url === normalized && now - last.ts < 450) {
            return;
        }
        lastOpenedTabRef.current = { url: normalized, ts: now };
        handleNewTab(normalized, true);
    }, [handleNewTab]);

    useEffect(() => {
        const handleOpenInTab = (_event: unknown, payload?: { url?: string } | string) => {
            const url = typeof payload === 'string' ? payload : payload?.url;
            if (!url || typeof url !== 'string') return;
            openNewTabWithDedupe(url);
        };

        window.ipcRenderer.on('xhs:open-in-tab', handleOpenInTab);
        return () => {
            window.ipcRenderer.off('xhs:open-in-tab', handleOpenInTab);
        };
    }, [openNewTabWithDedupe]);

    useEffect(() => {
        const timer = window.setInterval(() => {
            const tab = tabs.find(item => item.id === activeTabId);
            if (!tab) return;
            if (tab.isLoading) return;
            if (!tab.url.includes('xiaohongshu.com')) return;
            void checkForNote(tab.id, { retries: 1, intervalMs: 180 });
        }, 1800);
        return () => window.clearInterval(timer);
    }, [tabs, activeTabId, checkForNote]);

    const handleCloseTab = useCallback((tabId: string) => {
        clearTimersForTab(tabId);
        delete webviewRefs.current[tabId];

        setTabs(prev => {
            if (prev.length === 1) {
                const next = createTab(DEFAULT_URL);
                setActiveTabId(next.id);
                setAddressInput(next.url);
                return [next];
            }

            const closeIndex = prev.findIndex(tab => tab.id === tabId);
            const nextTabs = prev.filter(tab => tab.id !== tabId);

            if (activeTabId === tabId) {
                const fallback = nextTabs[Math.max(0, closeIndex - 1)] || nextTabs[0];
                if (fallback) {
                    setActiveTabId(fallback.id);
                    setAddressInput(fallback.url);
                }
            }

            return nextTabs;
        });
    }, [activeTabId, clearTimersForTab]);

    const handleSwitchTab = useCallback((tabId: string) => {
        setActiveTabId(tabId);
        const tab = tabs.find(item => item.id === tabId);
        if (tab) {
            setAddressInput(tab.url);
        }
    }, [tabs]);

    const handleRefChange = useCallback((tabId: string, webview: WebViewElement | null) => {
        webviewRefs.current[tabId] = webview;
    }, []);

    const handleElementLayout = useCallback((tabId: string, snapshot: ElementLayoutSnapshot) => {
        setElementSnapshots(prev => ({ ...prev, [tabId]: snapshot }));
    }, []);

    const handleAddressSubmit = useCallback((event: FormEvent) => {
        event.preventDefault();

        if (!activeTabId) return;

        const targetUrl = normalizeUrl(addressInput);
        const webview = webviewRefs.current[activeTabId];

        updateTab(activeTabId, { url: targetUrl, note: null });

        if (webview && typeof webview.loadURL === 'function') {
            webview.loadURL(targetUrl);
            return;
        }

        const replacementTab = createTab(targetUrl);
        replacementTab.id = activeTabId;
        setTabs(prev => prev.map(tab => (tab.id === activeTabId ? replacementTab : tab)));
    }, [activeTabId, addressInput, updateTab]);

    const handleGoBack = useCallback(() => {
        if (!activeTabId) return;

        const webview = webviewRefs.current[activeTabId];
        if (!webview?.canGoBack?.()) return;

        webview.goBack();
        window.setTimeout(() => syncTabNavState(activeTabId), 120);
    }, [activeTabId, syncTabNavState]);

    const handleGoForward = useCallback(() => {
        if (!activeTabId) return;

        const webview = webviewRefs.current[activeTabId];
        if (!webview?.canGoForward?.()) return;

        webview.goForward();
        window.setTimeout(() => syncTabNavState(activeTabId), 120);
    }, [activeTabId, syncTabNavState]);

    const handleRefresh = useCallback(() => {
        if (!activeTabId) return;

        const webview = webviewRefs.current[activeTabId];
        if (!webview) return;

        webview.reload();
    }, [activeTabId]);

    const handleDidStartLoading = useCallback((tabId: string) => {
        updateTab(tabId, { isLoading: true });
    }, [updateTab]);

    const handleDidStopLoading = useCallback((tabId: string) => {
        updateTab(tabId, { isLoading: false });
        syncTabNavState(tabId);
        schedulePostLoadTasks(tabId);
        void applyWebNightFilterToTab(tabId, isWebNightFilterEnabled);
    }, [applyWebNightFilterToTab, isWebNightFilterEnabled, schedulePostLoadTasks, syncTabNavState, updateTab]);

    const handleDidNavigate = useCallback((tabId: string, url: string) => {
        updateTab(tabId, { url, note: null });
        syncTabNavState(tabId, url);
        schedulePostLoadTasks(tabId);
    }, [schedulePostLoadTasks, syncTabNavState, updateTab]);

    const handleTitleUpdated = useCallback((tabId: string, title: string) => {
        setTabs(prev => prev.map(tab => (
            tab.id === tabId
                ? { ...tab, title: formatTabTitle(title, tab.url) }
                : tab
        )));
    }, []);

    const handleOpenInNewTab = useCallback((url: string) => {
        if (!url) return;
        openNewTabWithDedupe(url);
    }, [openNewTabWithDedupe]);

    const handleConsoleMessage = useCallback((tabId: string, message: string) => {
        if (message.includes(SAVE_TRIGGER_MARKER)) {
            void saveNoteFromTab(tabId);
        }
    }, [saveNoteFromTab]);

    const handleDomReady = useCallback((tabId: string) => {
        void forceTabLayout(tabId);
        syncTabNavState(tabId);
        schedulePostLoadTasks(tabId);
        void applyWebNightFilterToTab(tabId, isWebNightFilterEnabled);
    }, [applyWebNightFilterToTab, forceTabLayout, isWebNightFilterEnabled, schedulePostLoadTasks, syncTabNavState]);

    const activeSaveStatus = activeTab?.saveStatus ?? 'idle';
    const activeNote = activeTab?.note ?? null;
    const activeLayoutSnapshot = activeTab ? layoutSnapshots[activeTab.id] : undefined;
    const activeElementSnapshot = activeTab ? elementSnapshots[activeTab.id] : undefined;

    return (
        <div className="flex-1 min-h-0 flex flex-col bg-surface-primary relative">
            {/* 顶部 Tab 栏 */}
            <div className="h-10 border-b border-border bg-surface-secondary flex items-center px-2 gap-2 overflow-x-auto">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => handleSwitchTab(tab.id)}
                        className={`group min-w-[180px] max-w-[240px] h-8 px-3 rounded-md flex items-center gap-2 text-xs border transition-colors ${
                            tab.id === activeTabId
                                ? 'bg-surface-primary text-text-primary border-border shadow-sm'
                                : 'bg-surface-primary/50 text-text-secondary border-transparent hover:border-border'
                        }`}
                    >
                        {tab.isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                        <span className="truncate flex-1 text-left">{formatTabTitle(tab.title, tab.url)}</span>
                        <span
                            role="button"
                            onClick={(event) => {
                                event.stopPropagation();
                                handleCloseTab(tab.id);
                            }}
                            className="w-4 h-4 inline-flex items-center justify-center rounded-sm text-text-tertiary hover:bg-surface-secondary hover:text-text-primary"
                        >
                            <X className="w-3 h-3" />
                        </span>
                    </button>
                ))}

                <button
                    onClick={() => handleNewTab(DEFAULT_URL, true)}
                    className="h-8 w-8 rounded-md border border-border text-text-secondary hover:text-text-primary hover:bg-surface-primary inline-flex items-center justify-center"
                    title="新建标签页"
                >
                    <Plus className="w-4 h-4" />
                </button>
            </div>

            {/* 地址栏 */}
            <form onSubmit={handleAddressSubmit} className="h-11 border-b border-border bg-surface-secondary/70 flex items-center gap-2 px-3">
                <button
                    type="button"
                    onClick={handleGoBack}
                    disabled={!activeTab?.canGoBack}
                    className="h-8 w-8 rounded-md border border-border text-text-secondary hover:text-text-primary hover:bg-surface-primary inline-flex items-center justify-center disabled:opacity-40"
                    title="后退"
                >
                    <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                    type="button"
                    onClick={handleGoForward}
                    disabled={!activeTab?.canGoForward}
                    className="h-8 w-8 rounded-md border border-border text-text-secondary hover:text-text-primary hover:bg-surface-primary inline-flex items-center justify-center disabled:opacity-40"
                    title="前进"
                >
                    <ChevronRight className="w-4 h-4" />
                </button>
                <button
                    type="button"
                    onClick={handleRefresh}
                    className="h-8 w-8 rounded-md border border-border text-text-secondary hover:text-text-primary hover:bg-surface-primary inline-flex items-center justify-center"
                    title="刷新"
                >
                    <RefreshCw className="w-4 h-4" />
                </button>

                <input
                    value={addressInput}
                    onChange={(event) => setAddressInput(event.target.value)}
                    className="flex-1 h-8 rounded-md border border-border bg-surface-primary px-3 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
                    placeholder="输入网址或关键词（回车搜索）"
                />
            </form>

            {/* Webview 容器 */}
            <div className="flex-1 min-h-0 relative">
                {activeTab ? (
                    <ManagedWebview
                        key={activeTab.id}
                        tab={activeTab}
                        onRefChange={handleRefChange}
                        onElementLayout={handleElementLayout}
                        onDidStartLoading={handleDidStartLoading}
                        onDidStopLoading={handleDidStopLoading}
                        onDidNavigate={handleDidNavigate}
                        onTitleUpdated={handleTitleUpdated}
                        onOpenInNewTab={handleOpenInNewTab}
                        onConsoleMessage={handleConsoleMessage}
                        onDomReady={handleDomReady}
                    />
                ) : null}
            </div>

            {/* 底部工具栏 */}
            <div className="h-14 flex items-center justify-between px-4 border-t border-border bg-surface-secondary">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => {
                            if (!activeTabId) return;
                            void forceTabLayout(activeTabId);
                            void checkForNote(activeTabId, { retries: 6, intervalMs: 220 });
                            void injectSaveButton(activeTabId);
                        }}
                        className="flex items-center gap-1 h-8 px-3 text-xs text-text-secondary hover:text-text-primary border border-border rounded-md hover:bg-surface-primary transition-colors"
                    >
                        <RefreshCw className="w-3 h-3" />
                        刷新检测
                    </button>
                    <button
                        onClick={() => setIsWebNightFilterEnabled((prev) => !prev)}
                        className="flex items-center gap-1 h-8 px-3 text-xs text-text-secondary hover:text-text-primary border border-border rounded-md hover:bg-surface-primary transition-colors"
                        title={isWebNightFilterEnabled ? '关闭网页夜间滤镜' : '开启网页夜间滤镜'}
                    >
                        {isWebNightFilterEnabled ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                        网页夜间
                    </button>
                    <span className="text-xs text-text-tertiary">小红书浏览器</span>
                    {activeLayoutSnapshot && (
                        <span className="text-[11px] text-text-tertiary">
                            WV {activeLayoutSnapshot.width}x{activeLayoutSnapshot.height} · VP {activeLayoutSnapshot.viewportWidth}
                        </span>
                    )}
                    {activeElementSnapshot && (
                        <span className="text-[11px] text-text-tertiary">
                            EL {activeElementSnapshot.webviewWidth}x{activeElementSnapshot.webviewHeight} · HOST {activeElementSnapshot.hostWidth}x{activeElementSnapshot.hostHeight}
                        </span>
                    )}
                </div>

                {activeNote?.isNote ? (
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 text-sm text-text-secondary">
                            <span className="px-2 py-1 bg-accent-primary/10 text-accent-primary rounded text-xs">
                                {activeNote.noteType === 'video' ? '视频笔记' : '图文笔记'}
                            </span>
                            <span className="max-w-[240px] truncate">{activeNote.title}</span>
                        </div>
                        <button
                            onClick={() => {
                                if (!activeTabId) return;
                                void saveNoteFromTab(activeTabId);
                            }}
                            disabled={activeSaveStatus === 'saving'}
                            className="flex items-center gap-2 h-9 px-4 bg-green-600 text-white text-sm rounded-md hover:bg-green-700 transition-colors disabled:opacity-50"
                        >
                            {activeSaveStatus === 'saving' ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : activeSaveStatus === 'success' ? (
                                <>
                                    <Download className="w-4 h-4" />
                                    已保存
                                </>
                            ) : activeSaveStatus === 'error' ? (
                                '保存失败'
                            ) : (
                                <>
                                    <Save className="w-4 h-4" />
                                    保存到知识库
                                </>
                            )}
                        </button>
                    </div>
                ) : (
                    <span className="text-sm text-text-tertiary">点击“刷新检测”识别笔记</span>
                )}
            </div>

            {isCapturePromptOpen && clipboardCandidate && (
                <div className="absolute inset-0 z-50 bg-black/35 flex items-center justify-center px-4">
                    <div className="w-full max-w-[560px] rounded-xl border border-border bg-surface-primary shadow-2xl p-5">
                        <div className="flex items-start gap-3">
                            <div className="h-10 w-10 rounded-lg bg-status-error/15 text-status-error inline-flex items-center justify-center shrink-0">
                                <Link2 className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <h3 className="text-base font-semibold text-text-primary">检测到 YouTube 链接</h3>
                                <p className="text-sm text-text-secondary mt-1">确认后将立即在后台采集并保存到知识库（YouTube）。</p>
                                <div className="mt-3 rounded-md border border-border bg-surface-secondary px-3 py-2 text-xs text-text-tertiary break-all">
                                    {clipboardCandidate.rawUrl}
                                </div>
                                <div className="mt-2 text-xs text-text-secondary">
                                    videoId: <span className="font-mono">{clipboardCandidate.videoId}</span>
                                </div>
                            </div>
                        </div>

                        {captureMessage && (
                            <div className={`mt-4 text-sm ${
                                captureStatus === 'error' ? 'text-status-error' : captureStatus === 'success' ? 'text-status-success' : 'text-text-secondary'
                            }`}>
                                {captureMessage}
                            </div>
                        )}

                        <div className="mt-5 flex items-center justify-end gap-2">
                            <button
                                onClick={closeCapturePrompt}
                                disabled={captureStatus === 'saving'}
                                className="h-9 px-4 rounded-md border border-border text-sm text-text-secondary hover:text-text-primary hover:bg-surface-secondary disabled:opacity-50"
                            >
                                取消
                            </button>
                            <button
                                onClick={() => void confirmCaptureFromClipboard()}
                                disabled={captureStatus === 'saving'}
                                className="h-9 px-4 rounded-md bg-red-600 text-white text-sm hover:bg-red-700 disabled:opacity-50 inline-flex items-center gap-2"
                            >
                                {captureStatus === 'saving' && <Loader2 className="w-4 h-4 animate-spin" />}
                                确认采集
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
