// 节目详情：投稿卡片 + 采集/创作/发布流程卡片 + 对话消息
async function openDetail(id){
  try { window.__curDetailId = id; } catch {}
  const wrap=document.getElementById('detailWrap');
  const list=document.getElementById('listWrap');
  list.style.display='none';
  const sb=document.getElementById('statbar'); if(sb) sb.style.display='none';
  const pg=document.getElementById('pager'); if(pg) pg.style.display='none';
  wrap.style.display='block';
  wrap.innerHTML='<div class="muted">加载中…</div>';
  try{
    // 详情页工作流统一状态：创作（full audio）→ 发布（meta/封面）各步骤共享同一份数据
    window.workflowState = { id: id, audioKey: null, meta: null, cover: null };
    const d=await j('/api/detail/'+id);
    const dt=d.detail||{};
    // 原则②：进入投稿详情先初始化生产素材 store（3 个 R2 产出物初始化进 store）
    if (typeof initAssets === 'function') { try { initAssets(id, dt, d.dialogue || null); } catch {} }
    // 音色采样（投稿卡展示）：主持人采样（detail.userId）+ 嘉宾声线（guest.id）
    const hostSampleV = (dt && dt.voiceSamples && dt.voiceSamples[0]) || null;
    const hostUserIdV = (dt && dt.userId) || null;
    const guestIdV = (dt && dt.guest && dt.guest.id) || null;
    const hostNameV = (dt && dt.host && (dt.host.callName || (dt.host.personaInfo && dt.host.personaInfo.displayName))) || '主持人';
    const guestNameV = (dt && dt.guest && dt.guest.name) || '嘉宾';
    const dc=dt.dialogueCount||null;
    const rawStatus = dt.status || '?';
    // 状态机：submitted 待采集 → collected 制作中 → crafted 待发布 → published 已发布；rejected 拒稿贯穿
    // 投稿卡状态：直接展示 submission 原生 status 字段（带颜色区分，不映射中文）
    const statusHtml = rawStatus==='rejected' ? `<span style='color:#f85149'>${esc(rawStatus)}</span>`
      : rawStatus==='published' ? `<span style='color:#3fb950'>${esc(rawStatus)}</span>`
      : rawStatus==='crafted' ? `<span style='color:#d29922'>${esc(rawStatus)}</span>`
      : rawStatus==='collected' ? `<span style='color:#4f8cff'>${esc(rawStatus)}</span>`
      : `<span class='muted'>${esc(rawStatus)}</span>`;
    // 采集卡：status 驱动（submitted=未采集；其余状态均视为已采集）
    const collectedOK = rawStatus !== 'submitted';
    let collectStatus;
    if (fetchingIds.has(id)) collectStatus = `<span style='color:#4f8cff'><span class='spin' style='display:inline-block'></span> 采集中</span>`;
    else if (rawStatus === 'rejected') collectStatus = (dt.collected === -1)
      ? `<span style='color:#f85149'>采集失败</span>`
      : `<span style='color:#f85149'>已拒稿</span>`;
    else if (dt.collected === -1) collectStatus = `<span style='color:#f85149;font-size:12px'>上次采集失败（未拒稿——可重试，或由编辑决定拒稿）</span> <button class='ac-act' data-fetch-id='${id}'>重试采集</button>`;
    else if (collectedOK) collectStatus = dc ? `<span style='color:#3fb950'>✓ ${dc.messages} 条消息 · 共计 ${dc.chars} 字</span>` : `<span style='color:#3fb950'>✓ 已采集</span>`;
    else collectStatus = `<button class='ac-act' data-fetch-id='${id}'>采集</button>`;
    const collectHeadClick = collectedOK ? "onclick='toggleCard(this)'" : '';
    const collectArrow = collectedOK ? `<span class='ac-arrow'>▾</span>` : '';
    const collectBodyHtml = collectedOK ? `<div class='ac-body' id='collectBody'><div class='muted'>加载中…</div></div>` : '';
    // 创作卡：仅采集成功后显示；状态由 status + 脚本数据驱动（无 approved 概念）
    const ps = d.prodSummary || null;
    // 审核采纳结果（submissions.review 后端权威；本地回填供旧控件读取）
    let review = (dt.review && typeof dt.review === 'object' && Object.keys(dt.review).length) ? dt.review : null;
    if (!review && typeof getWorkflowInput === 'function') { try { review = getWorkflowInput(id, 'review') || null; } catch {} }
    if (review && typeof setWorkflowInput === 'function') { try { setWorkflowInput(id, 'review', review); } catch {} }
    const hasReview = !!(review && typeof review.score === 'number');
    // 已有脚本 = 创作已进行（旧流程产物可能无 review 入库）——不再提供质量检测
    // 工作脚本：定稿前 R2 可能无 scripts（采纳后脚本先存本地槽）——R2 有则用 R2，无则用本地槽
    let workScripts = (ps && Array.isArray(ps.scriptList) && ps.scriptList.length) ? ps.scriptList : null;
    if ((!workScripts || !workScripts.length) && typeof getWorkflowInput === 'function') { try { const ws2 = getWorkflowInput(id, 'scripts'); if (Array.isArray(ws2) && ws2.length) workScripts = ws2; } catch {} }
    try { if (!window.__workScripts) window.__workScripts = {}; window.__workScripts[id] = workScripts || []; } catch {}
    const hasScripts = !!(workScripts && workScripts.length);
    // 渐进式步骤卡：审核没出结果，不显示创作卡（拒稿态/旧产物除外）
    const showCreateCard = collectedOK && (rawStatus === 'rejected' || hasReview || hasScripts);
    let auditCardHtml = '';
    if (rawStatus !== 'rejected' && rawStatus !== 'published') {
      auditCardHtml = hasReview ? `
        <div class='ac-card open'>
          <div class='ac-head'><h3 style='margin:0;font-size:14px'>审核</h3><span class='ac-status'><span style='color:#3fb950'>已审核 · 评分 ${esc(String((review && review.score) != null ? review.score : '?'))}</span></span></div>
          <div class='ac-body'>
            <div class='detail-info'>
              <div class='detail-row'><span class='k'>主线话题</span><span class='v'>${esc((review && review.main_topic) || '—')}</span></div>
              <div class='detail-row'><span class='k'>分类</span><span class='v'>${esc((review && review.category) || '—')}</span></div>
              <div class='detail-row'><span class='k'>用户的困惑</span><span class='v'>${esc((review && review.confusion) || '—')}</span></div>
              ${(Array.isArray(review && review.confusion_quotes) && review.confusion_quotes.length) ? `<div class='detail-row'><span class='k'>困惑原话</span><span class='v'>${review.confusion_quotes.map((q) => '“' + esc(String(q)) + '”').join(' ')}</span></div>` : ''}
              <div style='display:flex;align-items:baseline;gap:8px;margin:2px 0 4px'><span class='k' style='font-size:12px'>总分</span><span style='font-size:22px;font-weight:700;color:#3fb950'>${Number.isFinite(Number(review && review.score)) ? Number(review.score).toFixed(1) : esc(String((review && review.score) ?? '—'))}</span><span class='muted' style='font-size:11px'>（编辑参考，≥6.5 提示达标）</span></div>
              <div class='detail-row'><span class='k'>评分明细</span><span class='v'>${(Array.isArray(review && review['score-detail']) && review['score-detail'].length) ? review['score-detail'].map((x) => esc(String(x.dimension)) + ' ' + esc(String(x.score)) + '（×' + esc(String(x.weight)) + '）').join(' · ') : esc(String((review && review.score) ?? '—'))}</span></div>
              <div class='detail-row'><span class='k'>创作建议</span><span class='v'>${esc((review && review.advice) || '—')}</span></div>
            </div>
            <div style='margin-top:10px;display:flex;gap:8px'>
              <button class='ac-act' onclick='openScriptConsole("${id}")'>继续创作</button>
              <button class='pg' style='color:#f85149;border-color:#f85149' onclick='rejectSubmission("${id}")'>拒稿</button>
            </div>
          </div>
        </div>`
        : (storedProposals ? `<div class='ac-card open'>
          <div class='ac-head'><h3 style='margin:0;font-size:14px'>审核</h3><span class='ac-status'><span style='color:#4f8cff'>${storedProposals.length} 条提案待选择（分数仅供参考——选一条成为采纳结果，或全拒）</span></span><button class='ac-act' onclick='openReviewConsole("${id}")'>重新审题</button><span class='ac-arrow'>▾</span></div>
          <div class='ac-body'>${renderProposalCards(id, storedProposals)}</div>
        </div>`
          : (hasScripts ? `<div class='ac-card'><div class='ac-head'><h3 style='margin:0;font-size:14px'>审核</h3><span class='ac-status'><span class='muted'>已创作（旧流程产物，未入库 review）</span></span></div></div>` : `<div class='ac-card'><div class='ac-head'><h3 style='margin:0;font-size:14px'>审核</h3><span class='ac-status'><span class='muted'>待审核</span> <button class='ac-act' onclick='openReviewConsole("${id}")'>开始审题</button></span></div></div>`));
    }
    let createStatus, createBody;
    if (rawStatus === 'rejected') {
      createStatus = `<span style='color:#f85149'>已拒稿</span>`;
      createBody = `<div class='muted' style='white-space:pre-line'>拒审原因：${esc((ps && ps.rejection) || dt.rejectedReason || '（无）')}</div>`;
    } else if (rawStatus === 'crafted') {
      // 节目音频已生成并上传 R2（未发布）——创作完成态
      createStatus = `<span style='color:#3fb950'>✅ 创作完成</span>`;
      createBody = renderCraftedBody(id, (ps && ps.scriptList) || []);
    } else if (rawStatus === 'collected') {
      // 制作中：有脚本 → 脚本工作区（打磨/TTS/合成）；无脚本 → 开始创作（审题入口）
      const scripts = (workScripts && workScripts.length) ? workScripts : [];
      if (scripts.length) {
        createStatus = `<span style='color:#d29922'>创作中</span>`;
        // 渲染前预加载该投稿全部 seg 语音缓存（IndexedDB → 内存）——必须在 scriptCardsHtml/renderSegsHtml 构造之前，否则缓存判断落空显示 🔊
        if (typeof preloadSegAudioCache === 'function') await preloadSegAudioCache(id, scripts);
        const scriptCardsHtml = scripts.map((s, si) => {
            const segsAllAudio = (s.segments || []).length > 0 && (s.segments || []).every(seg => !!segAudioGet(segKey(id, seg)));
            return `<div style='margin-bottom:10px'>`
              + `<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:4px'>`
              +   `<div style='display:flex;align-items:center;gap:8px'><span class='who' style='font-size:11px;color:#d29922'>脚本 ${si + 1}（${(s.segments||[]).length} ${s && s.fidelity ? ' · 原话率 ' + s.fidelity.originalRate + '%（原话 ' + s.fidelity.hostOriginal + ' · 改写 ' + s.fidelity.hostRewrite + ' · 新写 ' + s.fidelity.hostNew + '）' : ''} 段）</span><button class='pg' onclick='openPolishConsole("${id}", ${si})'>打磨控制台</button></div>`
              +   `<span style='display:flex;align-items:center;gap:8px'>`
              +     `<label class='muted' style='font-size:11px;display:flex;align-items:center;gap:3px;cursor:pointer'><input type='checkbox' class='seg-select-all' data-si='${si}' onchange='toggleSelectAllSegs(${si}, this.checked)'>全选</label>`
              +     `<button class='pg seg-batch-tts' onclick='batchGenSegAudio("${id}", ${si})' data-si='${si}' disabled>批量生成语音</button>`
              +   `</span>`
              + `</div>`
              + `<div class='script-segs' data-si='${si}'>${renderSegsHtml(s, id, si)}</div>`
              + `<div style='display:flex;justify-content:flex-end;margin-top:8px'><button class='pg seg-merge-btn' data-si='${si}' onclick='openMergeDialog("${id}", ${si})' ${segsAllAudio ? '' : 'disabled'} title='${segsAllAudio ? '拼接全部段为完整 m4a' : '需全部段生成语音后才可合成'}' style='font-size:12px'>🎬 语音合成</button></div>`
              + `</div>`;
        }).join('');
        createBody = scriptCardsHtml ? scriptCardsHtml : `<div class='muted'>已创作，脚本列表为空</div>`;
      } else {
        // 阶段动作：审核在独立「审核」卡完成——创作卡只负责创作
        createStatus = hasReview
          ? `<button class='ac-act' onclick='openScriptConsole("${id}")'>创作脚本</button>`
          : `<span class='muted' style='font-size:12px'>待审核——先在「审核」卡做质量检测</span>`;
        createBody = '';
      }
    } else if (rawStatus === 'published') {
      // 已发布：创作卡锁定在该阶段的产物预览态——与 crafted 完全同渲染（脚本文稿 + 音频播放器）
      createStatus = `<span style='color:#3fb950'>已发布</span>`;
      // published：音频用发布后 episode 公开音频（episodes/... R2 对象），非 full/ 草稿源
      const epAudioId = (dt.episodes && dt.episodes[0] && dt.episodes[0].id) || null;
      const pubAudioSrc = epAudioId ? '/api/audio/episode?env=' + encodeURIComponent(labEnv || '') + '&episodeId=' + encodeURIComponent(epAudioId) : null;
      createBody = renderCraftedBody(id, (ps && ps.scriptList) || [], null, pubAudioSrc);
    } else {
      createStatus = '';
      createBody = '';   // submitted：未采集，创作卡不展开
      createBody = '';   // 未审核：单行卡片（仅头部按钮，无 body）
    }
    let publishCardBody = '';
    if (rawStatus === 'crafted' || rawStatus === 'published') {
      window.currentPubId = id;   // 发布卡表单/封面/发布共用
      window.workflowState = { id: id, audioKey: null, meta: null, cover: null };   // 发布步也持有同一工作流状态
      publishCardBody = (typeof renderPublishCard === 'function') ? renderPublishCard(id, dt, rawStatus, labEnv, (ps && ps.scriptList) || []) : '';
    }
    // 创作卡展开状态：脚本数据驱动（无 approved 概念）
    const scriptsExist = !!(ps && Array.isArray(ps.scriptList) && ps.scriptList.length);
    // 已发布：所有卡片尾部展示节目地址（slug 发布时存 pubmeta）
    let pubSlug = null;
    // 已发布节目地址：优先从 detail 的 episodes（服务端权威），兜底本地 pubmeta（发布时记录）
    try { if (dt.episodes && dt.episodes[0] && dt.episodes[0].slug) pubSlug = dt.episodes[0].slug; } catch {}   // episodes 在 detail 内（d.detail.episodes）
    if (!pubSlug && typeof loadPubMeta === 'function') { try { pubSlug = (loadPubMeta(id) || {}).slug || null; } catch {} }
    // 绝对节目 URL：siteUrl（envs.json）+ /episode/{slug}；无 siteUrl 时回退相对路径
    const siteBaseUrl = (d.siteUrl || '').replace(/\/$/, '');
    const pubUrl = pubSlug ? (siteBaseUrl ? siteBaseUrl + '/episode/' + pubSlug : '/episode/' + pubSlug) : null;
    const pubUrlHtml = pubUrl ? `<div class='detail-row' style='margin-top:10px'><span class='k'>节目地址</span><span class='v'><a href='${esc(pubUrl)}' target='_blank' rel='noopener'>${esc(pubUrl)}</a></span></div>` : '';
    // 默认展开：第一个（投稿卡）+ 可见范围的最后一个（按状态阶段动态：submitted→采集 / collected,rejected→创作 / crafted,published→发布）
    let lastOpenCard = 'collect';
    if (collectedOK) lastOpenCard = 'create';
    if (rawStatus === 'crafted' || rawStatus === 'published') lastOpenCard = 'publish';
    // dialogue 存浏览器缓存（sessionStorage）——本页数据源，不再依赖本地/重复请求
    wrap.innerHTML=`
      <span class='back' onclick='showList()'>← 返回列表</span>
      <div class='ac'>
        <div class='ac-card open'>
          <div class='ac-head' onclick='toggleCard(this)'><h3 style='margin:0;font-size:14px'>投稿</h3><span class='muted mono' style='font-size:11px'>${esc(d.id)}</span><span class='ac-status'>${statusHtml}</span><span class='ac-arrow'>▾</span></div>
          <div class='ac-body' style='position:relative'>
            <div class='detail-info'>
              <div class='detail-row'><span class='k'>标题</span><span class='v' id='subTitle'>${dt.title?esc(dt.title):'<span class="muted">加载中...</span>'}</span></div>
              <div class='detail-row'><span class='k'>投稿时间</span><span class='v'>${fmtDate(dt.createdAt)}</span></div>
              <div class='detail-row'><span class='k'>对话链接</span><span class='v'><a href='${esc(dt.url||'')}' target='_blank' rel='noopener'>${esc(dt.url||'—')}</a></span></div>
              <div class='detail-row'><span class='k'>投稿人</span><span class='v'>${esc(dt.host?.personaInfo?.displayName||'?')} · ${esc(dt.userEmail||'')}</span></div>
              <div class='detail-row'><span class='k'>称呼</span><span class='v'>${esc(dt.host?.callName||'（无，用「主持人」）')}</span></div>
              <div class='detail-row'><span class='k'>建议</span><span class='v'>${esc(dt.suggestion||'—')}</span></div>
              <div class='detail-row'><span class='k'>音色采样</span><span class='v'>${hostSampleV && hostUserIdV ? `<button class='sample-play' data-src="/api/audio/host?env=${encodeURIComponent(labEnv||'')}&userId=${encodeURIComponent(hostUserIdV)}" onclick='toggleSampleAudio(this)'>▶</button><span style='font-size:12px'>${esc(hostNameV)}</span>` : `<span class='muted' style='font-size:12px'>主持人无声样</span>`}&nbsp;&nbsp;&nbsp;${guestIdV ? `<button class='sample-play' data-src="/api/audio/guest?env=${encodeURIComponent(labEnv||'')}&platform=${encodeURIComponent(guestIdV)}" onclick='toggleSampleAudio(this)'>▶</button><span style='font-size:12px'>${esc(guestNameV)}</span> <button class='gv-icon-btn' title='管理声线' onclick='openGuestVoiceModal("${guestIdV}", "${esc(guestNameV)}")'>⚙</button>` : `<span class='muted' style='font-size:12px'>嘉宾无声线</span> <button class='gv-icon-btn' title='配置声线' onclick='openGuestVoiceModal("${guestIdV || ''}", "${esc(guestNameV)}")'>🎙</button>`}</span></div>
            </div>
            ${(rawStatus!=='published' && rawStatus!=='rejected')?`<button class='pg' style='position:absolute;right:12px;bottom:12px;font-size:12px;padding:4px 14px;color:#f85149;border-color:#f85149' onclick='rejectSubmission("${id}")'>拒稿</button>`:''}
          </div>
        </div>
        <div class='ac-card ${lastOpenCard==='collect'?'open':''}'>
          <div class='ac-head ${collectedOK?'':'muted'}' ${collectHeadClick}><h3 style='margin:0;font-size:14px'>采集</h3><span class='ac-status'>${collectStatus}</span>${collectArrow}</div>
          ${collectBodyHtml}
        </div>
        ${auditCardHtml}
        ${showCreateCard?`<div class='ac-card ${lastOpenCard==='create'?'open':''}'>
          <div class='ac-head' onclick='toggleCard(this)'><h3 style='margin:0;font-size:14px'>创作</h3><span class='ac-status'>${createStatus}</span><span class='ac-arrow'>▾</span></div>
          ${createBody?`<div class='ac-body'>${createBody}</div>`:''}
        </div>`:''}
        ${(rawStatus==='crafted'||rawStatus==='published')?`<div class='ac-card ${lastOpenCard==='publish'?'open':''}'>
          <div class='ac-head' onclick='toggleCard(this)'><h3 style='margin:0;font-size:14px'>发布</h3><span class='ac-status'>${rawStatus==='published'?'<span style="color:#3fb950">已发布</span>':'<span style="color:#d29922">待发布</span>'}</span><span class='ac-arrow'>▾</span></div>
          <div class="ac-body">${publishCardBody}</div>
        </div>`:''}
      </div>
      ${d.progress?`<div class='card' style='margin-top:12px'><div class='muted' style='font-size:12px'>进度：${esc(d.progress.step)} · ${esc(new Date(d.progress.updatedAt).toLocaleString())}</div></div>`:''}${pubUrlHtml}`;
    // 发布卡：仅 crafted/published 显示；表单/已发布态由 publish.js 渲染
    if (d.dialogue) { try { sessionStorage.setItem('dlg-'+id, JSON.stringify(d.dialogue)); } catch {} }
    // 发布卡：时长确定性数据自动检测（full audio loadedmetadata），发布时随 meta 携带
    if (rawStatus === 'crafted' && typeof initPubDur === 'function') { try { initPubDur(id, labEnv); } catch {} }
    // 发布卡：内容未填完整前禁用发布按钮（初始状态）
    if (rawStatus === 'crafted' && typeof updatePubSubmitState === 'function') { try { updatePubSubmitState(); } catch {} }
    if (collectedOK) loadCollectBody(id, dt.status==='rejected', d.dialogue);
    if (!dt.title) loadR2Title(id);
    // 发布卡：挂载通用 LLM 调用组件（预览 messages+config 可编辑 → 发送 → 收缩结果）
  }catch(e){
    wrap.innerHTML='<div class="err">加载失败: '+esc(e.message)+'</div>';
  }
}

