// script-modal.js —— 脚本创作弹窗（思考模式 · 一次性调用）
//   打开：显示本次选题摘要 + 追加创作指令（选填）→ 确认 → 弹窗内显示「脚本创作中…」
//   完成：关闭弹窗，把脚本注入创作卡片（只保留一版，覆盖上一版）
//   重新创作：同一个弹窗，带上一版脚本 + 你的意见 → 更新那一版
(function () {
  const H = () => ({ 'content-type': 'application/json' });
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function openScriptModal(id, opts) {
    opts = opts || {};
    const chosen = opts.chosen && typeof opts.chosen === 'object' ? opts.chosen : null;
    const prev = opts.previousScript && typeof opts.previousScript === 'object' ? opts.previousScript : null;
    const isRedo = !!prev;
    const brief = (chosen && typeof chosen['选题说明'] === 'object') ? chosen['选题说明'] : {};
    const dir = (chosen && typeof chosen['创作意见'] === 'string') ? chosen['创作意见']
      : ((chosen && typeof chosen['创作建议'] === 'string') ? chosen['创作建议']
      : ((chosen && typeof chosen['创作指引'] === 'string') ? chosen['创作指引'] : ''));
    const line = (chosen && typeof chosen['立场'] === 'string') ? chosen['立场']
      : ((chosen && typeof chosen['认知探索'] === 'string') ? chosen['认知探索'] : '');   // 立场（这条线的起点）
    const aud = brief['受众'] || (chosen && chosen['目标听众']) || '';
    const zone = Array.isArray(brief['禁区']) ? brief['禁区'] : [];
    // 新契约（creative_proposal）：主问题 / 张力 / 可能的发现（旧契约这几个为空，自动不显示）
    const cpQ = (chosen && typeof chosen.core_question === 'string') ? chosen.core_question.trim() : '';
    const cpT = (chosen && typeof chosen.central_tension === 'string') ? chosen.central_tension.trim() : '';
    const cpD = (chosen && typeof chosen.possible_discovery === 'string') ? chosen.possible_discovery.trim() : '';

    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1000;display:flex;align-items:center;justify-content:center';
    const win = document.createElement('div');
    win.style.cssText = 'width:min(720px,94vw);background:#0d1117;border:1px solid #262b36;border-radius:10px;display:flex;flex-direction:column;overflow:hidden';
    win.innerHTML = '<div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #262b36">'
      + '<span style="font-size:14px;font-weight:600;color:#e6e8ee">' + (isRedo ? '重新创作' : '脚本创作') + '</span>'
      + '<span style="font-size:11px;color:#8a91a0">' + (isRedo ? '在上一版基础上修改' : '按选定的提案写一期脚本') + ' · 思考模式</span>'
      + '<span style="flex:1"></span>'
      + '<button type="button" id="smClose" style="cursor:pointer;background:#0b0d11;border:1px solid #262b36;color:#e6e8ee;border-radius:6px;padding:4px 10px;font-size:12px">关闭</button>'
      + '</div>'
      + '<div style="padding:12px 16px;border-bottom:1px solid #262b36;max-height:34vh;overflow:auto">'
      + '<div style="font-size:12px;color:#8a91a0;margin-bottom:6px">本次选题</div>'
      + (cpQ ? '<div style="font-size:13px;color:#e6e8ee;line-height:1.6"><span style="color:#8a91a0">主问题：</span>' + esc(cpQ) + '</div>' : '')
      + (cpT ? '<div style="font-size:12px;color:#9fb0c8;line-height:1.6;margin-top:4px"><span style="color:#8a91a0">张力：</span>' + esc(cpT) + '</div>' : '')
      + (cpD ? '<div style="font-size:12px;color:#9fb0c8;line-height:1.6;margin-top:4px"><span style="color:#8a91a0">可能的发现：</span>' + esc(cpD) + '</div>' : '')
      + (line ? '<div style="font-size:13px;color:#e6e8ee;line-height:1.6"><span style="color:#8a91a0">立场：</span>' + esc(line) + '</div>' : '')
      + (dir ? '<div style="font-size:13px;color:#e6e8ee;line-height:1.6;margin-top:6px;border-left:3px solid #4f8cff;padding:4px 0 4px 8px;background:#0f1420;border-radius:4px">' + esc(dir) + '</div>' : '')
      + (aud ? '<div style="font-size:12px;color:#8a91a0;margin-top:6px">受众：' + esc(aud) + '</div>' : '')
      + (zone.length ? '<div style="font-size:12px;color:#8a91a0;margin-top:4px">禁区：' + esc(zone.join('、')) + '</div>' : '')
      + '</div>'
      + '<div style="padding:12px 16px">'
      + '<div style="font-size:12px;color:#8a91a0;margin-bottom:6px">' + (isRedo ? '这次的修改意见（必填）' : '追加创作指令（选填）') + '</div>'
      + '<textarea id="smNote" placeholder="' + (isRedo ? '例如：开场太官方，砍到两句以内，直接从他问那句起' : '例如：别铺垫太长，直接从他那句原话起') + '" style="width:100%;box-sizing:border-box;height:88px;background:#0b0d11;border:1px solid #262b36;color:#e6e8ee;border-radius:6px;padding:8px 10px;font-size:13px;line-height:1.6;resize:vertical;outline:none"></textarea>'
      + '</div>'
      + '<div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-top:1px solid #262b36">'
      + '<span id="smStatus" style="font-size:12px;color:#8a91a0"></span><span style="flex:1"></span>'
      + '<button type="button" id="smOk" style="cursor:pointer;background:#0b0d11;border:1px solid #3fb950;color:#3fb950;border-radius:6px;padding:6px 20px;font-size:13px">确认创作</button>'
      + '</div>';
    ov.append(win); document.body.append(ov);
    const note = win.querySelector('#smNote');
    const status = win.querySelector('#smStatus');
    const okBtn = win.querySelector('#smOk');
    // 重新创作 = 改稿：必须写一条意见。
    // 否则空提交会走服务端的「全新生成」分支（server.mjs 只在 revision 非空时回灌上一版），
    // 看起来是「重新创作」，实际是「重摇一版并把上一版覆盖掉」。
    const needNote = '先在下面写一条修改意见——重新创作只改你点到的地方';
    const syncOk = () => {
      if (!isRedo) return;
      const has = String(note.value || '').trim().length > 0;
      okBtn.disabled = !has;
      okBtn.style.opacity = has ? '1' : '.45';
      if (!has) { status.textContent = needNote; status.style.color = '#8a91a0'; }
      else if (status.textContent === needNote) { status.textContent = ''; }
    };
    if (isRedo) { note.addEventListener('input', syncOk); syncOk(); }
    const close = () => ov.remove();
    win.querySelector('#smClose').onclick = close;
    ov.addEventListener('click', (e) => { if (e.target === ov && !busy) close(); });

    let busy = false, timer = null;
    async function run() {
      if (busy) return;
      // 兜底（含 Ctrl/Cmd+Enter 与按钮点击）：重新创作没写意见就不发请求
      if (isRedo && !String(note.value || '').trim()) {
        status.textContent = needNote; status.style.color = '#d29922';
        okBtn.disabled = true; okBtn.style.opacity = '.45';
        return;
      }
      busy = true;
      // 创作卡先进「创作中 · 生成中」（规则 3.2：状态先切，再跑 LLM）——卡片在弹窗背后就地刷新
      try {
        if (!window.__creating) window.__creating = {};
        window.__creating[id] = true;   // 本地：生成中动画
        if (typeof openDetail === 'function') openDetail(id);
      } catch (e) {}
      // 「创作中」= 本地有稿（或正在生成），不需要写远程；远程提交点在「确认生成语音」
      okBtn.disabled = true; okBtn.textContent = '创作中…'; okBtn.style.opacity = '.6';
      note.disabled = true;
      const t0 = Date.now();
      const tick = () => { status.textContent = '脚本创作中…（' + Math.round((Date.now() - t0) / 1000) + 's · 思考模式通常 40-90 秒）'; status.style.color = '#4f8cff'; };
      tick(); timer = setInterval(tick, 1000);
      try {
        const revision = String(note.value || '').trim();
        const body = { id: id, review: chosen, score: (chosen && typeof chosen.score === 'number') ? chosen.score : null };
        if (revision) body.revision = revision;
        if (prev) body.previousScript = [prev];
        const d = await j('/api/run/review/round2', { method: 'POST', headers: H(), body: JSON.stringify(body) });
        const sc = (d && d.result && Array.isArray(d.result.scripts) && d.result.scripts[0]) || null;
        if (!sc || !Array.isArray(sc.segments) || !sc.segments.length) throw new Error('这一次没有返回脚本');
        // 只写本地工作副本；入库时机 = 语音合成确认（merge.js 提交远程 scripts）。
        // 存的是"播出的话"这一份真相：segments；六字段那套出稿形态不留（编辑后会过期打架）。
        const kept = { segments: sc.segments };
        if (sc.episode) kept.episode = sc.episode;          // R4 meta 要用（title/logline/hook）
        if (sc.production) kept.production = sc.production;  // R4 meta 要用（时长档位/估算）
        try { setWorkflowInput(id, 'scripts', [kept]); } catch (e) {}
        try { if (!window.__workScripts) window.__workScripts = {}; window.__workScripts[id] = [kept]; } catch (e) {}
        clearInterval(timer);
        try { window.__creating[id] = false; } catch (e) {}   // 生成结束 → 卡片回「创作中（脚本展示）」
        status.textContent = '✓ 完成（' + Math.round((Date.now() - t0) / 1000) + 's）· 本地工作副本（语音合成确认时入库）';
        status.style.color = '#3fb950';
        notice('✓ 脚本已' + (isRedo ? '更新' : '注入') + '到创作卡片（' + sc.segments.length + ' 段）', 'success');
        setTimeout(function () { close(); if (typeof openDetail === 'function') openDetail(id); }, 600);
        return;
      } catch (err) {
        clearInterval(timer);
        try {
          window.__creating[id] = false;   // 生成中结束；卡片按本地是否有稿显示「创作中/待创作」
          if (typeof openDetail === 'function') openDetail(id);
        } catch (e) {}
        busy = false;
        status.textContent = '✗ ' + ((err && err.message) || err);
        status.style.color = '#f85149';
        okBtn.disabled = false; okBtn.textContent = '重试'; okBtn.style.opacity = '1';
        note.disabled = false;
      }
    }
    okBtn.onclick = run;
    note.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run(); });
    note.focus();
    return { close: close };
  }

  window.openScriptModal = openScriptModal;
})();