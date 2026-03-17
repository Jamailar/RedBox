import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Loader2, Plus, RefreshCw, Save, X } from 'lucide-react';

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
const SAVE_TRIGGER_MARKER = '[RC_XHS_SAVE_TRIGGER]';

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
  return (
    document.querySelector('#detail-title')?.innerText.trim() ||
    document.querySelector('.title')?.innerText.trim() ||
    document.querySelector('.note-title')?.innerText.trim() ||
    '笔记'
  );
}

function getNoteTextEls() {
  let els = Array.from(document.querySelectorAll('#detail-desc .note-text'));
  if (els.length === 0) {
    els = Array.from(document.querySelectorAll('.desc .note-text'));
  }
  if (els.length === 0) {
    els = Array.from(document.querySelectorAll('.note-content .note-text'));
  }
  return els;
}

function getCurrentNoteImgEls() {
  let els = Array.from(document.querySelectorAll('.img-container img'));
  if (els.length === 0) {
    els = Array.from(document.querySelectorAll('.note-content .img-container img'));
  }
  return els;
}

function getCoverImageUrl() {
  const metaOg = document.querySelector('meta[property="og:image"], meta[name="og:image"]');
  if (metaOg && metaOg.getAttribute('content')) {
    return metaOg.getAttribute('content');
  }
  const videoEl = document.querySelector('video');
  if (videoEl && videoEl.getAttribute('poster')) {
    return videoEl.getAttribute('poster');
  }
  const firstImg = getCurrentNoteImgEls()[0];
  if (firstImg) {
    return firstImg.getAttribute('src') || firstImg.getAttribute('data-src');
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
  const state = getInitialState();
  if (!state) return urls;
  try {
    const detailMap = state?.note?.noteDetailMap || {};
    const keys = Object.keys(detailMap);
    if (keys.length > 0) {
      const currentId = location.pathname.split('/').pop();
      const targetId = keys.find(k => k === currentId) || keys[0];
      const noteItem = detailMap[targetId];
      const stream = noteItem?.note?.video?.media?.stream?.h264;
      if (Array.isArray(stream) && stream.length > 0) {
        stream.forEach((item) => {
          pushUniqueUrl(urls, item?.masterUrl);
          if (Array.isArray(item?.backupUrls)) {
            item.backupUrls.forEach((backup) => pushUniqueUrl(urls, backup));
          }
        });
      }
    }
  } catch (e) {
    console.warn('[XHS] parse state video failed, fallback to DFS', e);
  }

  const masterUrl = findKeyInObject(state, 'masterUrl');
  if (masterUrl) pushUniqueUrl(urls, masterUrl);

  const backups = findKeyInObject(state, 'backupUrls');
  if (Array.isArray(backups) && backups.length > 0) {
    backups.forEach((backup) => pushUniqueUrl(urls, backup));
  }

  return urls;
}

function getCurrentNoteVideoUrls() {
  const urls = [];
  getVideoUrlsFromState().forEach((url) => pushUniqueUrl(urls, url));

  const videoEls = Array.from(document.querySelectorAll('video'));
  videoEls.forEach((videoEl) => {
    pushUniqueUrl(urls, videoEl?.src || '');
    const sourceEls = Array.from(videoEl.querySelectorAll('source'));
    sourceEls.forEach((source) => pushUniqueUrl(urls, source?.src || ''));
  });

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
    const infoEl = document.querySelector('.info');
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
  const textSelectors = [
    '#detail-desc .note-text',
    '.desc .note-text',
    '.note-content .note-text'
  ];

  const hasText = textSelectors.some((selector) => !!document.querySelector(selector));
  const imageCount = getCurrentNoteImgEls().length;
  const videoUrls = getCurrentNoteVideoUrls();
  const videoCount = videoUrls.length;
  const hasImage = imageCount > 0;
  const hasVideo = videoCount > 0;
  const hasStateData = hasNoteDataInState();
  const isNote = hasText || hasImage || hasVideo || hasStateData;
  // 规则：只有 1 个视频且无图片时才判定为视频笔记
  const isVideoNote = videoCount === 1 && imageCount === 0;

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

  const images = getCurrentNoteImgEls()
    .map((img) => img.getAttribute('src') || img.getAttribute('data-src'))
    .filter((src) => src && src.startsWith('https://'))
    .slice(0, 9);
  const videoUrls = getCurrentNoteVideoUrls();
  // 规则：只有 1 个视频且无图片时才保留视频链接；其余情况按图文处理（丢弃 live mp4）
  const isVideoNote = videoUrls.length === 1 && images.length === 0;
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
        webview.setAttribute('src', tab.url);
        webview.setAttribute('webpreferences', 'contextIsolation=yes');
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

    const webviewRefs = useRef<Record<string, WebViewElement | null>>({});
    const detectTimerRef = useRef<Record<string, number>>({});
    const saveResetTimerRef = useRef<Record<string, number>>({});
    const lastOpenedTabRef = useRef<{ url: string; ts: number } | null>(null);

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

    const checkForNote = useCallback(async (tabId: string) => {
        const result = await runScriptInTab<NoteDetection>(tabId, DETECT_NOTE_SCRIPT);
        if (!result) return;

        updateTab(tabId, { note: result });
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
        setTabSaveStatus(tabId, 'saving');

        try {
            const noteData = await runScriptInTab<NotePayload>(tabId, GET_NOTE_DATA_SCRIPT);
            if (!noteData) {
                throw new Error('未获取到笔记数据');
            }

            const hasMedia = Array.isArray(noteData.images) && noteData.images.length > 0;
            const hasText = Boolean(noteData.content?.trim());
            const hasVideo = Boolean(noteData.videoUrl);

            if (!hasMedia && !hasText && !hasVideo) {
                throw new Error('笔记内容为空');
            }

            const response = await fetch(NOTES_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(noteData),
            });

            const result = await response.json().catch(() => null) as { success?: boolean; error?: string } | null;

            if (!response.ok || result?.success === false) {
                throw new Error(result?.error || '保存失败');
            }

            setTabSaveStatus(tabId, 'success', true);
            await checkForNote(tabId);
        } catch (error) {
            console.error('[XHS] 保存失败:', error);
            setTabSaveStatus(tabId, 'error', true);
        }
    }, [checkForNote, runScriptInTab, setTabSaveStatus]);

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
    }, [schedulePostLoadTasks, syncTabNavState, updateTab]);

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
    }, [forceTabLayout, schedulePostLoadTasks, syncTabNavState]);

    const activeSaveStatus = activeTab?.saveStatus ?? 'idle';
    const activeNote = activeTab?.note ?? null;
    const activeLayoutSnapshot = activeTab ? layoutSnapshots[activeTab.id] : undefined;
    const activeElementSnapshot = activeTab ? elementSnapshots[activeTab.id] : undefined;

    return (
        <div className="flex-1 min-h-0 flex flex-col bg-surface-primary">
            {/* 顶部 Tab 栏 */}
            <div className="h-10 border-b border-border bg-surface-secondary flex items-center px-2 gap-2 overflow-x-auto">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => handleSwitchTab(tab.id)}
                        className={`group min-w-[180px] max-w-[240px] h-8 px-3 rounded-md flex items-center gap-2 text-xs border transition-colors ${
                            tab.id === activeTabId
                                ? 'bg-white text-text-primary border-border shadow-sm'
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
                            void checkForNote(activeTabId);
                            void injectSaveButton(activeTabId);
                        }}
                        className="flex items-center gap-1 h-8 px-3 text-xs text-text-secondary hover:text-text-primary border border-border rounded-md hover:bg-surface-primary transition-colors"
                    >
                        <RefreshCw className="w-3 h-3" />
                        刷新检测
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
        </div>
    );
}