// 手工拒绝投稿（未 published 前任意状态可拒；原因投稿人可见；预填审核的拒稿理由草稿）
async function rejectSubmission(id){
  let draft = '';
  if (typeof getWorkflowInput === 'function') {
    try {
      const rv = getWorkflowInput(id, 'review');
      if (rv && typeof rv.rejection_draft === 'string' && rv.rejection_draft.trim()) draft = rv.rejection_draft.trim();
      else if (rv && rv.score != null) {
        const s = Number(rv.score);
        draft = Number.isFinite(s)
          ? '这篇对话暂未达到创作标准（综合评分 ' + s.toFixed(1) + '）。如果你愿意，可以带着一个更想聊清楚的问题再来，很期待下一条对话。'
          : '';
      }
    } catch {}
  }
  const reason = draft ? prompt('填写拒稿原因（投稿人可见）:', draft) : prompt('填写拒稿原因（投稿人可见）:');
  if (reason === null) return;   // 取消
  if (!reason.trim()) { notice('请填写拒稿原因', 'error'); return; }
  try {
    await j('/api/run/reject', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ id, reason: reason.trim() }) });
    notice('✓ 已拒稿', 'success');
    if (typeof openDetail === 'function') openDetail(id);
  } catch (err) { notice('✗ 拒稿失败: ' + err.message, 'error'); }
}

