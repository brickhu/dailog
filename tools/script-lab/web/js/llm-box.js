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
  let lastPreview = null;        // 最近一次 setPreviewJson 的内容——发送时用于判断用户是否改过预览
  let lastResult = null;
  let lastRaw = null;            // 最近一次模型原始输出样本（质量标记用）
  let msgsWrap = null;           // 角色分拆容器（.llm-box-msgs）
  let splitBoxes = [];           // [{role, ta, orig}]——每个角色的文本框与其原始内容
  let cfgTa = null, cfgOrig = ''; // config 文本框与原始内容
  let splitActive = false;       // 是否处于"按角色分拆"视图
  let revWrap = null, revTa = null; // 修改意见输入区
  let fbEl = null, fbScoreEl = null, fbChips = null, fbNote = null, fbStatus = null;
  let fbScore = null;             // 1-10；null=未打
  const fbTypes = new Set();      // 问题类型 chips（score<=6 时展开）
  const FB_PROBLEMS = ['空稿/scripts空', '悬空话题（没交代聊什么）', '编造/无出处台词', '偏离原文/归因漂移', '过长/结构问题', '其他'];

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
      +       '<div class="llm-box-msgs" style="display:none"></div>'
      +       '<textarea class="llm-box-ta" spellcheck="false" placeholder="{ \"messages\": [...], \"config\": {...} }"></textarea>'
      +       '<div class="llm-box-rev-wrap" style="display:none"><textarea class="llm-box-revta" spellcheck="false" placeholder="修改意见（可选）：例如 点题两句太长、高潮 moment 必须逐字保留、guest 别连续独白。留空=最新渲染直接发送；填写=带意见重新生成（附带上一版脚本）"></textarea></div>'
      +       '<div class="llm-box-actions"><button class="pg llm-box-send" type="button">发送</button><span class="llm-box-hint muted">分角色提示词 + config 均可编辑；有修改意见填上方输入框</span></div>'
      +     '</div>'
      +     '<div class="llm-box-state3" style="display:none">'   // state3：result + 质量标记 + llm_response（直接展示）+ 重试
      +       '<div class="llm-box-result"></div>'
      +       '<div class="llm-box-fb" style="display:none">'
      +         '<div class="muted" style="font-size:12px;margin-bottom:4px">质量打分（确认入库前必选——打完后确认按钮才可用）：</div>'
      +         '<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap">'
      +           '<span class="muted" style="font-size:12px">打分 1-10（&lt;7 = 有问题的稿）：</span>'
      +           '<span class="llm-box-fb-score" style="display:flex;gap:3px;flex-wrap:wrap"></span>'
      +           '<span class="llm-box-fb-status muted" style="font-size:12px;margin-left:auto"></span>'
      +         '</div>'
      +         '<div class="llm-box-fb-chips" style="display:none;flex-wrap:wrap;gap:4px;margin-bottom:6px"></div>'
      +         '<input type="text" class="llm-box-fb-note" placeholder="备注（可选）：这稿哪不行 / 好在哪" style="width:100%;box-sizing:border-box;background:#0b0d11;border:1px solid #262b36;color:#e6e8ee;border-radius:6px;padding:6px 8px;font-size:12px;margin-bottom:6px">'
      +       '</div>'
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
    msgsWrap = boxEl.querySelector('.llm-box-msgs');
    revWrap = boxEl.querySelector('.llm-box-rev-wrap');
    revTa = boxEl.querySelector('.llm-box-revta');
    sendBtn = boxEl.querySelector('.llm-box-send');
    descEl = boxEl.querySelector('.llm-box-desc');
    resultEl = boxEl.querySelector('.llm-box-result');
    rawEl = boxEl.querySelector('.llm-box-raw');
    retryBtn = boxEl.querySelector('.llm-box-retry');
    errEl = boxEl.querySelector('.llm-box-err');
    collapseBtn.onclick = toggleCollapse;
    if (sendBtn) sendBtn.onclick = send;
    if (retryBtn) retryBtn.onclick = retry;
    // 质量标记面板（opts.feedback 启用）——打分制
    fbEl = boxEl.querySelector('.llm-box-fb');
    fbScoreEl = boxEl.querySelector('.llm-box-fb-score');
    fbChips = boxEl.querySelector('.llm-box-fb-chips');
    fbNote = boxEl.querySelector('.llm-box-fb-note');
    fbStatus = boxEl.querySelector('.llm-box-fb-status');
    // 打分未选 → 禁用卡片内"确认入库"按钮（opts.feedback 才强制）
    const gateConfirm = () => {
      if (!opts.feedback) return;
      const c = resultEl && resultEl.querySelector('.llm-box-confirm');
      if (!c) return;
      c.disabled = !fbScore;
      c.title = fbScore ? '' : '请先完成质量打分（1-10）';
      c.style.opacity = fbScore ? '1' : '0.5';
    };
    const scoreBtns = [];
    if (fbScoreEl) {
      for (let s = 1; s <= 10; s++) {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = String(s); b.className = 'pg';
        b.style.cssText = 'min-width:24px;font-size:11px;padding:2px 0;color:#e6e8ee;background:#0b0d11;border:1px solid #262b36;border-radius:4px';
        b.onclick = () => {
          fbScore = s;
          if (fbStatus) fbStatus.textContent = s < 7 ? '已选 ' + s + ' 分（问题稿，可勾选原因）' : '已选 ' + s + ' 分——可确认入库';
          scoreBtns.forEach((x, i) => {
            const v = i + 1;
            x.style.borderColor = v === s ? (s < 7 ? '#f85149' : '#3fb950') : '#262b36';
            x.style.background = v === s ? (s < 7 ? '#3a1215' : '#0f2d16') : '#0b0d11';
          });
          gateConfirm();
          if (fbChips) {
            fbChips.style.display = s < 7 ? 'flex' : 'none';
            if (s < 7 && !fbChips.children.length) {
              FB_PROBLEMS.forEach((p) => {
                const c = document.createElement('button');
                c.type = 'button'; c.textContent = p; c.className = 'pg';
                c.style.cssText = 'font-size:11px;padding:2px 8px;color:#e6e8ee;background:#0b0d11;border:1px solid #262b36;border-radius:4px';
                c.onclick = () => {
                  if (fbTypes.has(p)) fbTypes.delete(p); else fbTypes.add(p);
                  c.style.borderColor = fbTypes.has(p) ? '#f85149' : '#262b36';
                };
                fbChips.append(c);
              });
            }
          }
        };
        fbScoreEl.append(b);
        scoreBtns.push(b);
      }
    }
    if (fbStatus) fbStatus.textContent = '请打分（1-10）——打完后「确认入库」按钮才可用';
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
      if (revWrap) revWrap.style.display = lastResult ? '' : 'none';   // 跑过一次才显示修改意见框
    } else if (s === 'state2') {
      setStatus('生成中...');
      contentEl.style.display = 'none';   // 调用中内容收起
    } else if (s === 'state3') {
      contentEl.style.display = collapsed ? 'none' : '';
      if (fbEl) fbEl.style.display = (opts.feedback && lastResult) ? '' : 'none';
    }
  }

  // state1 → 发送 → state2 → 完成 → state3
  async function send() {
    if (state === 'state2') return;
    let body;
    try {
      body = opts.buildRequest() || {};
      if (splitActive) {
        // 分拆视图：任何一框被改过 → 带回（未改 → 不带 → 服务端用 defaultMsgs 最新渲染）
        const msgsChanged = splitBoxes.some(b => b.ta.value.trim() !== b.orig.trim());
        const cfgChanged = !!cfgTa && cfgTa.value.trim() !== cfgOrig.trim();
        if (msgsChanged) {
          body.messages = splitBoxes.map(b => ({ role: b.role, content: b.ta.value }));
        }
        if (cfgChanged) {
          const rawCfg = cfgTa.value.trim();
          if (rawCfg) { body.config = JSON.parse(rawCfg); }
        }
      } else {
        // 单 JSON 框：仅当用户改动过预览才带回 messages/config
        const raw = taEl && taEl.value ? taEl.value.trim() : '';
        if (raw && raw !== lastPreview) {
          const parsed = JSON.parse(raw);
          if (parsed.messages !== undefined) body.messages = parsed.messages;
          if (parsed.config !== undefined) body.config = parsed.config;
        }
      }
      // 修改意见：填写 → 服务端最新渲染 + 上一版脚本 + 意见重新生成
      const rev = revTa ? revTa.value.trim() : '';
      if (rev) {
        body.revision = rev;
        if (lastResult && Array.isArray(lastResult.scripts)) body.previousScript = lastResult.scripts;
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
      lastRaw = (d && (d.raw || (d.result && d.result.raw))) || null;
      // state3：result（业务摘要）+ token 概要 status
      resultEl.innerHTML = opts.onDone ? opts.onDone(lastResult, usage) : esc(JSON.stringify(lastResult, null, 1));
      if (opts.feedback && typeof gateConfirm === 'function') {
        // 打分一次持续有效：重试出新稿不强制重新打分，首次入库前打分即可
        gateConfirm();
        if (fbStatus) fbStatus.textContent = fbScore ? '' : '首次入库前请打分（1-10）——打分后「确认入库」可用；重试不要求打分';
      }
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
    getFeedback() { return { score: fbScore, types: Array.from(fbTypes), note: fbNote ? fbNote.value.trim() : '' }; },
    setPreviewJson(jsonStr) {
      if (!taEl) return;
      taEl.value = jsonStr; lastPreview = jsonStr;
      // 解析成 {messages, config} → 按角色分拆；解析失败/无 messages → 保留单 JSON 框
      let parsed = null;
      try { parsed = JSON.parse(jsonStr); } catch {}
      const msgs = parsed && Array.isArray(parsed.messages) ? parsed.messages : null;
      if (msgsWrap) msgsWrap.innerHTML = '';
      splitBoxes = []; cfgTa = null; cfgOrig = '';
      splitActive = false;
      if (msgs && msgs.length > 0 && msgsWrap) {
        const ROLE_COLOR = { system: '#d29922', assistant: '#3fb950', user: '#58a6ff', tool: '#bc8cff' };
        const taCss = 'width:100%;box-sizing:border-box;height:120px;background:#0b0d11;border:1px solid #262b36;color:#e6e8ee;border-radius:6px;padding:8px 10px;font-size:12px;font-family:ui-monospace,Menlo,monospace;resize:vertical';
        const mkRow = (label, color, value) => {
          const row = document.createElement('div');
          row.style.cssText = 'margin:6px 0;display:flex;gap:8px;align-items:flex-start';
          const badge = document.createElement('div');
          badge.textContent = label;
          badge.style.cssText = 'flex:0 0 auto;margin-top:8px;padding:1px 8px;border-radius:4px;font-size:11px;font-weight:600;color:#0b0d11;background:' + color;
          const ta = document.createElement('textarea');
          ta.spellcheck = false; ta.value = value; ta.style.cssText = taCss;
          row.append(badge, ta);
          return { row, ta };
        };
        msgs.forEach((m, i) => {
          const role = (m && m.role) || 'user';
          const { row, ta } = mkRow('[' + (i + 1) + '] ' + role, ROLE_COLOR[role] || '#8a91a0', (m && m.content !== undefined && m.content !== null) ? String(m.content) : '');
          msgsWrap.append(row);
          splitBoxes.push({ role, ta, orig: ta.value });
        });
        if (parsed.config !== undefined) {
          const { row, ta } = mkRow('config', '#f85149', JSON.stringify(parsed.config, null, 1));
          msgsWrap.append(row);
          cfgTa = ta; cfgOrig = ta.value;
        }
        splitActive = true;
        msgsWrap.style.display = '';
        if (taEl) taEl.style.display = 'none';
      } else if (taEl) {
        taEl.style.display = '';
      }
    },
    setTitle(t) { if (titleEl) titleEl.textContent = t || ''; },
    setDescription(desc) { if (descEl) descEl.textContent = desc || ''; },
    el: boxEl,
  };
}
