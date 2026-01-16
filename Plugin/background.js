// background.js

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'DOWNLOAD_ZIP_URL') {
    const { title, zipBlobUrl } = msg;
    chrome.downloads.download({
      url: zipBlobUrl,
      filename: `${title}.zip`,
      saveAs: false,
      conflictAction: 'uniquify'
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('下载 ZIP 失败：', chrome.runtime.lastError);
      } else {
        console.log(`ZIP 下载已发起，下载 ID = ${downloadId}`);
      }
    });
    // 下载发起后，Background 就可以结束本次循环
  }

  if (msg.action === 'DOWNLOAD_IMAGE_DIRECT') {
    const { url, filename } = msg;
    console.log('[XHS-DEBUG] Background 开始下载图片:', url, filename);
    chrome.downloads.download({
      url,
      filename,
      saveAs: false,
      conflictAction: 'uniquify'
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('[XHS-DEBUG] 图片下载失败：', chrome.runtime.lastError);
      } else {
        console.log(`[XHS-DEBUG] 图片下载已发起，下载 ID = ${downloadId}`);
      }
    });
  }

  if (msg.action === 'DOWNLOAD_TXT_DIRECT') {
    const { url, filename } = msg;
    console.log('[XHS-DEBUG] Background 开始下载正文txt:', url, filename);
    chrome.downloads.download({
      url,
      filename,
      saveAs: false,
      conflictAction: 'uniquify'
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('[XHS-DEBUG] 正文txt下载失败：', chrome.runtime.lastError);
      } else {
        console.log(`[XHS-DEBUG] 正文txt下载已发起，下载 ID = ${downloadId}`);
      }
    });
  }

  if (msg.action === 'DOWNLOAD_VIDEO_DIRECT') {
    const { url, filename } = msg;
    console.log('[XHS-DEBUG] Background 开始下载视频:', url, filename);
    chrome.downloads.download({
      url,
      filename,
      saveAs: false,
      conflictAction: 'uniquify'
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('[XHS-DEBUG] 视频下载失败：', chrome.runtime.lastError);
      } else {
        console.log(`[XHS-DEBUG] 视频下载已发起，下载 ID = ${downloadId}`);
      }
    });
  }

  if (msg.action === 'FOUND_VIDEO_SOURCE') {
    const { url } = msg;
    console.log('[XHS-DEBUG] Background 捕获到视频源地址:', url);
    // 可扩展为自动复制到剪贴板或通知用户
  }
});

// 自动检查更新功能
const GITHUB_LATEST_URL = 'https://github.com/Jamailar/RedConvert/releases/latest';
let lastCheckedVersion = null;

async function fetchLatestVersion() {
  try {
    const resp = await fetch(GITHUB_LATEST_URL, { redirect: 'follow' });
    const text = await resp.text();
    // 简单正则匹配版本号（如 v1.0.1 或 1.0.1）
    const match = text.match(/releases\/tag\/(v?\d+\.\d+(?:\.\d+)?)/i);
    if (match && match[1]) {
      return match[1].replace(/^v/, '');
    }
    // 兼容只显示版本号的情况
    const alt = text.match(/Latest.*?([\d.]+)/i);
    if (alt && alt[1]) return alt[1];
    return null;
  } catch (e) {
    return null;
  }
}

async function checkForUpdate() {
  const manifest = chrome.runtime.getManifest();
  const currentVersion = manifest.version;
  const latestVersion = await fetchLatestVersion();
  if (latestVersion && latestVersion !== currentVersion && latestVersion !== lastCheckedVersion) {
    lastCheckedVersion = latestVersion;
    // 通知所有popup页面
    chrome.runtime.sendMessage({ action: 'UPDATE_AVAILABLE', latestVersion });
  }
}

// 启动时检查
checkForUpdate();
// 每24小时检查一次
setInterval(checkForUpdate, 24 * 60 * 60 * 1000);
