// popup.js

window.onload = () => {
  const detectEl = document.getElementById('note-detect-status');
  const infoEl = document.getElementById('note-info');
  const titleSpan = document.getElementById('title-text');
  const noticeEl = document.getElementById('note-notice');
  const btnDownload = document.getElementById('btn-download');

  // 1. 默认状态：检测中...
  detectEl.style.display = 'block';
  infoEl.style.display = 'none';
  noticeEl.style.display = 'none';

  // 2. 发送消息到 Content Script 询问是否笔记页
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, { action: 'CHECK_IF_NOTE_PAGE' }, (resp) => {
      if (resp && resp.isNote) {
        // 是笔记页
        detectEl.style.display = 'none';
        // 标题处理：若过长截断
        const rawTitle = resp.title || '笔记';
        const displayTitle = rawTitle.length > 30 
          ? rawTitle.slice(0, 27) + '...' 
          : rawTitle;
        titleSpan.innerText = displayTitle;
        infoEl.style.display = 'block';
      } else {
        // 不是笔记页
        detectEl.style.display = 'none';
        noticeEl.style.display = 'block';
      }
    });
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

  // 4. 点击 OCR 按钮事件
  const btnOcr = document.getElementById('btn-ocr');
  btnOcr.addEventListener('click', () => {
    window.open('image-tool.html', '_blank');
  });

  // AI图文仿写按钮
  const btnAiRewriteImage = document.getElementById('btn-ai-rewrite-image');
  btnAiRewriteImage.addEventListener('click', () => {
    window.open('image-tool.html', '_blank');
  });

  // 生成相似封面图按钮
  const btnGenerateCover = document.getElementById('btn-generate-cover');
  btnGenerateCover.addEventListener('click', () => {
    window.open('image-tool.html', '_blank');
  });

  // 设置按钮跳转到options.html
  document.getElementById('btn-settings').addEventListener('click', (e) => {
    e.preventDefault();
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open('options.html');
    }
  });

  // AI仿写按钮主流程
  const btnAiRewrite = document.getElementById('btn-ai-rewrite');
  const aiRewriteStatus = document.getElementById('ai-rewrite-status');
  btnAiRewrite.addEventListener('click', async () => {
    btnAiRewrite.innerText = 'AI仿写中...';
    btnAiRewrite.disabled = true;
    aiRewriteStatus.innerHTML = '<span class="loading-spinner"></span> 正在提取笔记内容...';
    console.log('[AI-DEBUG] 点击AI仿写，开始提取笔记内容');

    // 1. 获取当前tab笔记标题和正文
    let noteTitle = '';
    let noteText = '';
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const resp = await new Promise(resolve => {
        chrome.tabs.sendMessage(tab.id, { action: 'CHECK_IF_NOTE_PAGE' }, resolve);
      });
      console.log('[AI-DEBUG] CHECK_IF_NOTE_PAGE resp:', resp);
      if (resp && resp.isNote) {
        noteTitle = resp.title || '';
        // 获取正文内容
        const textResp = await new Promise(resolve => {
          chrome.tabs.sendMessage(tab.id, { action: 'GET_NOTE_TEXT' }, resolve);
        });
        noteText = textResp && textResp.text ? textResp.text : '';
        console.log('[AI-DEBUG] 获取到标题:', noteTitle);
        console.log('[AI-DEBUG] 获取到正文:', noteText);
      } else {
        aiRewriteStatus.innerText = '未检测到笔记内容，无法AI仿写。';
        btnAiRewrite.innerText = '🤖 AI仿写';
        btnAiRewrite.disabled = false;
        return;
      }
    } catch (e) {
      aiRewriteStatus.innerText = '获取笔记内容失败。';
      btnAiRewrite.innerText = '🤖 AI仿写';
      btnAiRewrite.disabled = false;
      console.error('[AI-DEBUG] 获取笔记内容异常:', e);
      return;
    }

    aiRewriteStatus.innerText = '正在读取AI设置...';
    // 2. 读取AI设置
    chrome.storage.local.get([
      'ai_api_base_url',
      'ai_api_key',
      'ai_model',
      //'ai_system_prompt', // 系统提示词将硬编码
      'ai_target_domain',
      'ai_rewrite_requirement',
      'ai_example_format',
      'ai_personalization'
    ], async (cfg) => {
      // 系统提示词硬编码（支持占位符）
      // 例：const SYSTEM_PROMPT = '你是一名{{domain}}领域的内容改写助手，要求：{{requirement}}。输出格式：{{format}}。';
      const SYSTEM_PROMPT = '你是一名专业的小红书内容创作者，我会发给你一篇流量很好的小红书内容笔记，你需要吸收其值得借鉴贵优点，然后写一篇和{{domain}}目标/领域的相似的内容（非常重要），你需要自己寻找{{domain}}领域的切入点，然后再创作，要求：{{requirement}}。输出语言风格参考（可选）：{{format}}。如果需要用到个人信息，个性化信息：{{personalization}}。下面发给你你需要仿写的内容，只需要发给你你写出的最后的标题和正文，不需要其他内容：'; // <-- 在这里自定义模板
      // 动态替换占位符
      function renderSystemPrompt(domain, requirement, format, personalization) {
        return SYSTEM_PROMPT
          .replace(/{{domain}}/g, domain || '')
          .replace(/{{requirement}}/g, requirement || '')
          .replace(/{{format}}/g, format || '')
          .replace(/{{personalization}}/g, personalization || '');
      }
      // 校验必填项（除示范格式外）
      if (!cfg.ai_api_base_url || !cfg.ai_api_key || !cfg.ai_model) {
        aiRewriteStatus.innerText = '请先在设置中填写完整的AI接口信息。';
        btnAiRewrite.innerText = '🤖 AI仿写';
        btnAiRewrite.disabled = false;
        // 高亮设置按钮并弹窗
        const btnSettings = document.getElementById('btn-settings');
        btnSettings.style.color = '#F6451D';
        btnSettings.style.fontWeight = 'bold';
        setTimeout(() => { btnSettings.style.color = '#888'; btnSettings.style.fontWeight = 'normal'; }, 2000);
        alert('请先在设置中填写完整的AI接口信息！');
        return;
      }
      // 3. 拼接prompt
      let userPrompt = `【原文标题】\n${noteTitle}\n\n【原文内容】\n${noteText}`;
      // 4. 组装OpenAI风格请求体
      const systemPromptFinal = renderSystemPrompt(cfg.ai_target_domain, cfg.ai_rewrite_requirement, cfg.ai_example_format, cfg.ai_personalization);
      console.log('[AI-DEBUG] 最终系统提示词:', systemPromptFinal);
      console.log('[AI-DEBUG] 最终用户提示词:', userPrompt);
      const messages = [
        { role: 'system', content: systemPromptFinal },
        { role: 'user', content: userPrompt }
      ];
      console.log('[AI-DEBUG] 最终发送给AI的messages:', JSON.stringify(messages, null, 2));
      aiRewriteStatus.innerText = '正在请求AI生成仿写内容...';
      // 5. 调用AI接口
      try {
        // 按示范严格组装Headers和body
        var myHeaders = new Headers();
        myHeaders.append('Authorization', 'Bearer ' + cfg.ai_api_key);
        myHeaders.append('Content-Type', 'application/json');
        var raw = JSON.stringify({
          model: cfg.ai_model,
          messages
        });
        var requestOptions = {
          method: 'POST',
          headers: myHeaders,
          body: raw,
          redirect: 'follow'
        };
        console.log('[AI-DEBUG] fetch请求参数:', cfg.ai_api_base_url + '/chat/completions', requestOptions);
        const resp = await fetch(cfg.ai_api_base_url.replace(/\/$/, '') + '/chat/completions', requestOptions);
        const text = await resp.text();
        console.log('[AI-DEBUG] AI接口响应状态:', resp.status);
        console.log('[AI-DEBUG] AI接口响应内容:', text);
        if (!resp.ok) throw new Error('AI接口请求失败');
        let data;
        try { data = JSON.parse(text); } catch(e) { data = null; }
        let aiText = '';
        if (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) {
          aiText = data.choices[0].message.content.trim();
        } else if (data && data.text) {
          aiText = data.text.trim();
        } else {
          aiText = '[AI未返回内容]';
        }
        aiRewriteStatus.innerHTML = `<div class="ai-result-box" style='white-space:pre-wrap;'>${aiText}</div><button id='btn-copy-ai' style='margin-top:8px;font-size:13px;'>复制仿写内容</button>`;
        document.getElementById('btn-copy-ai').onclick = () => {
          navigator.clipboard.writeText(aiText);
          aiRewriteStatus.innerHTML += '<span style=\"color:#0a0;margin-left:8px;\">已复制！</span>';
        };
      } catch (err) {
        aiRewriteStatus.innerText = 'AI接口请求失败：' + err.message;
        console.error('[AI-DEBUG] AI接口请求异常:', err);
      }
      btnAiRewrite.innerText = '🤖 AI仿写';
      btnAiRewrite.disabled = false;
    });
  });

  // 动态显示manifest.json中的版本号
  const versionInfo = document.getElementById('version-info');
  if (versionInfo && chrome.runtime.getManifest) {
    versionInfo.textContent = 'v' + chrome.runtime.getManifest().version;
  }

  // 主动检查更新
  const GITHUB_LATEST_URL = 'https://github.com/Jamailar/RedConvert/releases/latest';
  function showUpdateBanner(latestVersion) {
    if (document.getElementById('update-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'update-banner';
    banner.style.cssText = 'background:#F6451D;color:#fff;padding:8px 0;text-align:center;font-size:14px;font-weight:bold;cursor:pointer;position:fixed;left:16px;right:16px;bottom:48px;z-index:9;border-radius:6px;margin:0 0 8px 0;';
    banner.innerHTML = `发现新版本 v${latestVersion}，点击前往下载`;
    banner.onclick = () => {
      window.open('https://github.com/Jamailar/RedConvert/releases/latest', '_blank');
    };
    // 插入到设置按钮上方（footer上方）
    document.body.appendChild(banner);
  }

  async function checkForUpdate() {
    try {
      const resp = await fetch(GITHUB_LATEST_URL, { redirect: 'follow' });
      // 直接用 resp.url 提取版本号
      const url = resp.url || '';
      const match = url.match(/releases\/tag\/(v?\d+(?:\.\d+)+)/i);
      let latestVersion = null;
      if (match && match[1]) {
        latestVersion = match[1].replace(/^v/, '');
      }
      const currentVersion = chrome.runtime.getManifest().version;
      if (latestVersion && latestVersion !== currentVersion) {
        showUpdateBanner(latestVersion);
      }
    } catch (e) {
      // 可选：console.warn('检查更新失败', e);
    }
  }
  checkForUpdate();

  // 监听后台更新消息
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'UPDATE_AVAILABLE' && msg.latestVersion) {
      showUpdateBanner(msg.latestVersion);
    }
  });
};
