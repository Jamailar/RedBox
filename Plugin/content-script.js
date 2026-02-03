// content-script.js

// 等待 selector 出现
function waitForSelector(selectors, timeout = 5000, interval = 200) {
  // selectors: string or array of strings
  const selectorArr = Array.isArray(selectors) ? selectors : [selectors];
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      for (const sel of selectorArr) {
        if (document.querySelector(sel)) {
          clearInterval(timer);
          resolve(sel);
          return;
        }
      }
      if (Date.now() - start > timeout) {
        clearInterval(timer);
        reject();
      }
    }, interval);
  });
}

// 文件名过滤
function sanitizeFileName(raw) {
  return raw.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50);
}

// 根据 URL 判断图片扩展
function getImageExtension(url) {
  if (url.includes('.webp') || url.includes('webp')) return 'webp';
  if (url.includes('.png')) return 'png';
  return 'jpg';
}

function parseCountText(value) {
  if (!value) return 0;
  const text = String(value).trim();
  const cleaned = text.replace(/[,\s]/g, '').replace(/[^0-9.\u4e07\u4ebf]/g, '');
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

// 获取标题，兼容多种结构
function getNoteTitle() {
  return (
    document.querySelector('#detail-title')?.innerText.trim() ||
    document.querySelector('.title')?.innerText.trim() ||
    document.querySelector('.note-title')?.innerText.trim() ||
    '笔记'
  );
}

function hasNoteDataInState() {
  try {
    const state = getInitialState();
    const detailMap = state?.note?.noteDetailMap || {};
    return Object.keys(detailMap).length > 0;
  } catch (e) {
    return false;
  }
}

// 获取作者信息
function getAuthorInfo() {
  try {
    // 查找作者信息容器
    const infoEl = document.querySelector('.info');
    if (!infoEl) return null;

    // 提取作者名称
    const usernameEl = infoEl.querySelector('.username');
    const authorName = usernameEl ? usernameEl.innerText.trim() : '';

    // 提取作者头像URL
    const avatarEl = infoEl.querySelector('.avatar-item');
    const avatarUrl = avatarEl ? avatarEl.getAttribute('src') : '';

    // 提取作者主页链接
    const profileLinkEl = infoEl.querySelector('a[href*="/user/profile/"]');
    const profileUrl = profileLinkEl ? profileLinkEl.getAttribute('href') : '';

    if (authorName) {
      return {
        name: authorName,
        avatar: avatarUrl,
        profile: profileUrl
      };
    }
    return null;
  } catch (err) {
    console.error('[XHS-DEBUG] 获取作者信息失败:', err);
    return null;
  }
}

// 获取正文段落，兼容多种结构
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

// 只获取当前笔记的图片节点
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
    return firstImg.getAttribute('src');
  }
  return null;
}

// 获取当前笔记的视频URL（支持多种结构）
function getCurrentNoteVideoUrl() {
  // 0. 优先尝试从 __INITIAL_STATE__ 获取无水印直链
  try {
    const stateUrl = getVideoUrlFromState();
    if (stateUrl) {
      console.log('[XHS-DEBUG] 从 State 获取到视频 URL:', stateUrl);
      return stateUrl;
    }
  } catch (e) {
    console.error('[XHS-DEBUG] 从 State 获取视频失败:', e);
  }

  // 1. 直接查找 <video src="...">
  let videoEl = document.querySelector('video');
  if (videoEl && videoEl.src) return videoEl.src;
  // 2. 查找 <video><source src="..."></video>
  if (videoEl) {
    const source = videoEl.querySelector('source');
    if (source && source.src) return source.src;
  }
  // 3. 兼容常见视频容器
  videoEl = document.querySelector('.video-container video') || document.querySelector('.note-video video');
  if (videoEl && videoEl.src) return videoEl.src;
  if (videoEl) {
    const source = videoEl.querySelector('source');
    if (source && source.src) return source.src;
  }
  // 4. 其他自定义结构可继续补充
  return null;
}