async function loadR2Title(id){
  try{
    const d=await j('/api/r2title/'+id);
    const el=document.getElementById('subTitle');
    if (el) el.textContent = d.title || '(无标题)';
  }catch{
    const el=document.getElementById('subTitle');
    if (el) el.textContent='(无标题)';
  }
}

function loadCollectBody(id, rejected, dialogue){
  const el=document.getElementById('collectBody');
  if (!el) return;
  if (rejected){
    el.innerHTML='<div class="muted">投稿被拒，原始对话采集被删除</div>';
    return;
  }
  // 直接用详情页已返回的 dialogue（本页数据），不再请求 /api/draft
  if (!dialogue){ el.innerHTML='<div class="muted">无对话数据</div>'; return; }
  renderMessages(el, dialogue);
}

function renderMessages(el, data){
  const msgs=Array.isArray(data)?data:(data.messages||[]);
  el.innerHTML=msgs.map((m,i)=>`<div class='msg ${m.role==='user'?'user':'assistant'}'><input type='checkbox' class='msg-toggle' id='msg-${i}'><div class='who'>${m.role==='user'?'🧑 用户':'🤖 AI'}</div><div class='msg-body'>${esc(m.content)}</div><label for='msg-${i}' class='msg-expand show' title='展开全部'>▾</label><label for='msg-${i}' class='msg-expand hide' title='收起'>▴</label></div>`).join('')||'<div class="muted">（对话为空）</div>';
    const prevDisp = el.style.display;
    el.style.display = 'block';
    el.querySelectorAll('.msg').forEach(m => {
      const b = m.querySelector('.msg-body');
      m.classList.toggle('tall', !!(b && b.scrollHeight > b.clientHeight + 4));
    });
    el.style.display = prevDisp;
}

