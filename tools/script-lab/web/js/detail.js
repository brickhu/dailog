// 节目详情：投稿卡片 + 采集/创作/发布流程卡片 + 对话消息
async function openDetail(id){
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
    const hasScripts = !!(ps && Array.isArray(ps.scriptList) && ps.scriptList.length);
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
        : (hasScripts ? `<div class='ac-card'><div class='ac-head'><h3 style='margin:0;font-size:14px'>审核</h3><span class='ac-status'><span class='muted'>已创作（旧流程产物，未入库 review）</span></span></div></div>` : `<div class='ac-card'><div class='ac-head'><h3 style='margin:0;font-size:14px'>审核</h3><span class='ac-status'><span class='muted'>待审核</span> <button class='ac-act' onclick='openReviewConsole("${id}")'>质量检测</button></span></div></div>`);
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
      const scripts = (ps && ps.scriptList) || [];
      if (scripts.length) {
        createStatus = `<span style='color:#d29922'>创作中</span>`;
        // 渲染前预加载该投稿全部 seg 语音缓存（IndexedDB → 内存）——必须在 scriptCardsHtml/renderSegsHtml 构造之前，否则缓存判断落空显示 🔊
        if (typeof preloadSegAudioCache === 'function') await preloadSegAudioCache(id, scripts);
        const scriptCardsHtml = scripts.map((s, si) => {
            const segsAllAudio = (s.segments || []).length > 0 && (s.segments || []).every(seg => !!segAudioGet(segKey(id, seg)));
            return `<div style='margin-bottom:10px'>`
              + `<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:4px'>`
              +   `<div style='display:flex;align-items:center;gap:8px'><span class='who' style='font-size:11px;color:#d29922'>脚本 ${si + 1}（${(s.segments||[]).length} 段）</span><button class='pg' onclick='openPolishConsole("${id}", ${si})'>打磨控制台</button></div>`
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

// ===== 创作审核流程（LLM 结果先不入库，drawer 展示后确认/重试）=====
let currentReview = null;
let reviewing = false;
let drawerState = null;   // 当前 drawer 状态：preview / reviewing / error / result（关闭重开时恢复）
let drawerLocked = false;   // 状态1/确认中：禁止关闭（按钮 + 遮罩点击）
function setDrawerButtons({ close, retry, confirm, confirmText, send }) {
  drawerLocked = !!close;
  const closeBtn = document.getElementById('drawerClose');
  const retryBtn = document.getElementById('btnRetry');
  const confirmBtn = document.getElementById('btnConfirm');
  const sendBtn = document.getElementById('btnSend');
  if (closeBtn) { closeBtn.disabled = close; }
  if (retryBtn) { retryBtn.style.display = retry ? '' : 'none'; retryBtn.disabled = false; }
  if (confirmBtn) { confirmBtn.style.display = confirm ? '' : 'none'; confirmBtn.disabled = false; if (confirmText) confirmBtn.textContent = confirmText; }
  if (sendBtn) { sendBtn.style.display = send ? '' : 'none'; }
}
function openDrawerOverlay(){
  document.getElementById('drawerOverlay').classList.add('open');
  document.getElementById('drawer').classList.add('open');
}
// 状态0：点击「开始创作」→ 打开 drawer 预览 LLM 输入（可编辑 system/user/温度/seed），点「发送」才调 LLM
function restoreDrawerState(){
  // 关闭重开：按当前状态恢复按钮（内容保留在 drawerBody，不重新加载）
  if (drawerState === 'preview') setDrawerButtons({ close: false, retry: false, confirm: false, send: true });
  else if (drawerState === 'reviewing') setDrawerButtons({ close: true, retry: false, confirm: false, send: false });
  else if (drawerState === 'error') setDrawerButtons({ close: false, retry: true, confirm: false, send: false });
  else if (drawerState === 'result') setDrawerButtons({ close: false, retry: true, confirm: true, confirmText: '确认', send: false });
}
// 打开审题 drawer：内嵌两个 llm-box（评分 → 脚本），审题逻辑（round1/round2/confirm）不变
// round2 试点入口：LLM 控制台（采纳 = 触发 onDone → 业务写 scripts 产物槽）
async function openScriptConsole(id){
  if (typeof openLlmConsole !== 'function') { alert('llm-console.js 未加载'); return; }
  let review = null;
  if (typeof getWorkflowInput === 'function') { try { review = getWorkflowInput(id, 'review') || getWorkflowInput(id, 'selection'); } catch {} }
  const score = (review && typeof review.score === 'number') ? review.score : null;
  if (score == null) { alert('该投稿还没有审题评分——请先走「开始创作」完成 round1'); return; }
  openLlmConsole({
    id: id,
    key: 'review.script',
    title: 'round2 · 脚本创作（控制台试点）',
    url: '/api/run/review/round2',
    scoring: true,   // 对应 review.script 模板 config.scoring（提示词模板决定是否评分）
    buildRequest: () => ({ id: id, score: score, review: review }),
    onDone: async ({ request, response, meta }) => {
      // —— 纯业务：采纳这版 scripts → 落 R2（services scripts）→ 刷新后工作区稳定可读（不被 R2 空数据覆盖）——
      const scripts = (response && response.result && Array.isArray(response.result.scripts)) ? response.result.scripts : null;
      if (!scripts || !scripts.length) throw new Error('该版没有 scripts，未采纳');
      const d = await j('/api/run/script/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: id, scripts: scripts }) });
      if (!(d && d.ok)) throw new Error((d && d.error) || '脚本入库失败');
      if (typeof setWorkflowInput === 'function') { try { setWorkflowInput(id, 'scripts', scripts); } catch (e) { throw new Error('写产物槽失败：' + e.message); } }
      openDetail(id);   // 刷新 → 创作工作区出现脚本（打磨/TTS 用采纳结果）
    },
  });
}
// 语感打磨（polish.all）接入 LLM 控制台：多候选（dry）→ 采纳 = 替换 scripts[si] 并保存
async function openPolishConsole(id, si){
  if (typeof openLlmConsole !== 'function') { alert('llm-console.js 未加载'); return; }
  openLlmConsole({
    id: id, key: 'polish.all', title: '语感打磨（脚本 ' + (si + 1) + '，控制台）', url: '/api/run/polish',
    scoring: true,   // 对应 polish.all 模板 config.scoring
    buildRequest: () => ({ id: id, scriptIndex: si, dry: true }),   // 多候选：生成不落 R2
    onDone: async ({ response }) => {
      const polished = response && response.result;
      if (!polished || !Array.isArray(polished.segments)) throw new Error('该版没有打磨结果（segments）');
      let scripts = [];
      if (typeof getWorkflowInput === 'function') { try { const s = getWorkflowInput(id, 'scripts'); if (Array.isArray(s) && s.length) scripts = s; } catch {} }
      if (!scripts.length) throw new Error('产物槽无 scripts——请先经 round2 控制台采纳脚本');
      if (si >= scripts.length) throw new Error('脚本序号越界');
      const next = scripts.map((s, i) => (i === si ? polished : s));
      const d = await j('/api/run/script/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: id, scripts: next }) });
      if (!(d && d.ok)) throw new Error((d && d.error) || '保存失败');
      if (typeof setWorkflowInput === 'function') { try { setWorkflowInput(id, 'scripts', next); } catch {} }
      openDetail(id);   // 采纳生效：刷新工作区（该脚本用打磨版）
    },
  });
}
// 审核（round1）接入 LLM 控制台：采纳 = 审核结果存 review（submissions.review jsonb + 本地）——是否拒稿/继续创作由编辑决定
async function openReviewConsole(id){
  if (typeof openLlmConsole !== 'function') { alert('llm-console.js 未加载'); return; }
  openLlmConsole({
    id: id, key: 'review.score', title: '审核（round1 · 审题评分）', url: '/api/run/review/round1',
    scoring: true,   // 对应 review.score 模板 config.scoring
    buildRequest: () => ({ id: id }),
    onDone: async ({ response }) => {
      const r = response && response.result;
      if (!r || typeof r !== 'object') throw new Error('该版没有审题结果');
      // 采纳：审核产物整包存 review（submissions.review jsonb = 后端权威；本地同步供本页渲染）
      const d = await j('/api/run/review/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: id, review: r }) }).catch((e) => ({ __err: String((e && e.message) || e) }));
      if (!(d && d.ok)) {
        const detail = d && d.__err ? d.__err : ((d && d.error) || JSON.stringify(d).slice(0, 200) || '空响应');
        throw new Error('审核结果保存失败：' + detail);
      }
      if (typeof setWorkflowInput === 'function') { try { setWorkflowInput(id, 'review', r); } catch (e) { throw new Error('写审核结果失败：' + e.message); } }
      openDetail(id);
    },
  });
}
function openReviewDrawer(id){
  if (location.pathname.slice(1) !== id) history.pushState(null, '', '/' + id);
  const body = document.getElementById('drawerBody');
  body.innerHTML = '<div style="padding:4px 2px;display:flex;flex-direction:column;gap:8px"><div id="scoreBox"></div><div id="scriptBox"></div></div>';
  openDrawerOverlay();
  setDrawerButtons({ close: false, retry: false, confirm: false, send: false });
  mountReviewBoxes(id);
}

async function openReviewPreview(id){
  if (reviewing) return;
  // 同投稿且已加载过 → 直接重开，恢复原状态（不重新 fetch，保留编辑内容/审核结果）
  if (currentReview && currentReview.id === id && drawerState) {
    openDrawerOverlay();
    restoreDrawerState();
    return;
  }
  reviewing = true;
  currentReview = { id, result: null, opts: null };
  drawerState = null;
  const body = document.getElementById('drawerBody');
  body.innerHTML = '<div style="padding:24px 0;text-align:center"><span class="spin" style="display:inline-block;vertical-align:middle;width:14px;height:14px"></span> 加载预览...</div>';
  setDrawerButtons({ close: false, retry: false, confirm: false, send: false });
  openDrawerOverlay();
  try{
    const d = await j('/api/run/review/preview', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({id})});
    showReviewPreview(d);
  }catch(e){
    body.innerHTML = '<div class="err" style="margin:8px 0">预览加载失败：' + esc(e.message) + '</div>';
    setDrawerButtons({ close: false, retry: false, confirm: false, send: false });
  }finally{ reviewing = false; }
}
function showReviewPreview(p){
  drawerState = 'preview';
  const body = document.getElementById('drawerBody');
  const ta = 'width:100%;box-sizing:border-box;height:110px;background:#0b0d11;border:1px solid #262b36;color:#e6e8ee;border-radius:6px;padding:8px 10px;font-size:12px;font-family:ui-monospace,Menlo,monospace;resize:vertical';
  const taS = 'width:100%;box-sizing:border-box;height:140px;background:#0b0d11;border:1px solid #262b36;color:#e6e8ee;border-radius:6px;padding:8px 10px;font-size:12px;font-family:ui-monospace,Menlo,monospace;resize:vertical';
  const inp = 'width:80px;background:#0b0d11;border:1px solid #262b36;color:#e6e8ee;border-radius:4px;padding:4px 6px;font-size:12px';
  body.innerHTML = `
    <div style='font-size:13px;font-weight:600;margin-bottom:10px'>LLM 调用预览（两轮对话，可修改后发送）</div>
    <div class='muted' style='font-size:12px;margin-bottom:4px'>① 第1轮 系统提示词（打分规则）</div>
    <textarea id='previewSystem' spellcheck='false' style='${taS}'>${esc(p.system)}</textarea>
    <div class='muted' style='font-size:12px;margin:10px 0 4px'>① 第1轮 用户提示词（仅对话 json）</div>
    <textarea id='previewUser1' spellcheck='false' style='${ta}'>${esc(p.user1)}</textarea>
    <div class='muted' style='font-size:12px;margin:10px 0 4px'>② 第2轮 脚本规则（assistant 层，score≥6.5 才用）</div>
    <textarea id='previewScriptRule' spellcheck='false' style='${taS}'>${esc(p.scriptRule)}</textarea>
    <div class='muted' style='font-size:12px;margin:10px 0 4px'>② 第2轮 用户参数（suggestion / host / guests）</div>
    <textarea id='previewUser2' spellcheck='false' style='${ta}'>${esc(p.user2)}</textarea>
    <div style='display:flex;gap:24px;margin-top:12px;align-items:center'>
      <span class='muted' style='font-size:12px'>温度 <input id='previewTemp' type='number' step='0.1' min='0' max='2' value='${p.temperature}' style='${inp}'></span>
      <span class='muted' style='font-size:12px'>seed <input id='previewSeed' type='number' value='${p.seed ?? ''}' style='width:110px;background:#0b0d11;border:1px solid #262b36;color:#e6e8ee;border-radius:4px;padding:4px 6px;font-size:12px'></span>
    </div>
  `;
  setDrawerButtons({ close: false, retry: false, confirm: false, send: true });
}
function sendReview(){
  if (!currentReview) return;
  const id = currentReview.id;
  const system = document.getElementById('previewSystem').value;
  const user1 = document.getElementById('previewUser1').value;
  const scriptRule = document.getElementById('previewScriptRule').value;
  const user2 = document.getElementById('previewUser2').value;
  const temperature = document.getElementById('previewTemp').value;
  const seed = document.getElementById('previewSeed').value;
  startReview(id, { system, user1, scriptRule, user2, temperature, seed });
}
async function startReview(id, opts = {}){
  if (reviewing) return;
  reviewing = true;
  currentReview.opts = opts;
  drawerState = 'reviewing';
  // 状态1：LLM审题中...（禁关闭，隐藏 重试/确认/发送）
  const body = document.getElementById('drawerBody');
  body.innerHTML = '<div style="padding:24px 0;text-align:center"><span class="spin" style="display:inline-block;vertical-align:middle;width:14px;height:14px"></span> LLM审题中...</div>';
  setDrawerButtons({ close: true, retry: false, confirm: false, send: false });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 100000);   // LLM 审题超时兜底（100s）→ 状态2
  // footer 实时轮询 LLM 状态（诊断：注入/生成/解析各阶段）
  const pollTimer = setInterval(async () => {
    try {
      const st = await j('/api/status/review?id=' + encodeURIComponent(id));
      const u = document.getElementById('drawerUsage');
      if (u && st && st.state) u.textContent = (st.state.phase === 'done' ? '' : st.state.phase + ': ') + (st.state.detail || '');
    } catch {}
  }, 600);
  try{
    const d = await j('/api/run/review', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({id, ...opts}), signal: ac.signal});
    currentReview = { id, result: d.result, usage: d.usage || null, opts };
    showReviewDrawer(d.result, d.usage || null);   // 状态3：展示结果 + 重试/确认
  }catch(e){
    if (ac.signal.aborted) showReviewError('LLM 审题超时（100s），请重试');
    else showReviewError(e.message);   // 状态2：错误原因 + 重试
  }finally{
    clearTimeout(timer);
    clearInterval(pollTimer);
    reviewing = false;
  }
}
function showReviewDrawer(result, usage){
  drawerState = 'result';
  const body = document.getElementById('drawerBody');
  // 底部显示 LLM token 消耗
  const usageEl = document.getElementById('drawerUsage');
  if (usageEl) usageEl.textContent = usage ? ('输入 ' + usage.input + ' toks / 输出 ' + usage.output + ' toks') : '';
  const statusHtml = result.rejected
    ? `<span style='color:#f85149'>✗ 审核不通过（得分 ${result.score ?? '?'}）</span>`
    : `<span style='color:#3fb950'>✓ 审核通过（得分 ${result.score ?? '?'}）</span>`;
  const scoreDetail = Array.isArray(result['score-detail']) ? result['score-detail'] : [];
  // 脚本内容（.msg 样式；speaker=host → callName，speaker=guest → guestName）
  const scripts = !result.rejected && Array.isArray(result.scripts) ? result.scripts : [];
  const scriptsHtml = scripts.map((s, si) => {
    const segs = Array.isArray(s.segments) ? s.segments : [];
    const callName = s.host || '主持人';
    const guestName = s.guest || 'AI';
    return `<div style='margin-bottom:12px'><div class='who' style='font-size:11px;color:#d29922;margin-bottom:6px'>脚本 ${si + 1}</div>`
      + segs.map((seg, i) => `<div class='msg ${seg.speaker === 'guest' ? 'assistant' : 'user'}'><input type='checkbox' class='msg-toggle' id='scr-${si}-${i}'><div class='who'>${seg.speaker === 'guest' ? esc(guestName) : esc(callName)}</div><div class='msg-body'>${esc(seg.text)}</div><label for='scr-${si}-${i}' class='msg-expand show' title='展开全部'>▾</label><label for='scr-${si}-${i}' class='msg-expand hide' title='收起'>▴</label></div>`).join('')
      + '</div>';
  }).join('');
  body.innerHTML = `
    <div style='margin-bottom:12px;font-size:14px'>${statusHtml}</div>
    ${scoreDetail.length ? `<div style='margin-bottom:12px'><div style='font-size:13px;font-weight:600;margin-bottom:4px'>得分详情</div>${scoreDetail.map(sd => `<div style='display:flex;gap:8px;margin-bottom:12px'><span style='color:#8a91a0;font-size:12px;min-width:76px'>${esc(sd.dimension || '')}</span><span style='font-size:13px'><b>${sd.score ?? '—'}</b><span style='color:#8a91a0;font-size:11px'>（权重 ${sd.weight ?? '—'}）</span><div style='color:#8a91a0;font-size:12px;margin-top:2px'>${esc(sd.comment || '')}</div></span></div>`).join('')}</div>` : ''}
    <div class='detail-row'><span class='k'>标题</span><span class='v'>${esc(result.title || '—')}</span></div>
    <div class='detail-row'><span class='k'>主线</span><span class='v'>${esc(result.main_topic || '—')}</span></div>
    <div class='detail-row'><span class='k'>分类</span><span class='v'>${esc(result.category || '—')}</span></div>
    <div class='detail-row'><span class='k'>脚本</span><span class='v'>${(result.scripts||[]).length} 个${result.rejected ? '' : '（确认后进入创作）'}</span></div>
    ${scriptsHtml}
    ${result.rejected ? `<div class='detail-row'><span class='k'>拒审原因</span><span class='v' style='white-space:pre-line'>${esc(result.rejection || '—')}</span></div>` : ''}
    ${result.advice ? `<div class='detail-row'><span class='k'>建议</span><span class='v'>${esc(result.advice)}</span></div>` : ''}
  `;
  // 脚本消息超长折叠检测（同采集卡片 .msg 逻辑）
  requestAnimationFrame(() => {
    body.querySelectorAll('.msg').forEach(m => {
      const b = m.querySelector('.msg-body');
      m.classList.toggle('tall', !!(b && b.scrollHeight > b.clientHeight + 4));
    });
  });
  setDrawerButtons({ close: false, retry: true, confirm: true, confirmText: '确认' });
}
function showReviewError(msg){
  drawerState = 'error';
  const body = document.getElementById('drawerBody');
  body.innerHTML = '<div class="err" style="margin:8px 0">审题失败：' + esc(msg) + '</div>';
  setDrawerButtons({ close: false, retry: true, confirm: false });
}
function closeReviewDrawer(){
  if (drawerLocked) return;   // 状态1/确认中禁止关闭
  document.getElementById('drawerOverlay').classList.remove('open');
  document.getElementById('drawer').classList.remove('open');
}
async function confirmReview(){
  if (!currentReview) return;
  const id = currentReview.id;
  // 不关 drawer：锁定关闭 + 禁用 重试/确认，确认按钮显示"确认中...."
  drawerLocked = true;
  const retryBtn = document.getElementById('btnRetry');
  const confirmBtn = document.getElementById('btnConfirm');
  if (retryBtn) retryBtn.disabled = true;
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = '确认中....'; }
  try{
    // 审题结果随确认请求传回（不依赖 server 内存）
    await j('/api/run/review/confirm', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({id, result: currentReview.result})});
    currentReview = null;
    drawerLocked = false;
    closeReviewDrawer();
    openDetail(id);
  }catch(e){
    // 失败：解锁 + 恢复按钮
    drawerLocked = false;
    if (retryBtn) retryBtn.disabled = false;
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = '确认'; }
    alert(e.message);
  }
}
function retryReview(){
  if (!currentReview) return;
  // 不关 drawer，用原输入重新审题（进入状态1）
  startReview(currentReview.id, currentReview.opts || {});
}

// 批量生成语音：多选/全选 → 逐段生成；生成期间禁用所有播放/重新生成按钮
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
        const d = await j('/api/run/tts-seg', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ id, scriptIndex: si, segIndex: segi }) });
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
    const d = await j('/api/run/tts-seg', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ id, scriptIndex: si, segIndex: segi }) });
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
      + `<div class='script-seg-head'><span class='who who-${seg.speaker === 'guest' ? 'guest' : 'host'}'>${esc(seg.speaker)}</span><span>`
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

