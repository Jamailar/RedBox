// youtube-content.js - YouTube 视频页面内容脚本

console.log('[RC Plugin] YouTube content script loaded');

// 提取视频ID
function getVideoId() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('v');
}

// 提取视频信息
function extractVideoInfo() {
  const videoId = getVideoId();
  if (!videoId) {
    return null;
  }

  // 获取视频标题
  const titleElement = document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
                       document.querySelector('h1.title') ||
                       document.querySelector('#title h1');
  const title = titleElement?.textContent?.trim() || document.title.replace(' - YouTube', '');

  // 获取视频描述
  const descriptionElement = document.querySelector('#description-inline-expander yt-attributed-string') ||
                             document.querySelector('#description yt-formatted-string') ||
                             document.querySelector('#description');
  const description = descriptionElement?.textContent?.trim() || '';

  // 构建缩略图URL (使用最高分辨率)
  const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;

  return {
    videoId,
    videoUrl: window.location.href,
    title,
    description,
    thumbnailUrl
  };
}

// 检查是否是视频页面
function isVideoPage() {
  return window.location.pathname === '/watch' && getVideoId() !== null;
}

// 监听来自 popup 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[RC Plugin] YouTube received message:', request.action);

  if (request.action === 'CHECK_IF_YOUTUBE_PAGE') {
    const isVideo = isVideoPage();
    const info = isVideo ? extractVideoInfo() : null;
    sendResponse({
      isYouTube: isVideo,
      title: info?.title || '',
      videoId: info?.videoId || ''
    });
    return true;
  }

  if (request.action === 'GET_YOUTUBE_VIDEO_DATA') {
    const info = extractVideoInfo();
    if (info) {
      sendResponse({
        success: true,
        data: info
      });
    } else {
      sendResponse({
        success: false,
        error: '无法提取视频信息'
      });
    }
    return true;
  }

  return false;
});

// YouTube 是 SPA，需要监听 URL 变化
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    console.log('[RC Plugin] YouTube URL changed:', url);
  }
}).observe(document, { subtree: true, childList: true });