function toggleCard(head){
  head.parentElement.classList.toggle('open');
}

let batchTtsRunning = false;
function toggleSelectAllSegs(si, checked){
  document.querySelectorAll('.seg-check[data-si="' + si + '"]').forEach(c => { c.checked = checked; });
  updateBatchTtsBtn(si);
}
// 批量生成按钮可用态：有勾选才可点
function updateBatchTtsBtn(si){
  const btn = document.querySelector('.seg-batch-tts[data-si="' + si + '"]');
  if (!btn) return;
  const anyChecked = document.querySelectorAll('.seg-check[data-si="' + si + '"]:checked').length > 0;
  btn.disabled = !anyChecked || batchTtsRunning;
}
function batchGenSegAudio(id, si){
  // 惰性清理：批量生成开始时清一次过期缓存（避免循环内重复遍历）
  if (typeof clearExpiredSegAudio === 'function') clearExpiredSegAudio();
  const checks = [...document.querySelectorAll('.seg-check[data-si="' + si + '"]')].filter(c => c.checked);
  if (!checks.length) { notice('请先勾选要生成的片段', 'error'); return; }
  if (batchTtsRunning) return;
  batchTtsRunning = true;
  // 生成期间：禁用所有播放/重新生成按钮 + 打磨语感按钮
  document.querySelectorAll('.seg-tts-btn').forEach(b => { b.disabled = true; });
  document.querySelectorAll('.polish-btn').forEach(b => { b.disabled = true; });
  const btn = document.querySelector('.seg-batch-tts[data-si="' + si + '"]');
  if (btn) { btn.disabled = true; btn.textContent = '生成中 ' + 0 + '/' + checks.length + '...'; }
  const indices = checks.map(c => Number(c.dataset.segi));
  let done = 0;
  (async () => {
    for (const segi of indices) {
      // 待生成条目：side 整体替换为单个 ⌛（无 ▶↻）
      renderSegBusy(id, si, segi);
      try {
        const d = await j('/api/run/tts-seg', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ id, scriptIndex: si, segIndex: segi, scripts: labWorkScriptsOf(id) }) });
        const k = segRowKey(id, si, segi);
        const saved = k ? await segAudioSet(k, { audio: d.audio, mime: d.mime || 'audio/mpeg', at: Date.now() }) : false;
        // 完成：持久化成功 → ▶↻；失败 → ✗ + 重试（刷新会丢）
        if (saved) renderSegAudioBtn(id, si, segi);
        else { renderSegAudioFail(id, si, segi); notice('片段 ' + (segi + 1) + ' 已生成但未保存（存储失败）', 'error'); }
      } catch (e) {
        notice('片段 ' + (segi+1) + ' 生成失败: ' + e.message, 'error');
        renderSegAudioBtn(id, si, segi);   // 失败：恢复为 🔊 生成（无缓存时）
      }
      done++;
      if (btn) btn.textContent = '生成中 ' + done + '/' + checks.length + '...';
    }
    batchTtsRunning = false;
    document.querySelectorAll('.seg-tts-btn').forEach(b => { b.disabled = false; });
    document.querySelectorAll('.polish-btn').forEach(b => { b.disabled = false; });
    // 恢复批量按钮（无勾选则禁用）
    if (btn) { btn.textContent = '批量生成语音'; updateBatchTtsBtn(si); }
    if (typeof updateMergeBtn === 'function') updateMergeBtn(id, si);
    // 清除勾选
    document.querySelectorAll('.seg-check[data-si="' + si + '"]').forEach(c => { c.checked = false; });
    updateBatchTtsBtn(si);
    notice('✓ 批量生成完成 ' + done + '/' + checks.length + ' 段', 'success');
  })();
}

