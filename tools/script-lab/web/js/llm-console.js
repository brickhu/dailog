// llm-console.js —— 统一 LLM 请求弹窗（业务无关）
// 布局：左=提示词(分角色可编辑)+请求参数+追加提示词+预览请求体+发送；右=请求历史(请求/响应,可勾选)；底=评分(可选)+采纳
// 采纳 = (打分模板) 把历史每次发送的追加提示词+评分 → 进化系统 → onDone({request,response,meta})（纯业务）
(function () {
  const C = { bg:'#0d1117', card:'#0b0d11', border:'#262b36', text:'#e6e8ee', muted:'#8a91a0', accent:'#58a6ff', green:'#3fb950', red:'#f85149', amber:'#d29922' };
  const ROLE_C = { system:'#d29922', assistant:'#3fb950', user:'#58a6ff', tool:'#bc8cff' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const STORE_PREFIX = 'llmconsole:';
  const loadHist = (u) => { try { const h = JSON.parse(localStorage.getItem(STORE_PREFIX + u) || 'null'); return Array.isArray(h) ? h : []; } catch { return []; } };
  const saveHist = (u, h) => { try { localStorage.setItem(STORE_PREFIX + u, JSON.stringify(h)); } catch {} };
  const sec = (t) => { const d = document.createElement('div'); d.style.cssText = 'font-size:11px;color:' + C.muted + ';margin:0 0 4px'; d.textContent = t; return d; };

  window.openLlmConsole = function (cfg) {
    if (!cfg || !cfg.url) return;
    const uid = (cfg.id || 'x') + ':' + cfg.key;
    let history = loadHist(uid);
    let selId = null, score = null;
    let extraTa, msgsBox, histEl, statusEl, adoptBtn, sendBtn, scoreWrap;
    let previewOv = null, previewPre = null;
    let apiBodySnap = null;   // 服务端 preview 返回的"直调 LLM 出站 body"
    const openIds = new Set();   // 历史项展开态（与"选中采纳"独立）
    let busy = false;   // 防重复点击：异步动作进行中禁止再触发
    function lockAll(on) { win.querySelectorAll('button, textarea, input').forEach((el) => { el.disabled = on; }); }
    let msgsOrig = [];      // [{role, orig}] 提示词原文（判断是否改过）

    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:999;display:flex;align-items:center;justify-content:center';
    const win = document.createElement('div');
    win.style.cssText = 'width:min(1500px,97vw);height:min(900px,94vh);background:' + C.bg + ';border:1px solid ' + C.border + ';border-radius:10px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.5)';
    ov.append(win); document.body.append(ov);
    const close = () => { ov.remove(); window.__llmConsoleOpen = null; };
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    const setStatus = (t) => { if (statusEl) statusEl.textContent = t || ''; };

    // ===== 头部 ===== 
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid ' + C.border;
    head.innerHTML = '<span style="font-size:14px;font-weight:600;color:' + C.text + '">' + esc(cfg.title || cfg.key) + '</span>'
      + '<span style="font-size:11px;color:' + C.muted + '">' + esc(cfg.key || '') + '</span>'
      + '<span style="flex:1"></span>'
      + '<span id="lcStatus" style="font-size:12px;color:' + C.muted + '"></span>'
      + '<button type="button" style="cursor:pointer;background:' + C.card + ';border:1px solid ' + C.border + ';color:' + C.text + ';border-radius:6px;padding:4px 10px">✕</button>';
    head.querySelector('button').onclick = close;
    statusEl = head.querySelector('#lcStatus');
    win.append(head);

    // ===== 主体：左 提示词区 / 右 历史区 ===== 
    const body = document.createElement('div');
    body.style.cssText = 'flex:1;display:flex;min-height:0';

    const left = document.createElement('div');
    left.style.cssText = 'width:44%;min-width:420px;display:flex;flex-direction:column;gap:10px;padding:12px 14px;border-right:1px solid ' + C.border + ';overflow:auto;box-sizing:border-box';
    // ① 提示词（messages，分角色）
    left.append(sec('提示词（messages，分角色，可编辑）'));
    msgsBox = document.createElement('div');
    msgsBox.style.cssText = 'display:flex;flex-direction:column;gap:6px';
    left.append(msgsBox);
    // （业务参数由 buildRequest() 自动附带，不向用户展示）
    // ③ 追加提示词 + 发送
    const opRow = document.createElement('div');
    opRow.style.cssText = 'display:flex;align-items:center;gap:8px';
    extraTa = document.createElement('input');
    extraTa.type = 'text'; extraTa.placeholder = '追加提示词（可选）：如 高潮 moment 必须逐字保留';
    extraTa.style.cssText = 'flex:1;background:' + C.card + ';border:1px solid ' + C.border + ';color:' + C.text + ';border-radius:6px;padding:6px 8px;font-size:12px';
    sendBtn = document.createElement('button');
    sendBtn.type = 'button'; sendBtn.textContent = '发送';
    sendBtn.style.cssText = 'cursor:pointer;background:' + C.card + ';border:1px solid ' + C.green + ';color:' + C.text + ';border-radius:6px;padding:6px 16px;font-size:12px;font-weight:600';
    opRow.append(extraTa, sendBtn);
    left.append(opRow);
    // ④ 预览请求体（按钮 → 右侧历史区浮层）
    const previewBtn = document.createElement('button');
    previewBtn.type = 'button'; previewBtn.textContent = '预览请求体';
    previewBtn.style.cssText = 'align-self:flex-start;cursor:pointer;background:' + C.card + ';border:1px solid ' + C.border + ';color:' + C.text + ';border-radius:6px;padding:5px 12px;font-size:12px';
    left.append(previewBtn);

    const right = document.createElement('div');
    right.style.cssText = 'flex:1;display:flex;flex-direction:column;min-width:0;position:relative';
    const rh = document.createElement('div');
    rh.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid ' + C.border;
    rh.innerHTML = '<span style="font-size:12px;color:' + C.text + '">请求历史</span><span style="font-size:11px;color:' + C.muted + '">每次发送 append；勾选一条 → 采纳</span><span style="flex:1"></span><button type="button" id="lcClear" style="cursor:pointer;font-size:11px;background:' + C.card + ';border:1px solid ' + C.border + ';color:' + C.muted + ';border-radius:6px;padding:3px 8px">清空</button>';
    rh.querySelector('#lcClear').onclick = () => { history = []; selId = null; score = null; paintScore(); saveHist(uid, history); renderHist(); setStatus('历史已清空'); };
    right.append(rh);
    histEl = document.createElement('div');
    histEl.style.cssText = 'flex:1;overflow:auto;padding:10px 12px;box-sizing:border-box';
    right.append(histEl);
    // 请求预览浮层（覆盖历史区，可关闭）
    previewOv = document.createElement('div');
    previewOv.style.cssText = 'position:absolute;inset:0;background:rgba(10,12,16,.97);display:none;flex-direction:column;z-index:5';
    const pvHead = document.createElement('div');
    pvHead.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid ' + C.border;
    pvHead.innerHTML = '<span style="font-size:12px;color:' + C.text + '">请求预览（将发送的 body）</span><span style="flex:1"></span><button type="button" id="pvClose" style="cursor:pointer;background:none;border:none;color:' + C.muted + ';font-size:16px">✕</button>';
    pvHead.querySelector('#pvClose').onclick = () => { previewOv.style.display = 'none'; };
    previewPre = document.createElement('pre');
    previewPre.style.cssText = 'flex:1;overflow:auto;margin:0;padding:10px 14px;color:' + C.text + ';font-size:11px;font-family:ui-monospace,Menlo,monospace;white-space:pre-wrap;box-sizing:border-box';
    previewOv.append(pvHead, previewPre);
    right.append(previewOv);

    // ===== 底部：评分 + 采纳 ===== 
    const foot = document.createElement('div');
    foot.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 16px;border-top:1px solid ' + C.border;
    scoreWrap = document.createElement('span');
    scoreWrap.style.cssText = 'display:' + (cfg.scoring ? 'flex' : 'none') + ';align-items:center;gap:5px;flex-wrap:wrap';
    scoreWrap.append(Object.assign(document.createElement('span'), { textContent: '评分', style: 'font-size:11px;color:' + C.muted }));
    let scoreBtns = [];
    function paintScore(){ scoreBtns.forEach((x, i) => { x.style.borderColor = score === (i + 1) ? (score < 7 ? C.red : C.green) : C.border; }); }
    if (cfg.scoring) {
      for (let s = 1; s <= 10; s++) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = String(s);
        b.style.cssText = 'cursor:pointer;min-width:26px;padding:2px 0;font-size:11px;background:' + C.card + ';border:1px solid ' + C.border + ';color:' + C.text + ';border-radius:4px';
        b.onclick = () => { score = s; paintScore(); };
        scoreWrap.append(b); scoreBtns.push(b);
      }
    }
    adoptBtn = document.createElement('button');
    adoptBtn.type = 'button'; adoptBtn.textContent = '采纳';
    adoptBtn.style.cssText = 'cursor:pointer;font-weight:600;background:' + C.card + ';border:1px solid ' + C.amber + ';color:' + C.text + ';border-radius:6px;padding:6px 18px;font-size:13px';
    const hint = document.createElement('span');
    hint.style.cssText = 'margin-left:auto;font-size:11px;color:' + C.muted;
    hint.textContent = cfg.scoring ? '采纳 = 记录(各次追加提示词+评分) → 触发业务 onDone' : '采纳 = 触发业务 onDone';
    foot.append(scoreWrap, adoptBtn, hint);

    win.append(body, foot);
    body.append(left, right);

    // ===== 逻辑 ===== 
    // 发送期间锁定全部输入控件
    function setLocked(on) {
      msgsBox.querySelectorAll('textarea').forEach((t) => { t.disabled = on; });
      if (extraTa) extraTa.disabled = on;
      if (previewBtn) previewBtn.disabled = on;
    }
    function composeBody() {
      const body = Object.assign({}, cfg.buildRequest ? cfg.buildRequest() : {});
      if (msgsOrig.length) body.messages = collectMsgs();   // 已加载提示词 → 消息随请求发送（预览=发送的同一对象）
      const ex = extraTa ? extraTa.value.trim() : '';
      if (ex) body.revision = ex;
      return body;
    }
    // 预览 = 直调 LLM 的出站请求体（model + messages 全文 + config 展开）——服务端 preview 已算好；未加载时兜底本层 body
    previewBtn.onclick = () => {
      previewPre.textContent = apiBodySnap ? JSON.stringify(apiBodySnap, null, 1) : JSON.stringify(composeBody(), null, 1);
      previewOv.style.display = 'flex';
    };
    async function loadPreview() {
      try {
        const req = Object.assign({}, cfg.buildRequest ? cfg.buildRequest() : {}, { preview: true });
        const d = await j(cfg.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) });
        const pv = d && d.preview;
        apiBodySnap = (d && d.apiBody) || null;   // 直调 LLM 的完整出站 body（model/messages/config…）
        if (!pv || !Array.isArray(pv.messages)) { setStatus('（无预览，直接发送即可）'); return; }
        msgsBox.innerHTML = ''; msgsOrig = [];
        pv.messages.forEach((m, i) => {
          const role = (m && m.role) || 'user';
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:flex-start;gap:6px';
          const tag = document.createElement('div');
          tag.textContent = role;
          tag.style.cssText = 'flex:0 0 auto;margin-top:7px;padding:1px 7px;border-radius:4px;font-size:10px;font-weight:600;color:#0b0d11;background:' + (ROLE_C[role] || C.muted);
          const ta = document.createElement('textarea');
          ta.spellcheck = false;
          ta.value = (m.content === undefined || m.content === null) ? '' : String(m.content);
          ta.style.cssText = 'flex:1;box-sizing:border-box;height:' + ((role === 'system' || role === 'assistant' || (i === 0 && String(m.content).length > 400)) ? 96 : 70) + 'px;background:' + C.card + ';border:1px solid ' + C.border + ';color:' + C.text + ';border-radius:6px;padding:6px 8px;font-size:11px;font-family:ui-monospace,Menlo,monospace;resize:vertical';
          row.append(tag, ta); msgsBox.append(row);
          msgsOrig.push({ role: role, orig: ta.value });
        });

        setStatus('预览已加载（提示词可改）');
      } catch (e) { setStatus('预览加载失败：' + (e && e.message ? e.message : e)); }
    }
    function collectMsgs() { const out = []; const tas = msgsBox.querySelectorAll('textarea'); let i = 0; for (const t of tas) { if (i < msgsOrig.length) out.push({ role: msgsOrig[i].role, content: t.value }); i++; } return out; }
    async function send() {
      if (busy) return; busy = true;
      lockAll(true); sendBtn.textContent = '发送中…'; setStatus('调用中…');
      const body = composeBody();
      const extra = body.revision || '';
      const rec = { id: 'h' + Date.now(), ts: Date.now(), request: body, extra: extra || null, resp: null, err: null };
      history.push(rec); saveHist(uid, history);
      try {
        const d = await j(cfg.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        if (!d || d.ok === false) throw new Error((d && d.error) || '未知错误');
        rec.resp = d; setStatus('完成');
      } catch (e) { rec.err = String((e && e.message) || e); setStatus('✗ ' + rec.err); }
      saveHist(uid, history); renderHist();
      busy = false; lockAll(false); sendBtn.disabled = false; sendBtn.textContent = '发送';
    }
    sendBtn.onclick = send;

    // 响应展示视图：剔除 usage/raw（原始数据仍存历史，仅显示时隐藏）
    function viewResp(r) {
      if (!r) return r;
      const c = Object.assign({}, r);
      delete c.usage; delete c.raw;
      return c;
    }
    // LLM 消耗 + 缓存命中（响应盒外单独一行）
    function usageFooter(resp) {
      const u = resp && resp.usage;
      if (!u) return '';
      let s = '⚡ 输入 ' + (u.input || 0) + ' toks · 输出 ' + (u.output || 0) + ' toks';
      if (u.cacheRate !== null && u.cacheRate !== undefined) s += ' · 缓存命中 ' + u.cacheRate + '%（hit ' + (u.cacheHit || 0) + ' / miss ' + (u.cacheMiss || 0) + '）';
      else s += ' · 缓存命中 n/a';
      return s;
    }
    function summary(resp) { try { const r = resp && resp.result; if (r && Array.isArray(r.scripts)) return 'scripts × ' + r.scripts.length; if (r && r.score !== undefined) return 'score=' + r.score; if (r) return 'ok'; } catch {} return 'ok'; }
    // 标准折叠卡片：整条头部可点（带 ▸/▾），正文收在卡片内；footer=正文末尾单独一行小字
    function histBlock(label, color, json, footer) {
      const card = document.createElement('div');
      card.style.cssText = 'margin:4px 0;border:1px solid ' + C.border + ';border-left:3px solid ' + color + ';border-radius:6px;background:' + C.bg + ';overflow:hidden';
      const head = document.createElement('div');
      head.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 10px;cursor:pointer;user-select:none';
      const lab = document.createElement('span');
      lab.style.cssText = 'font-size:11px;font-weight:600;color:' + color;
      lab.textContent = label;
      const meta = document.createElement('span');
      meta.style.cssText = 'font-size:10px;color:' + C.muted + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1';
      meta.textContent = (typeof json === 'string') ? json.slice(0, 60) : ((json && (json.result || json.request)) ? '含内容 · 点击查看' : '点击查看');
      const chev = document.createElement('span');
      chev.style.cssText = 'font-size:10px;color:' + C.muted; chev.textContent = '▸';
      head.append(lab, meta, chev);
      const body = document.createElement('div');
      body.style.cssText = 'display:none;border-top:1px solid ' + C.border + ';padding:6px 8px;max-height:200px;overflow:auto';
      const pre = document.createElement('pre');
      pre.style.cssText = 'margin:0;font-size:10px;color:' + C.text + ';font-family:ui-monospace,Menlo,monospace;white-space:pre-wrap';
      pre.textContent = typeof json === 'string' ? json : JSON.stringify(json, null, 1);
      body.append(pre);
      if (footer) {
        const f = document.createElement('div');
        f.style.cssText = 'margin-top:5px;padding-top:4px;border-top:1px dashed ' + C.border + ';font-size:10px;color:' + C.muted;
        f.textContent = footer;
        body.append(f);
      }
      let on = false;
      const set = (v) => { on = v; chev.textContent = on ? '▾' : '▸'; body.style.display = on ? '' : 'none'; };
      head.onclick = () => set(!on);
      card.append(head, body);
      return card;
    }
    function renderHist() {
      histEl.innerHTML = '';
      if (!history.length) { histEl.innerHTML = '<div style="color:' + C.muted + ';font-size:12px;padding:16px">暂无请求——左侧点「发送」发起第一次调用</div>'; return; }
      history.forEach((h, idx) => {
        const it = document.createElement('div');
        const chosen = selId === h.id;
        const opened = openIds.has(h.id);
        it.style.cssText = 'border:1px solid ' + (chosen ? C.amber : C.border) + ';border-radius:6px;margin-bottom:10px;background:' + C.card;
        const bar = document.createElement('div');
        bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px';
        const radio = document.createElement('input');
        radio.type = 'radio'; radio.name = 'lcSel'; radio.style.cssText = 'cursor:pointer';
        radio.checked = chosen;
        radio.onchange = () => { selId = h.id; paintAdopt(); renderHist(); };   // 只负责选中，不影响展开
        const info = document.createElement('span');
        info.style.cssText = 'font-size:11px;color:' + C.muted;
        info.textContent = '#' + (idx + 1) + ' · ' + new Date(h.ts).toTimeString().slice(0, 8);
        const st = document.createElement('span');
        st.style.cssText = 'font-size:10px;color:' + (h.err ? C.red : C.green);
        st.textContent = h.err ? ('✗ ' + h.err) : (h.extra ? ('带意见 · ' + summary(h.resp)) : summary(h.resp));
        const gap = document.createElement('span'); gap.style.cssText = 'flex:1';
        const mark = document.createElement('span');
        mark.style.cssText = 'font-size:10px;color:' + C.muted;
        mark.textContent = chosen ? '已选 ✓' : '';
        const exBtn = document.createElement('button');
        exBtn.type = 'button'; exBtn.textContent = opened ? '收起' : '展开';
        exBtn.style.cssText = 'cursor:pointer;font-size:11px;background:none;border:1px solid ' + C.border + ';color:' + C.text + ';border-radius:4px;padding:1px 8px';
        exBtn.onclick = () => { openIds.has(h.id) ? openIds.delete(h.id) : openIds.add(h.id); renderHist(); };   // 只负责展开，不影响选中
        bar.append(radio, info, st, gap, mark, exBtn);
        const detail = document.createElement('div');
        detail.style.cssText = 'display:' + (opened ? '' : 'none') + ';border-top:1px solid ' + C.border + ';padding:8px 10px;overflow:auto;max-height:440px';
        detail.append(histBlock('请求', C.accent, h.request));
        if (h.err) detail.append(histBlock('错误', C.red, h.err));
        else if (h.resp) detail.append(histBlock('响应', C.green, viewResp(h.resp)));   // 响应 JSON 不含 usage/raw
        const uf = usageFooter(h.resp);
        if (uf) {
          const um = document.createElement('div');
          um.style.cssText = 'margin:6px 0 2px;padding:4px 8px;background:' + C.card + ';border:1px solid ' + C.border + ';border-radius:4px;font-size:10px;color:' + C.muted;
          um.textContent = uf;   // LLM 消耗 + 缓存命中：响应盒子外面单独一行
          detail.append(um);
        }
        it.append(bar, detail);
        histEl.append(it);
      });
      paintAdopt();
    }
    function paintAdopt(){ adoptBtn.disabled = !selId; adoptBtn.style.opacity = selId ? '1' : '.45'; adoptBtn.style.cursor = selId ? 'pointer' : 'not-allowed'; }
    adoptBtn.onclick = async () => {
      if (busy) return; busy = true;
      const hit = history.find((h) => h.id === selId);
      if (!hit) { busy = false; return; }
      lockAll(true); adoptBtn.textContent = '采纳中…'; setStatus('采纳处理中…');
      if (cfg.scoring) {
        try {
          const extras = history.map((h) => h.extra).filter(Boolean);
          let sid = cfg.id;
          if (!sid) { try { sid = (cfg.buildRequest ? cfg.buildRequest() : {}).id || null; } catch {} }
          await j('/api/feedback/review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ submissionId: sid, score: score, extras: extras, note: hit.extra || null }) });
        } catch {}
      }
      try {
        await cfg.onDone({ request: hit.request, response: hit.resp, meta: { score: cfg.scoring ? score : undefined, key: cfg.key } });
        // 采纳即该轮结束：清空本控制台请求历史（下次打开是新的一轮）
        history = []; selId = null; score = null; openIds.clear();
        if (typeof paintScore === 'function') paintScore();
        saveHist(uid, history);
        close();
      }
      catch (e) {
        busy = false; lockAll(false); adoptBtn.disabled = false; adoptBtn.textContent = '采纳'; paintAdopt();
        setStatus('✗ onDone 失败：' + (e && e.message ? e.message : e));
      }
    };

    // 初始化：异步拉预览
    renderHist();
    loadPreview();
    window.__llmConsoleOpen = { close, send: sendBtn.onclick };
    return { close, send: sendBtn.onclick };
  };
})();
