// popup.js

window.onload = () => {
  const detectEl = document.getElementById('note-detect-status');
  const infoEl = document.getElementById('note-info');
  const titleSpan = document.getElementById('title-text');
  const noticeEl = document.getElementById('note-notice');
  const btnDownload = document.getElementById('btn-download');

  // YouTube 相关元素
  const youtubeInfoEl = document.getElementById('youtube-info');
  const youtubeTitleSpan = document.getElementById('youtube-title-text');
  const btnSaveYoutube = document.getElementById('btn-save-youtube');
  const youtubeSaveStatus = document.getElementById('youtube-save-status');
  const YOUTUBE_API = 'http://127.0.0.1:23456/api/youtube-notes';

  // 1. 默认状态：检测中...
  detectEl.style.display = 'block';
  infoEl.style.display = 'none';
  noticeEl.style.display = 'none';
  youtubeInfoEl.style.display = 'none';

  // 2. 发送消息到 Content Script 询问是否笔记页或YouTube页
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tabId = tabs[0].id;
    const tabUrl = tabs[0].url || '';

    // 检查是否是 YouTube 页面
    if (tabUrl.includes('youtube.com/watch')) {
      // 先尝试注入 content script（如果尚未注入）
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['youtube-content.js']
        });
      } catch (e) {
        console.log('[RC Plugin] Script already injected or injection failed:', e.message);
      }

      // 等待一小段时间让脚本初始化
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, { action: 'CHECK_IF_YOUTUBE_PAGE' }, (resp) => {
          detectEl.style.display = 'none';

          // 检查是否有错误（content script 未响应）
          if (chrome.runtime.lastError) {
            console.log('[RC Plugin] Error:', chrome.runtime.lastError.message);
            // 直接从 URL 提取 videoId 并显示 YouTube 界面
            const urlParams = new URLSearchParams(new URL(tabUrl).search);
            const videoId = urlParams.get('v');
            if (videoId) {
              youtubeTitleSpan.innerText = '检测到 YouTube 视频';
              youtubeInfoEl.style.display = 'block';
            } else {
              noticeEl.innerText = '未检测到YouTube视频，请刷新页面后重试';
              noticeEl.style.display = 'block';
            }
            return;
          }

          if (resp && resp.isYouTube) {
            // 是 YouTube 视频页
            const rawTitle = resp.title || '视频';
            const displayTitle = rawTitle.length > 40
              ? rawTitle.slice(0, 37) + '...'
              : rawTitle;
            youtubeTitleSpan.innerText = displayTitle;
            youtubeInfoEl.style.display = 'block';
          } else {
            // 即使 content script 返回失败，只要 URL 匹配就显示 YouTube 界面
            const urlParams = new URLSearchParams(new URL(tabUrl).search);
            const videoId = urlParams.get('v');
            if (videoId) {
              youtubeTitleSpan.innerText = '检测到 YouTube 视频';
              youtubeInfoEl.style.display = 'block';
            } else {
              noticeEl.innerText = '未检测到YouTube视频，请在视频页面使用';
              noticeEl.style.display = 'block';
            }
          }
        });
      }, 100);
    } else {
      // 检查小红书笔记页
      const checkNotePage = () => {
        chrome.tabs.sendMessage(tabId, { action: 'CHECK_IF_NOTE_PAGE' }, (resp) => {
          if (chrome.runtime.lastError) {
            console.log('[RC Plugin] Error:', chrome.runtime.lastError.message);
            detectEl.style.display = 'none';
            noticeEl.style.display = 'block';
            return;
          }

          if (resp && resp.isNote) {
            // 是笔记页
            detectEl.style.display = 'none';
            const rawTitle = resp.title || '笔记';
            const displayTitle = rawTitle.length > 30
              ? rawTitle.slice(0, 27) + '...'
              : rawTitle;
            titleSpan.innerText = displayTitle;
            infoEl.style.display = 'block';

            // 更新保存按钮文案
            const noteType = resp.noteType === 'video' ? '视频' : '图文';
            document.getElementById('btn-save-workstation').innerText = `💾 保存${noteType}到AI工作台`;
          } else {
            // 不是笔记页（可能是异步加载，延迟再试）
            if (tabUrl.includes('xiaohongshu.com/discovery/item/')) {
              setTimeout(() => checkNotePage(), 600);
              return;
            }
            detectEl.style.display = 'none';
            noticeEl.style.display = 'block';
          }
        });
      };

      checkNotePage();
    }
  });

  // 3. 点击 下载 按钮 事件
  btnDownload.addEventListener('click', () => {
    btnDownload.innerText = '正在打包...';
    btnDownload.disabled = true;

    // 通知 Content Script 进行抓取并打包
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'MANUAL_SCRAPE' });
      // 关闭 Popup（MVP 选择直接关闭）
      window.close();
    });
  });

  // YouTube 保存按钮事件
  btnSaveYoutube.addEventListener('click', async () => {
    btnSaveYoutube.disabled = true;
    btnSaveYoutube.innerText = '正在保存...';
    youtubeSaveStatus.innerText = '⏳ 正在获取视频信息...';
    youtubeSaveStatus.style.color = '#FF0000';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // 获取视频数据
      const videoData = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tab.id, { action: 'GET_YOUTUBE_VIDEO_DATA' }, (resp) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (resp && resp.success) {
            resolve(resp.data);
          } else {
            reject(new Error(resp?.error || '获取视频数据失败'));
          }
        });
      });

      youtubeSaveStatus.innerText = '⏳ 正在连接AI工作台...';

      // 发送到桌面端API
      const response = await fetch(YOUTUBE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(videoData)
      });

      if (!response.ok) {
        throw new Error('工作台连接失败，请确保桌面应用已启动');
      }

      const result = await response.json();

      if (result.success) {
        youtubeSaveStatus.innerText = '✅ 已保存到知识库！';
        youtubeSaveStatus.style.color = '#22c55e';
        btnSaveYoutube.innerText = '✅ 保存成功';
      } else {
        throw new Error(result.error || '保存失败');
      }
    } catch (err) {
      console.error('[YOUTUBE-SAVE-ERROR]', err);
      youtubeSaveStatus.innerText = '❌ ' + err.message;
      youtubeSaveStatus.style.color = '#ef4444';
      btnSaveYoutube.innerText = '📺 保存视频到知识库';
      btnSaveYoutube.disabled = false;
    }
  });

  // 3.5 保存到个人档案按钮 (已注释)
  /*
  const btnSaveArchive = document.getElementById('btn-save-archive');
  const archiveSaveStatus = document.getElementById('archive-save-status');
  const archiveSelect = document.getElementById('archive-select');
  const ARCHIVE_LIST_API = 'http://127.0.0.1:23456/api/archives';
  const ARCHIVE_SAVE_API = 'http://127.0.0.1:23456/api/archives/samples';

  async function loadArchives() {
    try {
      const response = await fetch(ARCHIVE_LIST_API);
      if (!response.ok) throw new Error('无法获取档案列表');
      const data = await response.json();
      const profiles = data.profiles || [];

      archiveSelect.innerHTML = '';
      if (profiles.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = '暂无档案，请先在桌面端创建';
        archiveSelect.appendChild(option);
        btnSaveArchive.disabled = true;
        return;
      }

      profiles.forEach((profile) => {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = `${profile.name} ${profile.platform ? `· ${profile.platform}` : ''}`;
        archiveSelect.appendChild(option);
      });
    } catch (error) {
      archiveSelect.innerHTML = '<option value=\"\">无法连接桌面端</option>';
      btnSaveArchive.disabled = true;
    }
  }

  loadArchives();

  btnSaveArchive.addEventListener('click', async () => {
    btnSaveArchive.disabled = true;
    btnSaveArchive.innerText = '正在保存...';
    archiveSaveStatus.innerText = '⏳ 正在获取笔记数据...';
    archiveSaveStatus.style.color = '#667eea';

    try {
      // 获取当前tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // 获取笔记数据
      const noteData = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tab.id, { action: 'GET_FULL_NOTE_DATA' }, (resp) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (resp && resp.success) {
            resolve(resp.data);
          } else {
            reject(new Error(resp?.error || '获取笔记数据失败'));
          }
        });
      });

      archiveSaveStatus.innerText = '⏳ 正在连接AI工作台...';

      const profileId = archiveSelect.value;
      if (!profileId) {
        throw new Error('请先选择一个档案');
      }

      // 发送到桌面端API
      const payload = { ...noteData, text: noteData.content };
      const response = await fetch(ARCHIVE_SAVE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, profileId })
      });

      if (!response.ok) {
        throw new Error('工作台连接失败，请确保桌面应用已启动');
      }

      const result = await response.json();

      if (result.success) {
        archiveSaveStatus.innerText = '✅ 已保存到个人档案！';
        archiveSaveStatus.style.color = '#22c55e';
        btnSaveArchive.innerText = '✅ 保存成功';
      } else {
        throw new Error(result.error || '保存失败');
      }
    } catch (err) {
      console.error('[SAVE-ERROR]', err);
      archiveSaveStatus.innerText = '❌ ' + err.message;
      archiveSaveStatus.style.color = '#ef4444';
      btnSaveArchive.innerText = '💾 保存到个人档案';
      btnSaveArchive.disabled = false;
    }
  });
  */

  // 保存到工作台按钮
  const btnSaveWorkstation = document.getElementById('btn-save-workstation');
  const saveStatus = document.getElementById('save-status');
  const WORKSTATION_API = 'http://127.0.0.1:23456/api/notes';

  btnSaveWorkstation.addEventListener('click', async () => {
    btnSaveWorkstation.disabled = true;
    btnSaveWorkstation.innerText = '正在保存...';
    saveStatus.innerText = '⏳ 正在获取笔记数据...';
    saveStatus.style.color = '#10b981';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const noteData = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tab.id, { action: 'GET_FULL_NOTE_DATA' }, (resp) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (resp && resp.success) {
            resolve(resp.data);
          } else {
            reject(new Error(resp?.error || '获取笔记数据失败'));
          }
        });
      });

      saveStatus.innerText = '⏳ 正在连接AI工作台...';

      const payload = { ...noteData, text: noteData.content };
      const response = await fetch(WORKSTATION_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error('工作台连接失败，请确保桌面应用已启动');
      }

      const result = await response.json();

      if (result.success) {
        saveStatus.innerText = '✅ 已保存到知识库！';
        saveStatus.style.color = '#22c55e';
        btnSaveWorkstation.innerText = '✅ 保存成功';
      } else {
        throw new Error(result.error || '保存失败');
      }
    } catch (err) {
      console.error('[SAVE-ERROR]', err);
      saveStatus.innerText = '❌ ' + err.message;
      saveStatus.style.color = '#ef4444';
      btnSaveWorkstation.innerText = '💾 保存到AI工作台';
      btnSaveWorkstation.disabled = false;
    }
  });

  // 动态显示manifest.json中的版本号
  const versionInfo = document.getElementById('version-info');
  if (versionInfo && chrome.runtime.getManifest) {
    versionInfo.textContent = 'v' + chrome.runtime.getManifest().version;
  }
};