// 单段语音：生成/播放/重新生成（音频缓存：内存 Map + localStorage，跨会话持久）
// 缓存 key 与段内容 1:1 绑定：hash(speaker|text) —— 内容不变则命中（段落增删/下标变化不影响），内容改动自动失效
const segAudioCache = {};   // segKey → { audio: base64, mime, at }
function segHash(speaker, text){
  const s = (speaker || '') + '|' + (text || '');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
function segKey(id, seg){ return id + '-' + segHash(seg.speaker, seg.text); }
// 从 DOM row 取该段 segKey（渲染时已算好存 data-segkey）
function segRowKey(id, si, segi){
  const row = document.querySelector('.seg-row[data-si="' + si + '"][data-segi="' + segi + '"]');
  return row ? row.dataset.segkey : null;
}
function segAudioGet(key){
  // 只查内存缓存（写入在 IndexedDB；渲染前由 preloadSegAudioCache 批量读入内存——同步 API 无法直接读 IDB，localStorage 已不再写入）
  return segAudioCache[key] || null;
}
function segAudioSet(key, data){
  segAudioCache[key] = data;   // 内存先写（本页可播放）
  // IndexedDB 持久化（localStorage 5MB 上限，长段 TTS 单段就超——seg 缓存存 IndexedDB）
  // 返回是否持久化成功：失败时 UI 显示 ✗ + 重试（刷新后会丢，不显示可播放态）
  return idbOpen().then(db => new Promise((res) => {
    const tx = db.transaction('audios', 'readwrite');
    tx.objectStore('audios').put(data, 'seg-audio-' + key);
    tx.oncomplete = () => res(true);
    tx.onerror = () => res(false);
    tx.onabort = () => res(false);
  })).catch(() => false);
}
// 节目发布后批量清除该节目语音缓存（localStorage + 内存 Map）
function clearSegAudioCache(id){
  const prefix = 'seg-audio-' + id + '-';
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(prefix) === 0) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
  } catch {}
  // IndexedDB：删除该投稿全部 seg 缓存（seg-audio-{id}- 前缀）
  try {
    idbOpen().then(db => {
      const tx = db.transaction('audios', 'readwrite');
      const store = tx.objectStore('audios');
      const rq = store.getAllKeys();
      rq.onsuccess = () => {
        (rq.result || []).filter(k => typeof k === 'string' && k.indexOf(prefix) === 0).forEach(k => store.delete(k));
      };
    }).catch(() => {});
  } catch {}
  Object.keys(segAudioCache).forEach(k => { if (k.indexOf(id + '-') === 0) delete segAudioCache[k]; });
}
// 生成语音：调用 /api/run/tts-seg → 缓存 → 按钮变「播放 + 重新生成」
async function genSegAudio(id, si, segi){
  if (batchTtsRunning) return;
  // 惰性清理：生成时顺带清除过期的 IndexedDB 语音缓存（不阻塞生成）
  if (typeof clearExpiredSegAudio === 'function') clearExpiredSegAudio();
  const btn = document.querySelector('.seg-tts-btn[data-si="' + si + '"][data-segi="' + segi + '"]');
  if (btn && btn.dataset.generating) return;
  if (btn) { btn.dataset.generating = '1'; btn.textContent = '⏳'; btn.disabled = true; }
  try {
    const d = await j('/api/run/tts-seg', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ id, scriptIndex: si, segIndex: segi, scripts: labWorkScriptsOf(id) }) });
    const k = segRowKey(id, si, segi);
    const saved = k ? await segAudioSet(k, { audio: d.audio, mime: d.mime || 'audio/mpeg', at: Date.now() }) : false;
    if (saved) {
      renderSegAudioBtn(id, si, segi);
      if (typeof updateMergeBtn === 'function') updateMergeBtn(id, si);
    } else {
      // 已生成但未持久化：✗ + 重试（刷新会丢，不显示可播放态）
      renderSegAudioFail(id, si, segi);
      notice('⚠ 语音已生成但未保存（存储失败），请点 ✗ 重试', 'error');
    }
  } catch (e) {
    if (btn) { btn.textContent = '🔊'; btn.disabled = false; btn.title = '生成失败: ' + e.message; }
    notice('✗ 语音生成失败: ' + e.message, 'error');
  } finally {
    if (btn) delete btn.dataset.generating;
  }
}
// 生成成功但未持久化（IndexedDB 写入失败）：按钮显示 ✗ + 重试，不显示可播放态（刷新后会丢）
function renderSegAudioFail(id, si, segi){
  const side = document.querySelector('.seg-row[data-si="' + si + '"][data-segi="' + segi + '"] .seg-tts-side');
  if (!side) return;
  const btn = side.querySelector('.seg-tts-btn');
  if (btn) { btn.textContent = '✗'; btn.disabled = false; btn.title = '未保存（存储失败），点击重试'; btn.onclick = () => genSegAudio(id, si, segi); }
}

// 渲染语音按钮状态：无缓存 → 🔊生成；有缓存 → ▶播放 + ↻重新生成
// 生成中：side 整体替换为单个 ⌛（无 ▶↻）
function renderSegBusy(id, si, segi){
  const side = document.querySelector('.seg-row[data-si="' + si + '"][data-segi="' + segi + '"] .seg-tts-side');
  if (!side) return;
  side.innerHTML = '<button class="seg-tts-btn" title="生成中" disabled>⌛</button>';
}