// 辅助函数：从页面 Script 标签提取 __INITIAL_STATE__
function getInitialState() {
  const scripts = document.querySelectorAll('script');
  for (const script of scripts) {
    if (script.textContent && script.textContent.includes('window.__INITIAL_STATE__=')) {
      try {
        // 提取 JSON 部分
        const jsonText = script.textContent
          .replace('window.__INITIAL_STATE__=', '')
          .replace(/undefined/g, 'null') // 处理 undefined
          .replace(/;$/, ''); // 去除末尾分号
        
        return JSON.parse(jsonText);
      } catch (e) {
        console.warn('[XHS-DEBUG] 解析 State JSON 失败', e);
      }
    }
  }
  return null;
}

// 辅助函数：从 State 中查找 masterUrl
function getVideoUrlFromState() {
  const state = getInitialState();
  if (!state) return null;

  // 1. 尝试直接路径匹配
  // 路径通常是 note.noteDetailMap[noteId].note.video.media.stream.h264[0].masterUrl
  try {
    const noteData = state.note || {};
    // 获取当前笔记ID，或者取第一个key
    const detailMap = noteData.noteDetailMap || {};
    const keys = Object.keys(detailMap);
    if (keys.length > 0) {
      // 优先匹配当前 URL 中的 ID
      const currentId = location.pathname.split('/').pop();
      const targetId = keys.find(k => k === currentId) || keys[0];
      const noteItem = detailMap[targetId];
      
      if (noteItem && noteItem.note && noteItem.note.video) {
        const stream = noteItem.note.video.media?.stream?.h264;
        if (Array.isArray(stream) && stream.length > 0) {
          // 优先取 masterUrl
          if (stream[0].masterUrl) return stream[0].masterUrl;
          // 其次取 backupUrls
          if (stream[0].backupUrls && stream[0].backupUrls.length > 0) {
            return stream[0].backupUrls[0];
          }
        }
      }
    }
  } catch (e) {
    console.warn('[XHS-DEBUG] State 路径解析失败，尝试 DFS');
  }

  // 2. 深度优先搜索 masterUrl
  // 如果路径变了，尝试暴力搜索包含 masterUrl 的键值
  let url = findKeyInObject(state, 'masterUrl');
  if (url) return url;

  // 3. 深度优先搜索 backupUrls
  const backups = findKeyInObject(state, 'backupUrls');
  if (Array.isArray(backups) && backups.length > 0) {
    return backups[0];
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

// 消息监听
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'CHECK_IF_NOTE_PAGE') {
    const textSelectors = [
      '#detail-desc .note-text',
      '.desc .note-text',
      '.note-content .note-text'
    ];
    const found = textSelectors.some(sel => document.querySelector(sel)) ||
      getCurrentNoteImgEls().length > 0 ||
      !!getCurrentNoteVideoUrl() ||
      hasNoteDataInState();
    const title = found ? getNoteTitle() : '';

    // Determine note type
    let noteType = 'image'; // default
    if (getCurrentNoteVideoUrl()) {
      noteType = 'video';
    }

    sendResponse({ isNote: found, title, noteType });
  }

  if (msg.action === 'MANUAL_SCRAPE') {
    waitForSelector([
      '#detail-desc .note-text',
      '.desc .note-text',
      '.note-content .note-text'
    ], 5000, 200)
      .then(() => {
        setTimeout(scrapeAndPackZip, 300);
      })
      .catch(() => {
        alert('笔记数据加载超时，请稍后重试');
      });
  }

  if (msg.action === 'GET_NOTE_TEXT') {
    const textEls = getNoteTextEls();
    const paragraphs = textEls.map(span => span.innerText.trim()).filter(Boolean);
    const fullText = paragraphs.join('\n\n');
    sendResponse({ text: fullText });
    return;
  }

  // 获取完整笔记数据（用于保存到工作台）
  if (msg.action === 'GET_FULL_NOTE_DATA') {
    try {
      const title = getNoteTitle();
      const textEls = getNoteTextEls();
      const content = textEls.map(span => span.innerText.trim()).filter(Boolean).join('\n\n');
      const authorInfo = getAuthorInfo();

      // 获取图片URL列表
      const imgEls = getCurrentNoteImgEls();
      const images = imgEls
        .map(img => img.getAttribute('src'))
        .filter(src => src && src.startsWith('https://'))
        .slice(0, 9); // 最多9张图

      const coverUrl = getCoverImageUrl();

      // 获取视频URL
      const videoUrl = getCurrentNoteVideoUrl();

      // 尝试获取互动数据
      let stats = { likes: 0, collects: 0 };
      try {
        const likeEl = Array.from(document.querySelectorAll('.like-wrapper .count,[class*="like-wrapper"] .count,[class*="like"] .count'))
          .find(el => !el.closest('.comments-el') && !el.closest('[class*="comments-el"]'));
        const collectEl = Array.from(document.querySelectorAll('.collect-wrapper .count,[class*="collect-wrapper"] .count,[class*="collect"] .count'))
          .find(el => !el.closest('.comments-el') && !el.closest('[class*="comments-el"]'));
        if (likeEl) stats.likes = parseCountText(likeEl.innerText);
        if (collectEl) stats.collects = parseCountText(collectEl.innerText);
      } catch (e) { }

      // 生成唯一ID
      const noteId = 'xhs_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

      sendResponse({
        success: true,
        data: {
          noteId,
          title,
          author: authorInfo?.name || '未知',
          content,
          images,
          coverUrl,
          videoUrl,
          stats,
          source: window.location.href
        }
      });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
    return true; // 表示异步响应
  }
});

