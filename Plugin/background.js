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

// Context Menu for Saving Text
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "save-to-redconvert",
    title: "保存选中文本到知识库",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "save-to-redconvert" && info.selectionText) {
    const text = info.selectionText;
    const url = tab.url;
    const title = tab.title;

    fetch('http://127.0.0.1:23456/api/save-text', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: text,
        url: url,
        title: title
      })
    })
    .then(response => response.json())
    .then(data => {
      console.log('Text saved:', data);
      // Optional: Show a notification
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/48.png',
        title: '已保存到 RedConvert',
        message: '文本已成功保存到您的知识库。'
      });
    })
    .catch(error => {
      console.error('Error saving text:', error);
       chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/48.png',
        title: '保存失败',
        message: '无法连接到 RedConvert 应用，请确保应用已启动。'
      });
    });
  }
});