function renderSegAudioBtn(id, si, segi){
  const side = document.querySelector('.seg-row[data-si="' + si + '"][data-segi="' + segi + '"] .seg-tts-side');
  if (!side) return;
  const btn = side.querySelector('.seg-tts-btn');
  if (!btn) return;
  const key = segRowKey(id, si, segi);
  const cached = segAudioGet(key);
  if (cached) {
    // 播放 + 重新生成（并排小按钮）
    const playingThis = playingSegKey === key;
    btn.outerHTML = `<span class='seg-tts-group'>`
      + `<button class='seg-tts-btn' onclick='playSegAudio("${id}", ${si}, ${segi})' title='${playingThis ? '暂停' : '播放'}'>${playingThis ? '⏸' : '▶'}</button>`
      + `<button class='seg-tts-btn' onclick='regenSegAudio("${id}", ${si}, ${segi})' title='重新生成'>↻</button>`
      + `</span>`;
    return;
  } else {
    btn.textContent = '🔊'; btn.title = '生成语音'; btn.disabled = false;
    btn.onclick = () => genSegAudio(id, si, segi);
  }
}
// 播放/暂停切换（单例 audio；播放中该段图标 ⏸，再点暂停回 ▶）
let segAudioEl = null;
let playingSegKey = null;
function playSegAudio(id, si, segi){
  if (batchTtsRunning) return;
  const key = segRowKey(id, si, segi);
  if (!key) return;
  const cached = segAudioGet(key);
  if (!cached) return;
  if (!segAudioEl) segAudioEl = new Audio();
  // 若正在播放该段 → 暂停
  if (playingSegKey === key && !segAudioEl.paused) {
    segAudioEl.pause();
    playingSegKey = null;
    updateSegPlayIcon(si, segi, false);
    return;
  }
  // 切换新段（停止上一个，DOM 反查其 si/segi 恢复图标）
  if (playingSegKey && playingSegKey !== key) {
    const prevRow = document.querySelector('.seg-row[data-segkey="' + playingSegKey + '"]');
    if (prevRow) updateSegPlayIcon(prevRow.dataset.si, prevRow.dataset.segi, false);
  }
  segAudioEl.src = 'data:' + (cached.mime || 'audio/mpeg') + ';base64,' + cached.audio;
  segAudioEl.onended = () => { if (playingSegKey === key) { playingSegKey = null; updateSegPlayIcon(si, segi, false); } };
  segAudioEl.onerror = () => { if (playingSegKey === key) { playingSegKey = null; updateSegPlayIcon(si, segi, false); } };
  segAudioEl.play().catch(() => {});
  playingSegKey = key;
  updateSegPlayIcon(si, segi, true);
}
// 更新该段播放按钮图标（▶播放 / ⏸暂停）
function updateSegPlayIcon(si, segi, playing){
  const grp = document.querySelector('.seg-row[data-si="' + si + '"][data-segi="' + segi + '"] .seg-tts-group');
  if (grp) {
    const playBtn = grp.querySelector('button:first-child');
    if (playBtn) { playBtn.textContent = playing ? '⏸' : '▶'; playBtn.title = playing ? '暂停' : '播放'; }
  }
}
// 重新生成（清缓存再生成）
function regenSegAudio(id, si, segi){
  const k = segRowKey(id, si, segi);
  if (!k) return;
  delete segAudioCache[k];
  try { localStorage.removeItem('seg-audio-' + k); } catch {}
  try {
    idbOpen().then(db => {
      const tx = db.transaction('audios', 'readwrite');
      tx.objectStore('audios').delete('seg-audio-' + k);
    }).catch(() => {});
  } catch {}
  genSegAudio(id, si, segi);
}

// 渲染单个脚本的 segs HTML（openDetail 与打磨局部刷新共用）
function renderSegsHtml(script, id, si){
  const segs = (script && script.segments) || [];
  const gapExprs = (typeof loadGapExprs === 'function') ? loadGapExprs(id, segs.length) : [];
  return segs.map((seg, segi) => `<div class='seg-row' data-si='${si}' data-segi='${segi}' data-segkey='${segKey(id, seg)}'>`
    + `<input type='checkbox' class='seg-check' data-si='${si}' data-segi='${segi}' onchange='updateBatchTtsBtn(${si})' style='align-self:center;flex-shrink:0'>`
    + `<div class='script-seg seg-${seg.speaker === 'guest' ? 'guest' : 'host'}'>`
      + `<div class='script-seg-head'><span class='who who-${seg.speaker === 'guest' ? 'guest' : 'host'}'>${esc(seg.speaker)}</span>${seg.speaker === 'host' ? (seg.src ? (seg.src === 'original' ? "<span style='color:#3fb950;font-size:10px;border:1px solid #3fb95066;border-radius:8px;padding:0 6px;margin-left:6px'>原话</span>" : seg.src === 'rewrite' ? "<span style='color:#d29922;font-size:10px;border:1px solid #d2992266;border-radius:8px;padding:0 6px;margin-left:6px'>改写</span>" : "<span style='color:#6e7681;font-size:10px;border:1px solid #30363d;border-radius:8px;padding:0 6px;margin-left:6px'>新写</span>") : '') : ''}<span>`
      + `<button class='seg-edit-btn' onclick='toggleSegEdit("${id}", ${si}, ${segi})'>编辑</button></span></div>`
      + `<div class='script-seg-view' id='sgsv-${id}-${si}-${segi}'>${esc(seg.text)}</div>`
      + `<div class='script-seg-edit' id='sgse-${id}-${si}-${segi}' style='display:none'>`
        + `<textarea class='seg-ta' spellcheck='false'>${esc(seg.text)}</textarea>`
        + `<div style='margin-top:6px;display:flex;gap:8px;justify-content:flex-end'>`
          + `<button class='pg seg-save-btn' data-si='${si}' data-segi='${segi}' onclick='saveSegEdit("${id}", ${si}, ${segi})'>保存</button>`
          + `<button class='pg seg-cancel-btn' data-si='${si}' data-segi='${segi}' onclick='cancelSegEdit("${id}", ${si}, ${segi})'>取消</button>`
        + `</div>`
      + `</div>`
    + `</div>`
    + `<div class='seg-tts-side'>`
      + (segAudioGet(segKey(id, seg))
          ? `<span class='seg-tts-group'><button class='seg-tts-btn' onclick='playSegAudio("${id}", ${si}, ${segi})' title='播放'>▶</button><button class='seg-tts-btn' onclick='regenSegAudio("${id}", ${si}, ${segi})' title='重新生成'>↻</button></span>`
          : `<button class='seg-tts-btn' data-si='${si}' data-segi='${segi}' onclick='genSegAudio("${id}", ${si}, ${segi})' title='生成语音'>🔊</button>`)
    + `</div>`
    + `</div>`
    + (segi < segs.length - 1 ? gapBubbleHtml(id, si, segi, gapExprs[segi] || defaultGapExpr()) : '')).join('');
}

