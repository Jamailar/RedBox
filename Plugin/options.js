document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('ai-settings-form');
  const statusEl = document.getElementById('save-status');

  // 动态填充模型下拉框
  function fillModelSelect(models, selectedId) {
    const modelSel = document.getElementById('model');
    modelSel.innerHTML = '';
    if (Array.isArray(models) && models.length > 0) {
      models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.id;
        modelSel.appendChild(opt);
      });
      if (selectedId) modelSel.value = selectedId;
    } else {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '请先测试API';
      modelSel.appendChild(opt);
    }
  }

  // 加载已保存设置
  function loadSettings() {
    chrome.storage.local.get([
      'ai_api_base_url',
      'ai_api_key',
      'ai_model',
      'ai_target_domain',
      'ai_rewrite_requirement',
      'ai_example_format',
      'ai_personalization',
      'ai_models',
    ], (cfg) => {
      console.log('[AI-DEBUG][options] 读取到设置:', cfg);
      document.getElementById('api-base-url').value = cfg.ai_api_base_url || '';
      document.getElementById('api-key').value = cfg.ai_api_key || '';
      document.getElementById('target-domain').value = cfg.ai_target_domain || '';
      document.getElementById('rewrite-requirement').value = cfg.ai_rewrite_requirement || '';
      document.getElementById('example-format').value = cfg.ai_example_format || '';
      document.getElementById('personalization').value = cfg.ai_personalization || '';
      // 修复：无模型列表时也能显示已保存模型名
      const modelSel = document.getElementById('model');
      modelSel.innerHTML = '';
      if (Array.isArray(cfg.ai_models) && cfg.ai_models.length > 0) {
        cfg.ai_models.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = m.id;
          modelSel.appendChild(opt);
        });
        if (cfg.ai_model) modelSel.value = cfg.ai_model;
      } else if (cfg.ai_model) {
        // 没有模型列表但有已保存模型名
        const opt = document.createElement('option');
        opt.value = cfg.ai_model;
        opt.textContent = cfg.ai_model + '（已保存）';
        modelSel.appendChild(opt);
        modelSel.value = cfg.ai_model;
      } else {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '请先测试API';
        modelSel.appendChild(opt);
      }
    });
  }
  loadSettings();

  // API测试按钮逻辑
  document.getElementById('btn-test-api').onclick = async function() {
    const api = document.getElementById('api-base-url').value.trim();
    const key = document.getElementById('api-key').value.trim();
    const statusEl = document.getElementById('api-test-status');
    const btn = this;
    statusEl.textContent = '';
    btn.disabled = true;
    btn.textContent = '测试中...';
    let url = api.replace(/\/$/, '') + '/models';
    try {
      var myHeaders = new Headers();
      myHeaders.append('Authorization', 'Bearer ' + key);
      var requestOptions = { method: 'GET', headers: myHeaders, redirect: 'follow' };
      const resp = await fetch(url, requestOptions);
      const text = await resp.text();
      console.log('[AI-DEBUG][options] API测试响应:', resp.status, text);
      if (resp.status === 200) {
        btn.style.background = 'linear-gradient(90deg,#4caf50 0%,#43e97b 100%)';
        btn.style.color = '#fff';
        btn.textContent = '✅ 测试成功';
        statusEl.textContent = '';
        // 解析模型列表
        let data;
        try { data = JSON.parse(text); } catch(e) { data = null; }
        if (data && Array.isArray(data.data)) {
          const models = data.data.map(m => ({ id: m.id }));
          chrome.storage.local.set({ ai_models: models }, () => {
            fillModelSelect(models);
            console.log('[AI-DEBUG][options] 已保存模型列表:', models);
          });
        }
      } else {
        btn.style.background = '';
        btn.style.color = '';
        btn.textContent = '测试';
        statusEl.textContent = '❌ 失败';
        alert('API测试失败，状态码：' + resp.status + '\n' + text);
      }
    } catch (err) {
      btn.style.background = '';
      btn.style.color = '';
      btn.textContent = '测试';
      statusEl.textContent = '❌ 失败';
      alert('API测试异常：' + err.message);
      console.error('[AI-DEBUG][options] API测试异常:', err);
    } finally {
      setTimeout(() => {
        btn.disabled = false;
        if (btn.textContent !== '测试') btn.textContent = '测试';
      }, 2000);
    }
  };

  // 保存设置
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {
      ai_api_base_url: document.getElementById('api-base-url').value.trim(),
      ai_api_key: document.getElementById('api-key').value.trim(),
      ai_model: document.getElementById('model').value,
      ai_target_domain: document.getElementById('target-domain').value.trim(),
      ai_rewrite_requirement: document.getElementById('rewrite-requirement').value.trim(),
      ai_example_format: document.getElementById('example-format').value.trim(),
      ai_personalization: document.getElementById('personalization').value.trim(),
    };
    console.log('[AI-DEBUG][options] 保存设置:', data);
    chrome.storage.local.set(data, () => {
      statusEl.textContent = '设置已保存！';
      setTimeout(() => { statusEl.textContent = ''; }, 2000);
      // 保存后强制刷新并打印
      loadSettings();
    });
  });

  // 模型名下拉框变更时立即保存
  document.getElementById('model').addEventListener('change', function() {
    const modelId = this.value;
    chrome.storage.local.set({ ai_model: modelId }, () => {
      console.log('[AI-DEBUG][options] 已保存模型名:', modelId);
    });
  });
}); 