// 脚本批量打磨：一键直发（不走 llm-box 预览流程）——点「批量打磨」直接执行 → 局部刷新 segs
async function polishScript(id, si){
  const btn = document.querySelector('.polish-btn[data-si="' + si + '"]');
  if (btn) { btn.disabled = true; btn.textContent = '打磨中...'; }
  // 打磨期间隐藏该脚本所有段落编辑按钮
  document.querySelectorAll('.script-seg[data-si="' + si + '"] .seg-edit-btn').forEach(b => { b.style.display = 'none'; });
  try {
    const d = await j('/api/run/polish', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ id, scriptIndex: si }) });
    const result = d.result || {};
    const segs = (result && result.segments) || [];
    // 局部刷新：用打磨结果替换该脚本的 segs 展示（不整页 reload）
    const segsEl = document.querySelector('.script-segs[data-si="' + si + '"]') || document.querySelector('.script-segs');
    if (segsEl) segsEl.innerHTML = renderSegsHtml(result, id, si);
    if (typeof updateMergeBtn === 'function') updateMergeBtn(id, si);
    // 原则①：打磨结果同步素材 store（工作流输入源）——替换对应脚本，meta 生成读到最新版
    if (typeof getWorkflowInput === 'function' && typeof setWorkflowInput === 'function') {
      try {
        const cur = getWorkflowInput(id, 'scripts');
        if (Array.isArray(cur)) { cur[si] = result; setWorkflowInput(id, 'scripts', cur); }
        else setWorkflowInput(id, 'scripts', [result]);
      } catch {}
    }
    notice('✓ 打磨完成 ' + segs.length + ' 段' + (d.retried ? '（首次输出未改动，已自动重试）' : '') + (d.usage ? '（⚡ 输入 ' + d.usage.input + ' / 输出 ' + d.usage.output + ' toks）' : ''), d.retried ? 'error' : 'success');
  } catch (e) {
    notice('✗ 打磨失败: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '批量打磨'; }
    // 恢复段落编辑按钮显示
    document.querySelectorAll('.script-seg[data-si="' + si + '"] .seg-edit-btn').forEach(b => { b.style.display = ''; });
  }
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
    // 读当前 scripts（服务端 R2 权威），替换对应段后整体保存
    const d = await j('/api/detail/' + id);
    const current = ((d.prodSummary && d.prodSummary.scriptList) || []).slice();
    if (current[si] && current[si].segments && current[si].segments[segi]) {
      current[si].segments[segi].text = text;
    }
    await j('/api/run/script/save', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ id, scripts: current }) });
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