// 创作成功预览态：仅显示 segs + full audio 播放器（合成后配置锁定）
function renderPreviewBody(id, scripts, fullMeta){
  const script = scripts[fullMeta.scriptIndex] || scripts[0] || { segments: [] };
  const segs = script.segments || [];
  const rows = segs.map((seg, i) => `<div class='script-seg seg-${seg.speaker === 'guest' ? 'guest' : 'host'}' style='margin-bottom:6px;padding:8px 10px'><span class='who who-${seg.speaker === 'guest' ? 'guest' : 'host'}'>${esc(seg.speaker)}</span> <span style='font-size:13px'>${esc(seg.text)}</span></div>`).join('');
  return `<div style='margin-bottom:8px'><span style='color:#3fb950'>✓ 语音合成完成</span><span class='muted' style='font-size:12px'>（${segs.length} 段 · ${(fullMeta.size / 1024 / 1024).toFixed(1)}MB · 间隔配置已锁定）</span></div>`
    + `<div style='margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap'>`
    + `<button class='pg' onclick='retryFullUpload(\"${id}\")' style='font-size:12px' ${fullMeta.r2Key ? "disabled title='已上传 R2'" : "title='R2 上传失败或未上传，重试'"}'>⬆ 重新上传 R2</button>`
    + `<button class='pg' onclick='resetFullAudio(\"${id}\")' style='font-size:12px'>🔄 重新合成</button>`
    + `</div>`
    + `<audio controls style='width:100%;margin-bottom:10px' id='fullPlayer-${id}'></audio>`
    + rows;
}
// 创作完成/已发布态：产物预览（脚本文稿只读 + 音频播放器）——crafted 用 full/{id}.m4a；published 用发布后 episode 公开音频
function renderCraftedBody(id, scripts, label, audioSrc){
  const script = scripts[0] || { segments: [] };
  const segs = script.segments || [];
  const rows = segs.map((seg, i) => `<div class='script-seg seg-${seg.speaker === 'guest' ? 'guest' : 'host'}' style='margin-bottom:6px;padding:8px 10px'><span class='who who-${seg.speaker === 'guest' ? 'guest' : 'host'}'>${esc(seg.speaker)}</span> <span style='font-size:13px'>${esc(seg.text)}</span></div>`).join('');
  const env = (typeof labEnv !== 'undefined' && labEnv) ? encodeURIComponent(labEnv) : '';
  const title = label || '✅ 创作完成';
  const src = audioSrc || `/api/audio/full?env=${env}&id=${encodeURIComponent(id)}`;
  return `<div style='margin-bottom:8px'><span style='color:#3fb950'>${title}</span><span class='muted' style='font-size:12px'>（节目音频，播放源 R2）</span></div>`
    + `<audio controls style='width:100%;margin-bottom:10px' src='/api/audio/full?env=${env}&id=${encodeURIComponent(id)}'></audio>`
    + (rows.length ? rows : `<div class='muted' style='font-size:12px'>（该投稿未保留脚本文稿——发布时脚本未入库）</div>`);
}
// 确认上传成功回调：刷新详情 → 创作卡片切创作完成态
function onMergeDone(id){ openDetail(id); }

// 异步填充 full audio 播放器（IndexedDB → Blob URL）
function fillFullPlayer(id){
  const el = document.getElementById('fullPlayer-' + id);
  if (!el || el.dataset.src) return;
  fullAudioLoad(id).then(blob => {
    if (blob) { el.src = URL.createObjectURL(blob); el.dataset.src = '1'; }
  }).catch(() => {});
}

// 脚本段落级手工修改：hover 显示编辑按钮，点编辑改该段文字（保存更新 R2 scripts 对应段）
function toggleSegEdit(id, si, segi){
  const view = document.getElementById('sgsv-' + id + '-' + si + '-' + segi);
  const edit = document.getElementById('sgse-' + id + '-' + si + '-' + segi);
  if (!view || !edit) return;
  const showing = edit.style.display !== 'none';
  const polishBtn = document.querySelector('.polish-btn[data-si="' + si + '"]');
  if (showing) {
    // 关闭编辑 → 恢复批量打磨
    edit.style.display = 'none'; view.style.display = '';
    if (polishBtn) polishBtn.disabled = false;
  } else {
    // 进入编辑 → 禁用批量打磨（避免编辑中被打磨覆盖）
    view.style.display = 'none'; edit.style.display = '';
    if (polishBtn) { polishBtn.disabled = true; polishBtn.title = '编辑中不可打磨'; }
  }
}
async function saveSegEdit(id, si, segi){
  const edit = document.getElementById('sgse-' + id + '-' + si + '-' + segi);
  const ta = edit ? edit.querySelector('.seg-ta') : null;
  const text = ta ? ta.value : '';
  // 保存中：局部锁定保存/取消/编辑按钮
  const saveBtn = document.querySelector('.seg-save-btn[data-si="' + si + '"][data-segi="' + segi + '"]');
  const cancelBtn = document.querySelector('.seg-cancel-btn[data-si="' + si + '"][data-segi="' + segi + '"]');
  const editBtn = document.querySelector('.script-seg[data-si="' + si + '"][data-segi="' + segi + '"] .seg-edit-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '保存中...'; }
  if (cancelBtn) cancelBtn.disabled = true;
  if (editBtn) { editBtn.disabled = true; editBtn.textContent = '保存中...'; }
  try {
    // 读当前脚本（本地工作副本优先），替换对应段——只写本地槽，不落 R2（合成确认时才定稿入库）
    const current = (labWorkScriptsOf(id) || []).slice();
    if (!current.length) throw new Error('未找到工作脚本（请先采纳脚本）');
    if (current[si] && current[si].segments && current[si].segments[segi]) {
      current[si].segments[segi].text = text;
      delete current[si].segments[segi].src;
      delete current[si].segments[segi].fromTurn;
      delete current[si].segments[segi].origRatio;
    }
    if (typeof setWorkflowInput === 'function') { try { setWorkflowInput(id, 'scripts', current); } catch {} }
    try { if (!window.__workScripts) window.__workScripts = {}; window.__workScripts[id] = current; } catch {}
    // 局部刷新：重绘该脚本 segs 区域（不整页 reload）；语音按钮按内容 key 自动命中/失效
    const segsEl = document.querySelector('.script-segs[data-si="' + si + '"]') || document.querySelector('.script-segs');
    if (segsEl) segsEl.innerHTML = renderSegsHtml(current[si], id, si);
    if (typeof updateMergeBtn === 'function') updateMergeBtn(id, si);
    // 原则①：手工编辑保存后同步素材 store（工作流输入源——meta 生成读到最新脚本）
    if (typeof setWorkflowInput === 'function') { try { setWorkflowInput(id, 'scripts', current); } catch {} }
    // 恢复批量打磨可用（编辑态由 toggleSegEdit 禁用）
    const polishBtn = document.querySelector('.polish-btn[data-si="' + si + '"]');
    if (polishBtn) { polishBtn.disabled = false; polishBtn.title = ''; }
    notice('✓ 已保存该段', 'success');
  } catch (e) {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '保存'; }
    if (cancelBtn) cancelBtn.disabled = false;
    if (editBtn) { editBtn.disabled = false; editBtn.textContent = '编辑'; }
    // 保存失败：恢复批量打磨可用
    const polishBtn = document.querySelector('.polish-btn[data-si="' + si + '"]');
    if (polishBtn) { polishBtn.disabled = false; polishBtn.title = ''; }
    alert('保存失败: ' + e.message);
  }
}
function cancelSegEdit(id, si, segi){
  const view = document.getElementById('sgsv-' + id + '-' + si + '-' + segi);
  const edit = document.getElementById('sgse-' + id + '-' + si + '-' + segi);
  if (view) view.style.display = '';
  if (edit) edit.style.display = 'none';
  // 恢复批量打磨可用
  const polishBtn = document.querySelector('.polish-btn[data-si="' + si + '"]');
  if (polishBtn) { polishBtn.disabled = false; polishBtn.title = ''; }
}
// （旧整 JSON 编辑已由段落级替代）

