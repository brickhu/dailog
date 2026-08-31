// 通用 LLM 调用组件（卡片式，三态状态机）
// 内容定义：title(标题) + status(状态提示) + rendered_prompt(提示词JSON可编辑) + llm_response(响应) + result(业务结果)
// 区域：标题栏(title+status+折叠按钮) / 可折叠内容区(rendered_prompt+发送 | result+llm_response+重试)
// 状态：state1 预览 →(发送)→ state2 调用中 →(完成)→ state3 结果 →(重试)→ state1
function createLlmBox(opts) {
  const mount = opts.mount;
  if (!mount) throw new Error('llm-box: 缺 mount');
  let boxEl, titleEl, statusEl, collapseBtn, contentEl, taEl, sendBtn, descEl, resultEl, rawEl, retryBtn, errEl;
  let state = 'state1';          // state1 / state2 / state3
  let collapsed = false;         // 内容区折叠态
  let lastBody = null;           // 上次请求体（重试回 state1 保留编辑）
  let lastResult = null;

  function render() {
    mount.innerHTML = ''
      + '<div class="llm-box">'
      +   '<div class="llm-box-head">'
      +     '<span class="llm-box-title">' + esc(opts.title || 'LLM 调用') + '</span>'
      +     '<span class="llm-box-status muted"></span>'
      +     '<button class="llm-box-collapse" type="button" title="展开/收起">▾</button>'
      +   '</div>'
      +   '<div class="llm-box-content">'
      +     '<div class="llm-box-state1">'   // state1：result(description) + rendered_prompt（可编辑）+ 发送
      +       '<div class="llm-box-desc muted"></div>'
      +       '<textarea class="llm-box-ta" spellcheck="false" placeholder="{ \"messages\": [...], \"config\": {...} }"></textarea>'
      +       '<div class="llm-box-actions"><button class="pg llm-box-send" type="button">发送</button><span class="llm-box-hint muted">messages + config 均可编辑</span></div>'
      +     '</div>'
      +     '<div class="llm-box-state3" style="display:none">'   // state3：result + llm_response（直接展示）+ 重试
      +       '<div class="llm-box-result"></div>'
      +       '<div class="llm-box-raw"><pre></pre></div>'
      +       '<div class="llm-box-ops">'
      +         '<button class="pg llm-box-retry" type="button">重试</button>'
      +       '</div>'
      +     '</div>'
      +     '<div class="llm-box-state2" style="display:none">   // state2：调用中（内容收起）<span class="spin" style="display:inline-block;vertical-align:middle;width:12px;height:12px"></span> <span class="llm-box-running muted">生成中...</span></div>'
      +   '</div>'
      +   '<div class="llm-box-err" style="display:none"></div>'
      + '</div>';
    boxEl = mount.firstElementChild;
    titleEl = boxEl.querySelector('.llm-box-title');
    statusEl = boxEl.querySelector('.llm-box-status');
    collapseBtn = boxEl.querySelector('.llm-box-collapse');
    contentEl = boxEl.querySelector('.llm-box-content');
    taEl = boxEl.querySelector('.llm-box-ta');
    sendBtn = boxEl.querySelector('.llm-box-send');
    descEl = boxEl.querySelector('.llm-box-desc');
    resultEl = boxEl.querySelector('.llm-box-result');
    rawEl = boxEl.querySelector('.llm-box-raw');
    retryBtn = boxEl.querySelector('.llm-box-retry');
    errEl = boxEl.querySelector('.llm-box-err');
    collapseBtn.onclick = toggleCollapse;
    if (sendBtn) sendBtn.onclick = send;
    if (retryBtn) retryBtn.onclick = retry;
  }

  // 标题栏 status（按状态）
  function setStatus(text) { statusEl.textContent = text || ''; }

  // 折叠内容区
  function toggleCollapse() {
    collapsed = !collapsed;
    contentEl.style.display = collapsed ? 'none' : '';
    collapseBtn.textContent = collapsed ? '▸' : '▾';
  }

  // 状态切换
  function setState(s) {
    state = s;
    const s1 = boxEl.querySelector('.llm-box-state1');
    const s2 = boxEl.querySelector('.llm-box-state2');
    const s3 = boxEl.querySelector('.llm-box-state3');
    s1.style.display = s === 'state1' ? '' : 'none';
    s2.style.display = s === 'state2' ? '' : 'none';
    s3.style.display = s === 'state3' ? '' : 'none';
    errEl.style.display = 'none';
    if (s === 'state1') {
      setStatus('基于"' + (opts.key || '') + '"的配置调用LLM');
      if (descEl) descEl.textContent = opts.description || '';
      contentEl.style.display = collapsed ? 'none' : '';
    } else if (s === 'state2') {
      setStatus('生成中...');
      contentEl.style.display = 'none';   // 调用中内容收起
    } else if (s === 'state3') {
      contentEl.style.display = collapsed ? 'none' : '';
    }
  }

  // state1 → 发送 → state2 → 完成 → state3
  async function send() {
    if (state === 'state2') return;
    let body;
    try {
      body = opts.buildRequest() || {};
      if (taEl && taEl.value.trim()) {
        const parsed = JSON.parse(taEl.value);
        if (parsed.messages !== undefined) body.messages = parsed.messages;
        if (parsed.config !== undefined) body.config = parsed.config;
      }
    } catch (e) { showError(e.message); return; }
    return execute(body, opts.timeoutMs);
  }

  async function execute(body, timeoutMs) {
    lastBody = JSON.parse(JSON.stringify(body));
    setState('state2');
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs || 120000);
    let pollTimer = null;
    if (opts.statusUrl) {
      const url = typeof opts.statusUrl === 'function' ? opts.statusUrl() : opts.statusUrl;
      if (url) pollTimer = setInterval(async () => {
        try {
          const st = await j(url);
          if (st && st.state && st.state.phase !== 'done') setStatus(((st.state.phase || '') + ': ' + (st.state.detail || '')).trim());
        } catch {}
      }, 600);
    }
    try {
      const d = await j(opts.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal });
      clearTimeout(timer); if (pollTimer) clearInterval(pollTimer);
      const usage = d.usage || null;
      lastResult = d.result || d;
      // state3：result（业务摘要）+ token 概要 status
      resultEl.innerHTML = opts.onDone ? opts.onDone(lastResult, usage) : esc(JSON.stringify(lastResult, null, 1));
      // llm_response 直接展示
      rawEl.querySelector('pre').textContent = JSON.stringify(lastResult, null, 2);
      rawEl.style.display = '';
      setStatus(usage ? ('⚡ 输入 ' + usage.input + ' toks / 输出 ' + usage.output + ' toks') : '完成');
      setState('state3');
      return d;
    } catch (e) {
      clearTimeout(timer); if (pollTimer) clearInterval(pollTimer);
      if (ac.signal.aborted) showError('执行超时，请重试');
      else showError(e.message);
      setState('state1');   // 失败回到预览可重试
      throw e;
    }
  }

  // state3 → 重试 → state1（保留编辑内容，可改再发）
  function retry() {
    if (state !== 'state3') return;
    setState('state1');
  }

  function showError(msg) {
    errEl.textContent = '✗ ' + msg;
    errEl.style.display = '';
  }

  render();
  setState('state1');   // 默认锁定 state1
  return {
    send,
    retry,
    setState,
    setPreviewJson(jsonStr) { if (taEl) taEl.value = jsonStr; },
    setTitle(t) { if (titleEl) titleEl.textContent = t || ''; },
    setDescription(desc) { if (descEl) descEl.textContent = desc || ''; },
    el: boxEl,
  };
}