// 创作卡：审题两步 → 两个 llm-box 组件（评分 → 脚本，脚本依赖评分结果启用）
function mountReviewBoxes(id){
  const scoreMount = document.getElementById('scoreBox');
  const scriptMount = document.getElementById('scriptBox');
  if (!scoreMount || scoreMount.dataset.mounted) return;
  scoreMount.dataset.mounted = '1';
  // 累积审题结果（round1 检测 + round2 脚本），确认入库时合并提交
  const reviewAcc = { result: null, scripts: null, score: null, rejected: false };
  let scriptBox = null;   // 组件2实例——确认时读取质量打分（未打分则按钮被禁用，进不来）
  window.__confirmReview = confirmReviewBoxes;   // 供 llm-box 内联确认按钮调用
  // 确认入库：合并 round1+round2 结果 → /api/run/review/confirm（服务端写 DB 决策 + R2 scripts + 拒稿通知 + 打分）
  async function confirmReviewBoxes(){
    const merged = { ...(reviewAcc.result || {}) };
    if (reviewAcc.scripts) merged.scripts = reviewAcc.scripts;
    const fb = (scriptBox && typeof scriptBox.getFeedback === 'function') ? scriptBox.getFeedback() : null;
    const extra = {};
    if (fb && fb.score) { extra.score = fb.score; extra.fbTypes = fb.types; extra.note = fb.note || null; }
    const btn = document.querySelector('#drawerBody .llm-box-confirm');
    if (btn) { btn.disabled = true; btn.textContent = '确认中...'; }
    try {
      await j('/api/run/review/confirm', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ id, result: merged, ...extra }) });
      closeReviewDrawer();
      openDetail(id);
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = '确认入库'; }
      alert('确认失败: ' + e.message);
    }
  }
  // 组件2（脚本）：初始禁用；round1 完成且 score>=6.5 时启用 + 注入预览
  if (scriptMount && !scriptMount.dataset.mounted) {
    scriptMount.dataset.mounted = '1';
    scriptBox = createLlmBox({
      mount: scriptMount,
      title: '加载中...',
      key: 'review.script',
      url: '/api/run/review/round2',
      feedback: true,   // round2 结果区启用质量标记（提示词进化数据源）
      buildRequest: () => {
        // 原则①：round2 输入从 store 取——round1 选题（advice/main_topic/category）随请求传给 lab
        let review = null;
        if (typeof getWorkflowInput === 'function') { try { review = getWorkflowInput(id, 'review') || getWorkflowInput(id, 'selection'); } catch {} }
        return { id, score: scriptBox.__score, review };
      },
      onDone: (result, usage) => {
        const scripts = (result && result.scripts) || [];
        reviewAcc.scripts = scripts;
        // 原则①：草稿脚本（round2 输出原样）写入素材 store——打磨/meta 的工作流输入
        if (typeof setWorkflowInput === 'function') { try { setWorkflowInput(id, 'scripts', scripts); } catch {} }
        return '<div style="margin-bottom:6px"><span style="color:#3fb950">✓ 脚本已生成</span> <span class="muted">' + scripts.length + ' 个</span></div>'
          + scripts.map((s, si) => '<div class="muted" style="font-size:12px;margin-top:4px">脚本 ' + (si+1) + '：' + esc(JSON.stringify(s).slice(0, 120)) + '…</div>').join('')
          + '<div class="llm-box-confirm-wrap"><button class="pg llm-box-confirm" type="button" onclick="window.__confirmReview&&window.__confirmReview()">确认入库</button></div>';
      },
    });
    // 初始禁用（等 round1 结果）
    scriptMount.style.display = 'none';
    scriptMount.dataset.disabled = '1';
  }
  // 组件1（评分）
  const box1 = createLlmBox({
    mount: scoreMount,
    title: '加载中...',
    key: 'review.score',
    url: '/api/run/review/round1',
    buildRequest: () => ({ id }),
    onDone: (result, usage) => {
      const rejected = result && result.rejected;
      const score = result ? result.score : null;
      const passed = !rejected && Number(score) >= 6.5;
      reviewAcc.result = result;
      reviewAcc.score = score;
      reviewAcc.rejected = !!rejected;
      // 原则①：审题产物（round1 输出原样）写入素材 store——round2/meta 的工作流输入源
      if (typeof setWorkflowInput === 'function') { try { setWorkflowInput(id, 'review', result); } catch {} }
      // 采纳结果同步到投稿（submissions.review jsonb）——跨端/创作卡的权威输入源
      j('/api/run/review/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, review: result }) }).catch(() => {});
      const html = rejected
        ? '<span style="color:#f85149">✗ 审核不通过（得分 ' + (score ?? '?') + '）</span>'
        : '<span style="color:#3fb950">✓ 评分 ' + (score ?? '?') + (passed ? '（可进入脚本创作）' : '（<6.5 不满足创作）') + '</span>';
      // 启用/禁用组件2
      if (scriptBox && scriptMount) {
        if (passed) {
          scriptMount.style.display = '';
          scriptMount.dataset.disabled = '';
          scriptBox.__score = score;
          // 预取 round2 预览（注入 score + 审核材料 review——user 消息含 {{review}}）
          let sel = null;
          if (typeof getWorkflowInput === 'function') { try { sel = getWorkflowInput(id, 'review') || getWorkflowInput(id, 'selection'); } catch {} }
          j('/api/run/review/round2', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ id, score, review: sel, preview: true }) })
            .then(d => {
              if (d && d.preview) {
                scriptBox.setPreviewJson(JSON.stringify(d.preview, null, 2));
                if (d.preview.name) scriptBox.setTitle(d.preview.name);
                if (d.preview.description) scriptBox.setDescription(d.preview.description);
              }
            })
            .catch(() => {});
        } else {
          scriptMount.style.display = 'none';
          scriptMount.dataset.disabled = '1';
        }
      }
      // 拒稿（rejected 或 score<6.5）：无脚本步骤，直接可确认入库
      if (rejected || !passed) {
        return html + '<div class="llm-box-confirm-wrap"><button class="pg llm-box-confirm" type="button" onclick="window.__confirmReview&&window.__confirmReview()">确认入库</button></div>';
      }
      return html;
    },
  });
  // 预取 round1 预览
  j('/api/run/review/round1', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ id, preview: true }) })
    .then(d => {
      if (d && d.preview) {
        box1.setPreviewJson(JSON.stringify(d.preview, null, 2));
        if (d.preview.name) box1.setTitle(d.preview.name);
        if (d.preview.description) box1.setDescription(d.preview.description);
      }
    })
    .catch(() => {});
}


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