// 嘉宾声线弹窗：新增/修改（上传 mp3 + 朗读文本）
let guestVoiceCtx = { guestId: null, guestName: null };
function openGuestVoiceModal(guestId, guestName){
  guestVoiceCtx = { guestId, guestName };
  const label = document.getElementById('guestVoiceGuestLabel');
  if (label) label.textContent = '嘉宾：' + (guestName || guestId || '?');
  document.getElementById('guestVoiceTranscript').value = '';
  document.getElementById('guestVoiceFile').value = '';
  const st = document.getElementById('guestVoiceStatus');
  if (st) st.textContent = '';
  document.getElementById('guestVoiceModal').style.display = 'flex';
}
function closeGuestVoiceModal(){
  document.getElementById('guestVoiceModal').style.display = 'none';
}
async function submitGuestVoice(){
  const file = document.getElementById('guestVoiceFile').files[0];
  const transcript = document.getElementById('guestVoiceTranscript').value.trim();
  const st = document.getElementById('guestVoiceStatus');
  if (!guestVoiceCtx.guestId) { if (st) st.textContent = '❌ 未知嘉宾'; return; }
  if (!file) { if (st) st.textContent = '❌ 请选择 mp3 文件'; return; }
  if (file.size > 20 * 1024 * 1024) { if (st) st.textContent = '❌ 文件超过 20MB'; return; }
  const fd = new FormData();
  fd.append('audio', file);
  fd.append('language', 'zh');
  if (transcript) fd.append('transcript', transcript);
  if (st) st.textContent = '上传中...';
  try {
    await j('/api/audio/guest-voice?guestId=' + encodeURIComponent(guestVoiceCtx.guestId), { method:'POST', body: fd });
    if (st) st.textContent = '✅ 声线已保存';
    notice('嘉宾声线已保存', 'success');
    // 刷新当前投稿（播放可用）
    const id = location.pathname.slice(1);
    if (id) openDetail(id);
  } catch (e) {
    if (st) st.textContent = '❌ ' + e.message;
  }
}

// 采样试听：单例 audio，点击播放/暂停，播放完图标复位
let sampleAudio = null;
function toggleSampleAudio(btn){
  const src = btn.dataset.src;
  if (sampleAudio && sampleAudio.src === new URL(src, location.href).href && !sampleAudio.paused) {
    sampleAudio.pause();
    btn.textContent = '▶';
    return;
  }
  if (sampleAudio) { sampleAudio.pause(); const prev = document.querySelector('.sample-play[data-src="' + sampleAudio.src + '"]'); if (prev) prev.textContent = '▶'; }
  const a = new Audio(src);
  a.onended = () => { btn.textContent = '▶'; };
  a.onerror = () => { btn.textContent = '✕'; btn.disabled = true; btn.title = '采样音频不存在'; };   // 地址不存在 → disabled
  a.play().catch(() => { btn.textContent = '▶'; });
  sampleAudio = a;
  btn.textContent = '⏸';
}

// 发布卡：通用 LLM 调用组件实例（meta 元信息生成；预览 messages+config 可编辑）
function mountMetaBox(id){
  const mount = document.getElementById('metaBox');
  if (!mount || mount.dataset.mounted) return;
  mount.dataset.mounted = '1';
  const box = createLlmBox({
    mount,
    title: '加载中...',
    key: 'meta',
    url: '/api/run/publish',
    buildRequest: () => ({ id }),
    onDone: (result, usage) => {
      clearSegAudioCache(id);   // 发布完成：批量清除该节目语音缓存
      const r = result || {};
      const rows = [];
      if (r.title) rows.push('<div class="detail-row"><span class="k">标题</span><span class="v">' + esc(r.title) + '</span></div>');
      if (r.description) rows.push('<div class="detail-row"><span class="k">描述</span><span class="v">' + esc(r.description) + '</span></div>');
      if (r.category) rows.push('<div class="detail-row"><span class="k">分类</span><span class="v">' + esc(r.category) + '</span></div>');
      if (r.tags && Array.isArray(r.tags)) rows.push('<div class="detail-row"><span class="k">标签</span><span class="v">' + esc(r.tags.join(', ')) + '</span></div>');
      return '<div style="margin-bottom:6px"><span style="color:#3fb950">✓ 元信息已生成</span></div>' + rows.join('')
        + '<div class="muted" style="font-size:12px;margin-top:6px">' + esc(JSON.stringify(r).slice(0, 200)) + '…</div>';
    },
  });
  // 预取默认预览 JSON（渲染后的 messages+config）
  j('/api/run/publish', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ id, preview: true }) })
    .then(d => {
      if (d && d.preview) {
        box.setPreviewJson(JSON.stringify(d.preview, null, 2));
        if (d.preview.name) box.setTitle(d.preview.name);
        if (d.preview.description) box.setDescription(d.preview.description);
      }
    })
    .catch(() => {});
}

async function runStep(step,label){
  const id=location.pathname.slice(1);
  const st=document.getElementById('stepStatus');
  if(!st) return;
  st.textContent=label+' 执行中…';
  try{
    const d=await j('/api/run/'+step,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});
    st.textContent=(d.message||label+' 完成')+(d.detail?' — '+d.detail:'');
    setTimeout(()=>openDetail(id), 800);
  }catch(e){st.textContent='❌ '+e.message}
}