// 主函数：打包正文和图片为ZIP
async function scrapeAndPackZip() {
  try {
    const rawTitle = getNoteTitle();
    const title = sanitizeFileName(rawTitle);
    console.log('[XHS-DEBUG] 抓取到标题:', rawTitle);

    const textEls = getNoteTextEls();
    console.log('[XHS-DEBUG] 正文节点数量:', textEls.length);
    const paragraphs = textEls.map(span => span.innerText.trim()).filter(Boolean);
    const fullText = paragraphs.join('\n\n');
    console.log('[XHS-DEBUG] 正文内容预览:', fullText.slice(0, 100));

    // 获取作者信息
    const authorInfo = getAuthorInfo();
    console.log('[XHS-DEBUG] 作者信息:', authorInfo);

    // 只抓取当前笔记的图片
    const imgEls = getCurrentNoteImgEls();
    let imgUrls = imgEls
      .map(img => img.getAttribute('src'))
      .filter(src => src && src.includes('https://sns-webpic-qc.xhscdn.com/'));
    // 去重
    imgUrls = Array.from(new Set(imgUrls));
    console.log('[XHS-DEBUG] 去重后图片数量:', imgUrls.length);
    imgUrls.forEach((url, idx) => {
      console.log(`[XHS-DEBUG] 当前笔记图片${idx + 1}:`, url);
    });

    if (imgUrls.length === 0 && !fullText) {
      alert('未找到任何图片或正文，无法打包。');
      return;
    }

    // 初始化 JSZip
    const zip = new JSZip();

    // 构建文本内容，包含作者信息
    let txtContent = `${rawTitle}\n\n${fullText}`;

    // 如果有作者信息，添加到文档末尾
    if (authorInfo) {
      txtContent += '\n\n---\n\nAuthor:';
      if (authorInfo.name) {
        txtContent += `\n姓名: ${authorInfo.name}`;
      }
      if (authorInfo.avatar) {
        txtContent += `\n头像: ${authorInfo.avatar}`;
      }
      if (authorInfo.profile) {
        txtContent += `\n主页: ${authorInfo.profile}`;
      }
    }

    zip.file(`${title}.txt`, txtContent);
    // 添加图片
    const imgFolder = zip.folder('images');
    const fetchTasks = imgUrls.map(async (url, idx) => {
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        const ext = getImageExtension(url);
        imgFolder.file(`img_${idx + 1}.${ext}`, blob);
      } catch (err) {
        console.error(`[XHS-DEBUG] 图片${idx + 1} 抓取失败:`, err);
      }
    });
    await Promise.all(fetchTasks);
    // 生成 ZIP Blob
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const zipBlobUrl = URL.createObjectURL(zipBlob);
    // 发送给 background 下载
    chrome.runtime.sendMessage({ action: 'DOWNLOAD_ZIP_URL', title, zipBlobUrl });
    console.log('[XHS-DEBUG] ZIP 打包完成，已发送下载请求:', title + '.zip');
    alert(`已开始下载压缩包：${title}.zip，请在浏览器下载列表查看。`);
    setTimeout(() => {
      URL.revokeObjectURL(zipBlobUrl);
    }, 30000);
  } catch (err) {
    console.error('[XHS-DEBUG] scrapeAndPackZip 异常：', err);
    alert('打包失败，请稍后重试');
  }
}
