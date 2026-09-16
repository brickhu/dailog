// 节目详情：投稿卡片 + 采集/创作/发布流程卡片 + 对话消息
//
// 卡片状态机（唯一的判据都从这里取，别再在各处手写键名判断）：
//   采集：submitted=待采集 / collectedDone=已采集
//   审题：待审题 → 审题中（生成中 → 审题选择）→ 审题锁定；确认提案只锁选题，创作是下一步独立动作
//   创作：未锁定=待锁定选题（不可创作）/ 已锁定=创作脚本 / 有脚本=已有一版（可「重新创作」）
//   发布：crafted=待发布 / published=已发布
// 三个槽（localStorage，见 assets.js）：proposals=最近一轮 R1 结果 / review=锁定的提案 / scripts=[仅一版]
/** 提案的方向字段：v5 叫「创作意见」，v4 是「创作建议」，老提案是「创作指引」——只在这里兼容 */
function proposalDirOf(r){
  if (!r || typeof r !== 'object') return '';
  const v5 = r['创作意见'];
  if (typeof v5 === 'string' && v5.trim()) return v5.trim();
  const v4 = r['创作建议'];
  if (typeof v4 === 'string' && v4.trim()) return v4.trim();
  const v11 = r['创作指引'];
  return (typeof v11 === 'string') ? v11.trim() : '';
}
/** 一条提案是否成形（旧契约：v4/v5/v11 特征字段；新契约：creative_proposal 九字段） */
function isProposal(r){
  if (!r || typeof r !== 'object') return false;
  if (r.core_question && (r.central_tension || r.possible_discovery)) return true;   // 新契约（creative_proposal / thread）
  return !!(r['提案陈述'] || proposalDirOf(r) || r['立场'] || r['钥匙'] || r['听众钥匙'] || r['解题思路'] || r['对话总结'] || r['选题说明'] || r['切片']);
}
/** 最近一次从服务端取到的详情快照（内存，每次打开详情页刷新）。
 *  用途：锁定选题 / 审题结果这类**状态**，一律以服务端为准——绝不拿浏览器缓存当判据。 */
function srvOf(id){ return (window.__srv && window.__srv[id]) || null; }
/** 取「已锁定的提案」——服务端 submissions.review，没有则 null（创作入口的唯一前置条件） */
function lockedProposalOf(id){
  const s = srvOf(id);
  return (s && isProposal(s.review)) ? s.review : null;
}
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
    window.workflowState = { id: id, audioKey: null, meta: null, cover: null };
    const d=await j('/api/detail/'+id);
    const dt=d.detail||{};
    if (typeof initAssets === 'function') { try { initAssets(id, dt, d.dialogue || null); } catch {} }
    const rawStatus = dt.status || '?';
    const isSubmitted = rawStatus==='submitted';
    const isRejected  = rawStatus==='rejected';
    const isPublished = rawStatus==='published';
    const isCrafted   = rawStatus==='crafted';
    const isSelected  = rawStatus==='selected';
    const isCollected = rawStatus==='collected';
    const collectedDone = isCollected || isSelected || isCrafted || isPublished;
    const dc = dt.dialogueCount || null;
    // 对话总轮数（卡片一句话里用："共计 N 轮对话"）
    const totalTurns = (d.dialogue && Array.isArray(d.dialogue.messages)) ? d.dialogue.messages.length
      : ((dc && dc.messages) ? dc.messages : null);
    const ps = d.prodSummary || null;
    const production = (d.production && typeof d.production === 'object') ? d.production : {};
    // ===== 装载顺序（规则）：本地缓存优先 → 本地没有拉远程 → 远程没有就是 null → 远程拉下来的回填本地 =====
    const remoteReview = (dt.review && typeof dt.review === 'object' && Object.keys(dt.review).length) ? dt.review : null;
    const remoteScripts = (ps && Array.isArray(ps.scriptList)) ? ps.scriptList : [];
    const remoteProps = (production.reviewProposals && typeof production.reviewProposals === 'object') ? production.reviewProposals : null;
    const remoteMeta = (production.metadata && typeof production.metadata === 'object') ? production.metadata : null;
    const localReview = (typeof getWorkflowInput === 'function') ? (getWorkflowInput(id, 'review') || null) : null;
    const localProps = (typeof getWorkflowInput === 'function') ? (getWorkflowInput(id, 'proposals') || null) : null;
    const localScripts = (typeof getWorkflowInput === 'function') ? (getWorkflowInput(id, 'scripts') || null) : null;
    const localMeta = (typeof getWorkflowInput === 'function') ? (getWorkflowInput(id, 'metadata') || null) : null;
    const review = isProposal(localReview) ? localReview : remoteReview;                  // 本地优先
    if (!isProposal(localReview) && remoteReview) { try { setWorkflowInput(id, 'review', remoteReview); } catch (e) {} }   // 远程 → 本地
    const propsRec = localProps ? localProps : remoteProps;   // 本地有（哪怕是显式空）就不拉远程
    if (localProps === null && remoteProps) { try { setWorkflowInput(id, 'proposals', remoteProps); } catch (e) {} }
    // 本地「有」= 键存在（哪怕是空数组，表示本地已清空，别再拉远程）；只有本地完全没有这个键才拉远程
    const hasLocalScripts = Array.isArray(localScripts);
    const workScripts = hasLocalScripts ? (localScripts.length ? localScripts : null) : (remoteScripts.length ? remoteScripts : null);
    if (!hasLocalScripts && remoteScripts.length) { try { setWorkflowInput(id, 'scripts', remoteScripts); } catch (e) {} }
    if (!localMeta && remoteMeta) { try { setWorkflowInput(id, 'metadata', remoteMeta); } catch (e) {} }
    try { if (!window.__workScripts) window.__workScripts = {}; window.__workScripts[id] = workScripts || []; } catch {}
    const hasScripts = !!(workScripts && workScripts.length);
    // 创作卡内部状态 = 本地工作副本（创作中＝已有本地稿/正在生成，待创作＝还没有）；定稿由投稿状态 crafted 决定
    const creationState = (isCrafted || isPublished) ? 'done' : (hasScripts ? 'creating' : 'todo');
    try {
      if (!window.__srv) window.__srv = {};
      window.__srv[id] = { status: rawStatus, review: review, production: production, scripts: workScripts || [], creationState: creationState, proposals: propsRec };
    } catch (e) {}
    let storedProposals = null;
    let proposalsRejected = null;   // 审题结果为空提案时的 rejection 文案（审过但无合适视角/无达标）
    try {
      const _pr = propsRec;
      if (_pr && Array.isArray(_pr.proposals)) {
        if (_pr.proposals.length) storedProposals = _pr.proposals;
        else if (Array.isArray(_pr.rejection) && _pr.rejection.length) proposalsRejected = _pr.rejection[0];
        else if (Array.isArray(_pr.skipped) && _pr.skipped.length) {
          proposalsRejected = '这一轮没挑出提案，被判假的线：\n' + _pr.skipped.slice(0, 6).map(function (s) {
            return '· ' + String((s && s.line) || '').slice(0, 40) + '　' + String((s && s.why) || '');
          }).join('\n');
        }
        else proposalsRejected = '对话中暂无合适的选题视角（多为任务/修复类过程对话，无 user 思考推进）';
      }
    } catch {}
    const badge = function (color) { return "<span style='color:" + color + "'>" + esc(rawStatus) + "</span>"; };
    let statusHtml;
    if (isRejected) statusHtml = badge('#f85149');
    else if (isPublished) statusHtml = badge('#3fb950');
    else if (isCrafted) statusHtml = badge('#d29922');
    else if (isSelected) statusHtml = badge('#bc8cff');
    else if (isCollected) statusHtml = badge('#4f8cff');
    else statusHtml = "<span class='muted'>" + esc(rawStatus) + "</span>";
    // ---- 卡片 helper：entry=不可展开仅title行；process=可收起默认展开；result=可展开默认收起 ----
    const card = function (title, statusBody, bodyHtml, mode) {
      if (mode === 'entry') {
        return "<div class='ac-card'><div class='ac-head'><h3 style='margin:0;font-size:14px'>" + title + "</h3><span class='ac-status'>" + (statusBody || '') + "</span></div></div>";
      }
      const openCls = (mode === 'process') ? ' open' : '';
      return "<div class='ac-card" + openCls + "'><div class='ac-head' onclick='toggleCard(this)'><h3 style='margin:0;font-size:14px'>" + title + "</h3><span class='ac-status'>" + (statusBody || '') + "</span><span class='ac-arrow'>▾</span></div>" + (bodyHtml ? "<div class='ac-body'>" + bodyHtml + "</div>" : "") + "</div>";
    };
    const row = function (k, v) { return "<div class='detail-row'><span class='k'>" + k + "</span><span class='v'>" + v + "</span></div>"; };
    // 动作按钮（委托 data-act 分发，免内联带参 onclick）
    const actBtn = function (label, act, extra) { return "<button class='ac-act' data-act='" + act + "' data-id='" + id + "' " + (extra || '') + ">" + label + "</button>"; };
    // ================= 常规视图 =================
    let collectCardHtml = '';
    if (isSubmitted) {
      const fetching = fetchingIds.has(id);
      const fbBtn = " <button class='ac-act' data-act='browser-fallback' data-id='" + id + "'>浏览器兜底</button>";
      collectCardHtml = card('采集',
        fetching ? "<span style='color:#4f8cff'><span class='spin' style='display:inline-block'></span> 采集中</span>"
                 : ("<button class='ac-act' data-fetch-id='" + id + "'>采集</button>" + (dt.collected === -1 ? fbBtn : '')),
        '', 'entry');
    } else if (collectedDone) {
      let st = '';
      if (dt.collected === -1) st = "<span style='color:#f85149;font-size:12px'>上次采集失败（可重试，或由编辑决定拒稿）</span> <button class='ac-act' data-fetch-id='" + id + "'>重试采集</button><button class='ac-act' data-act='browser-fallback' data-id='" + id + "'>浏览器兜底</button>";
      else st = dc ? "<span style='color:#3fb950'>✓ " + esc(dc.messages) + " 条消息 · 共计 " + esc(dc.chars) + " 字</span>" : "<span style='color:#3fb950'>✓ 已采集</span>";
      collectCardHtml = card('采集', st, "<div id='collectBody'><div class='muted'>加载中…</div></div>", 'result');
    }
    // chain 问题序列 → 人话箭头串（提案墙/审核卡展示用）
    const chainToText = function (chain) {
      if (!Array.isArray(chain)) return '';
      var sx = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
      var items = chain.map(function (c) {
        var txt = (c && typeof c.text === 'string') ? c.text
          : (c && typeof c.question === 'string') ? c.question
          : (c && typeof c.quote === 'string') ? c.quote : '';
        if (!txt) return '';
        // 三类拍：问 / 反应 / 判断（verdict = 他下的判断或否定，是链上的转折拍，标出来给编辑看）
        var tag = (c && c.type === 'verdict') ? '判断' : (c && c.type === 'reaction') ? '反应' : (c && c.type === 'ask') ? '问' : '';
        var tagStyle = (c && c.type === 'verdict') ? 'opacity:.95;margin-right:6px;color:#d29922;font-weight:600' : 'opacity:.75;margin-right:6px';
        return '<div style="padding:2px 0">' + (tag ? '<span class="tag" style="' + tagStyle + '">' + tag + '</span>' : '') + sx(txt) + '</div>';
      }).filter(Boolean);
      return items.length ? items.join('') : '';
    };
    // 提案卡渲染 + 6 行共享摘要（openDetail 局部，依赖 row/actBtn/id 闭包）
function proposalDetailRows(r, opts) {
    opts = opts || {};
    const big = opts.bigScore;   // 审核卡评分用大字号
    const e = function (s) { return String(s == null ? "" : s); };
    const rows = [];
    if (!r) return '';
    // ⓪ 新契约（creative_proposal / exploration thread）：core_question → 张力 → 转折 → 发现 → 终点 → 遗留问题
    if (r.core_question && (r.central_tension || r.possible_discovery)) {
      const r0 = [];
      if (r.thread_id || r.title) r0.push(row('这条线', e(r.thread_id) + (r.title ? ' · ' + e(r.title) : '')));
      r0.push(row('主问题', e(r.core_question)));
      if (r.initial_state) r0.push(row('起点', e(r.initial_state)));
      if (r.central_tension) r0.push(row('张力', e(r.central_tension)));
      if (r.exploration) r0.push(row('中段素材', e(r.exploration)));
      if (r.turning_point) r0.push(row('转折', e(r.turning_point)));
      if (r.possible_discovery) r0.push(row('可能的发现', e(r.possible_discovery)));
      if (r.ending_state) r0.push(row('终点', e(r.ending_state)));
      if (r.open_question) r0.push(row('留下的问题', e(r.open_question)));
      if (r.recommended_duration) r0.push(row('建议时长', e((r.recommended_duration.category || '') + ' 约 ' + (r.recommended_duration.minutes || ''))));
      const sc0 = r.score || {};
      const chips0 = Object.keys(sc0).map(function (k) { return k + ' ' + sc0[k]; }).join(' · ');
      if (chips0) r0.push(row('评分', chips0));
      if (Array.isArray(r.evidence) && r.evidence.length) r0.push(row('原文出处', r.evidence.map(function (x) { return e(x && x.speaker) + '：' + e(x && x.quote); }).join('\n')));
      if (r.editorial_reason) r0.push(row('编辑理由', e(r.editorial_reason)));
      return r0.join('');
    }
    // ① R1 v4 契约：**LLM 直接给一句成稿的提案陈述**，卡片照原样显示（不做拼接）
    if (r['提案陈述'] || r['创作意见'] || r['创作建议'] || r['立场'] || r['认知探索'] || r['听众钥匙'] || r['解题思路'] || r['对话总结']) {
      const rows4 = [];
      const toVal = (...vals) => { for (const v of vals) { if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim(); } return ''; };
      let stmt = toVal(r['提案陈述'], r['提案']);
      if (!stmt) {
        // 兜底：老提案没有「提案陈述」字段时，按同一模板拼一句（新提案不会走到这里）
        const dims = Array.isArray(r['score-detail']) ? r['score-detail'] : [];
        const pickDim = (name) => dims.find((x) => String((x && (x.dimension || x.d)) || '').indexOf(name) >= 0) || null;
        const fmtDim = (name) => { const d2 = pickDim(name); if (!d2) return ''; const s = (d2.score != null) ? d2.score : d2.s; const w = (d2.weight != null) ? d2.weight : d2.w; return name + ' ' + s + '×' + w; };
        const trimEnd = (v) => e(v).replace(/[。；;，,]\s*$/, '');
        const fl0raw = r['思辨'] || r['思辨过程'];
        const fl0 = (fl0raw && typeof fl0raw === 'object') ? fl0raw : { '从': (typeof fl0raw === 'string' ? fl0raw : ''), '到': e(r['钥匙'] || '') };
        const parts = ['这是一篇关于「' + trimEnd(r['对话总结']) + '」的对话，'];
        if (opts.totalTurns) parts.push('共计 ' + opts.totalTurns + ' 轮对话。');
        parts.push('用户站在「' + trimEnd(r['立场'] || r['认知探索']) + '」这个位置上，');
        if (fl0['从'] || fl0['到']) parts.push('对「' + trimEnd(r['话题']) + '」走了一段从「' + trimEnd(fl0['从']) + '」到「' + trimEnd(fl0['到']) + '」的思辨过程，');
        parts.push('覆盖原文 ' + trimEnd(r['覆盖轮次']) + '（共 ' + trimEnd(r['覆盖条数']) + ' 条）。');
        parts.push('它服务于 ' + trimEnd(r['目标听众']) + '，最后为听众留下一把「' + trimEnd(r['钥匙'] || r['尖'] || r['听众钥匙'] || r['解题思路']) + '」。');
        parts.push('评分：' + dims.map((x) => (x.dimension || x.d) + ' ' + ((x.score != null) ? x.score : x.s)).join('、') + '。');
        stmt = parts.join('');
      }
      if (stmt) rows4.push(row('提案', '<div style="line-height:1.9;white-space:pre-wrap">' + e(stmt) + '</div>'));
      // 钥匙单列一行（编辑一眼看到这期要交出什么）
      const keyTxt = e(r['钥匙'] || r['尖'] || r['听众钥匙'] || r['解题思路']);
      if (keyTxt) rows4.push(row('钥匙', "<div style='border-left:3px solid #d29922;padding:2px 0 2px 8px;background:#14120b;border-radius:4px;line-height:1.7'>" + keyTxt + "<div class='muted' style='font-size:11px;margin-top:2px'>收尾②要把这一句交出去</div></div>"));
      // v5 契约：立场 × 话题 × 思辨过程——编辑在这里核对"他站在哪、走到哪了"，R2 只呈现、不重排
      try {
        const thornTxt = e(r['立场'] || r['刺'] || '').trim();
        const sharpTxt = e(r['钥匙'] || r['尖'] || '').trim();
        const topicTxt = e(r['话题'] || '').trim();
        const towardTxt = e(r['对手'] || r['刺向'] || '').trim();
        const flowRaw2 = r['思辨'] || r['思辨过程'];
        const flowTxt2 = (typeof flowRaw2 === 'string') ? flowRaw2 : ((flowRaw2 && typeof flowRaw2 === 'object') ? [e(flowRaw2['从'] || ''), e(flowRaw2['到'] || '')].filter(Boolean).join(' → ') : '');
        if (thornTxt || sharpTxt || topicTxt || flowTxt2) {
          const bh = [];
          if (thornTxt) bh.push('<div style="padding:2px 0">· 立场：「' + thornTxt + '」</div>');
          if (sharpTxt) bh.push('<div style="padding:2px 0">· <b>钥匙</b>：「' + sharpTxt + '」' + (towardTxt ? '<span class="muted">　对手：' + towardTxt + '</span>' : '') + '</div>');
          if (topicTxt) bh.push('<div style="padding:2px 0">· 话题：' + topicTxt + '</div>');
          if (flowTxt2) bh.push('<div style="padding:2px 0">· 思辨：' + e(flowTxt2) + '</div>');
          rows4.push(row('立场 → 思辨 → 钥匙', "<div style='line-height:1.7;border-left:3px solid #3fb950;padding:2px 0 2px 8px;background:#0d1512;border-radius:4px'>" + bh.join('')
            + "<div class='muted' style='font-size:11px;margin-top:2px'>R2 只呈现、不重排台阶</div></div>"));
        }
      } catch (err) {}
      // 创作意见 = 单独字段（不进提案陈述），卡片单列一行——它就是 R2 唯一的输入，编辑可在此定稿
      const dirTxt = r['创作意见'] || r['创作建议'];
      if (dirTxt) rows4.push(row('创作意见', "<div style='border-left:3px solid #4f8cff;padding:2px 0 2px 8px;background:#0f1420;border-radius:4px;line-height:1.7;white-space:pre-wrap'>" + e(dirTxt) + "<div class='muted' style='font-size:11px;margin-top:2px'>↑ R2 收到的就是这一句</div></div>"));
      // 评分：三维分 × 权重 → 总分（权重和为 10，服务端按 REVIEW_WEIGHTS 算）
      const dims4 = Array.isArray(r['score-detail']) ? r['score-detail'] : [];
      if (dims4.length) {
        const dtxt = dims4.map(function (x) {
          const nm = x.dimension || x.d || '';
          const sc = (x.score != null) ? x.score : x.s;
          const wt = (x.weight != null) ? x.weight : x.w;
          return nm + ' ' + sc + (wt != null ? '×' + wt : '');
        }).join('、');
        const tot = (typeof r.score === 'number') ? r.score.toFixed(1) : '—';
        rows4.push(row('评分', "<div style='line-height:1.7'><b style='font-size:15px'>" + tot + "</b>　<span class='muted'>" + e(dtxt) + "（权重和 10）</span></div>"));
      }
      // 评分依据：只列证据原话（各维度分数已在那句话里）
      const evs = (Array.isArray(r['score-detail']) ? r['score-detail'] : [])
        .map(function (x) { return String((x && (x.comment || x.ev)) || '').trim(); }).filter(Boolean);
      if (evs.length) rows4.push(row('评分依据', evs.map(function (v) { return '<div style="padding:2px 0;opacity:.85">· ' + e(v) + '</div>'; }).join('')));
      return rows4.join('');
    }
    // ①' 上一代契约（v11）：选题说明 + 一句话创作指引
    if (r['创作指引'] || r['选题说明']) {
      const rows3 = [];
      const b = (r['选题说明'] && typeof r['选题说明'] === 'object') ? r['选题说明'] : {};
      if (b['切片']) rows3.push(row('切片', e(b['切片'])));
      if (b['为什么值得做']) rows3.push(row('为什么值得做', e(b['为什么值得做'])));
      if (b['受众']) rows3.push(row('受众', e(b['受众'])));
      if (Array.isArray(b['禁区']) && b['禁区'].length) rows3.push(row('禁区', e(b['禁区'].join(' · '))));
      const dir = (typeof r['创作指引'] === 'string') ? r['创作指引'] : '';
      if (dir) rows3.push(row('创作指引', "<div style='border-left:3px solid #4f8cff;padding:2px 0 2px 8px;background:#0f1420;border-radius:4px'>" + e(dir) + "<div class='muted' style='font-size:11px;margin-top:4px'>↑ R2 收到的就是这一句（原文注入，不给字段）</div></div>"));
      const scoreTxt3 = e((typeof r.score === 'number') ? r.score.toFixed(1) : '—');
      rows3.push(row('评分', big
        ? "<span style='font-size:18px;font-weight:700;color:#3fb950'>" + scoreTxt3 + "</span>"
        : "<span style='font-weight:600;color:#bc8cff'>" + scoreTxt3 + " 分</span>"));
      if (Array.isArray(r['score-detail']) && r['score-detail'].length) {
        const det3 = r['score-detail'].map(function (x) {
          const dim = (x.dimension != null) ? x.dimension : x.d;
          const sc = (x.score != null) ? x.score : x.s;
          const wt = (x.weight != null) ? x.weight : x.w;
          const cm = (x.comment != null) ? x.comment : x.ev;
          const cmHtml = cm ? '<div style="opacity:.7;padding-left:14px">' + e(cm) + '</div>' : '';
          return e(dim) + ' ' + e(sc) + '（×' + e(wt) + '）' + cmHtml;
        }).join('');
        rows3.push(row('评分明细', det3));
      }
      return rows3.join('');
    }
    // ② 上一代契约（draft v10）：who/value/carrier/endpoint/solve/process
    const isDraftCard = !!(r.who || r.value || typeof r.solve === 'string' || (Array.isArray(r.process) && r.process.length));
    if (isDraftCard) {
      const rows2 = [];
      if (r.who) rows2.push(row('听众', e(r.who)));
      if (r.value) rows2.push(row('价值', e(r.value)));
      if (r.carrier) rows2.push(row('载体', e(r.carrier)));
      const ep = (r.endpoint && typeof r.endpoint === 'object') ? (r.endpoint.problem || r.endpoint.ending || '') : (typeof r.endpoint === 'string' ? r.endpoint : '');
      if (ep) rows2.push(row('终点', e(ep)));
      if (r.solve) rows2.push(row('解题思路', e(r.solve)));
      const steps = Array.isArray(r.process) ? r.process : [];
      if (steps.length) {
        const stepHtml = steps.map(function (x, i) {
          const q = String((x && x.quote) || '');
          const ts = Array.isArray(x && x.turns) ? x.turns.map(function (t) { return 't' + (Number(t) + 1); }) : [];
          const qHtml = q ? ' <span style="opacity:.75">「' + e(q) + '」</span>' : '';
          const tHtml = ts.length ? ' <span class="tag" style="opacity:.7">' + e(ts.join(' ')) + '</span>' : '';
          return '<div style="padding:2px 0">' + e((x && x.no) || (i + 1)) + '. ' + e((x && x.step) || '') + qHtml + tHtml + '</div>';
        }).join('');
        rows2.push(row('推进步骤', stepHtml));
      }
      const scoreTxt2 = e((typeof r.score === 'number') ? r.score.toFixed(1) : '—');
      const scoreHtml = big
        ? "<span style='font-size:18px;font-weight:700;color:#3fb950'>" + scoreTxt2 + "</span>"
        : "<span style='font-weight:600;color:#bc8cff'>" + scoreTxt2 + " 分</span>";
      rows2.push(row('评分', scoreHtml));
      if (Array.isArray(r['score-detail']) && r['score-detail'].length) {
        const detHtml = r['score-detail'].map(function (x) {
          const dim = (x.dimension != null) ? x.dimension : x.d;
          const sc = (x.score != null) ? x.score : x.s;
          const wt = (x.weight != null) ? x.weight : x.w;
          const cm = (x.comment != null) ? x.comment : x.ev;
          const cmHtml = cm ? '<div style="opacity:.7;padding-left:14px">' + e(cm) + '</div>' : '';
          return e(dim) + ' ' + e(sc) + '（×' + e(wt) + '）' + cmHtml;
        }).join('');
        rows2.push(row('评分明细', detHtml));
      }
      if (Array.isArray(r.avoid) && r.avoid.length) rows2.push(row('禁区', e(r.avoid.join(' · '))));
      return rows2.join('');
    }
    // ③ 更早的旧提案：按老模板铺（兼容存量）
    const topic = r.topic || r.main_topic || (r.storyline && typeof r.storyline === 'object' ? String(r.storyline.topic || '').replace(/^这是关于「|」的对话$/g, '') : '') || '';
    let storyline = '';
    if (typeof r.storyline === 'string') storyline = r.storyline;
    else if (r.storyline && typeof r.storyline === 'object') storyline = String(r.storyline.topic || r.storyline.event || '').replace(/^这是关于「|」的对话$/g, '');
    const takeaway = r.takeaway || (r.storyline && typeof r.storyline === 'object' ? r.storyline.takeaway : '') || '';
    const chainQ = chainToText((r && r.chain) || []);
    if (topic) rows.push(row('主题', e(topic)));
    if (chainQ) rows.push(row('问题链', e(chainQ)));
    var angle = r.chain_type || r.angle || (r.storyline && typeof r.storyline === 'object' ? (r.storyline.angle || '') : '') || '';
    if (angle) rows.push(row('叙事视角', e(angle)));
    if (storyline) rows.push(row('叙事主线', e(storyline)));
    if (takeaway) rows.push(row('听众收获', e(takeaway)));
    var scoreTxt = e((r && typeof r.score === 'number') ? r.score.toFixed(1) : '—');
    rows.push(row('评分', big
      ? "<span style='font-size:18px;font-weight:700;color:#3fb950'>" + scoreTxt + "</span>"
      : "<span style='font-weight:600;color:#bc8cff'>" + scoreTxt + " 分</span>"));
    if (r && Array.isArray(r['score-detail']) && r['score-detail'].length) rows.push(row('评分明细', r['score-detail'].map(function (x) { return e(String(x.dimension || x.d)) + ' ' + e(String(x.score != null ? x.score : x.s)) + '（×' + e(String(x.weight != null ? x.weight : x.w)) + '）'; }).join(' · ')));
    return rows.join('');
  };
// 提案勾选列表（单选）：点一行勾选；下面一个「确认提案」按钮（只锁定选题，不调创作 LLM）
function renderProposalCards(id, proposals, totalTurns){
  if (!Array.isArray(proposals) || !proposals.length) return '<div class="muted">无提案——点「重新审题」重跑，或考虑拒稿</div>';
  var esc = function (s) { return String(s == null ? "" : s); };
  var picked = (window.__pickedProposal || {})[id];
  var rows = proposals.map(function (p, i) {
    var on = (picked === i);
    var det = proposalDetailRows(p, { totalTurns: totalTurns });   // 展示信息与选定后一致
    return "<div class='prop-row' data-prop='" + i + "' onclick='pickProposal(\"" + id + "\", " + i + ")' "
      + "style='border:1px solid " + (on ? "#4f8cff" : "#262b36") + ";border-left:3px solid " + (on ? "#4f8cff" : "#bc8cff") + ";border-radius:8px;padding:10px 12px;margin:0 0 10px;cursor:pointer;background:" + (on ? "#0f1420" : "#0b0d11") + "'>"
      + "<div style='display:flex;align-items:baseline;gap:10px;flex-wrap:wrap'>"
      + "<span class='prop-mark' style='font-size:15px;color:" + (on ? "#4f8cff" : "#8a91a0") + "'>" + (on ? "☑" : "☐") + "</span>"
      + "<b style='font-size:13px'>提案 " + (i + 1) + "</b>"
      + (p && p.__recommended ? "<span class='tag' style='color:#3fb950;border-color:#3fb950'>推荐</span>" : "")
      + (p && p.category ? "<span class='tag'>" + esc(p.category) + "</span>" : "")
      + "</div>"
      + (det ? "<div style='margin-top:6px'>" + det + "</div>" : "")
      + "</div>";
  }).join('');
  var none = (picked === undefined || picked === null);
  return rows
    + "<div style='margin-top:10px;display:flex;align-items:center;gap:10px'>"
    + "<button class='ac-act' id='createFromProposal' data-act='confirm-proposal' data-id='" + id + "' "
    + (none ? "disabled style='opacity:.5'" : "") + ">确认提案</button>"
    + "<span id='pickHint' class='muted' style='font-size:12px'>" + (none ? "先勾选一条提案" : "已选第 " + (picked + 1) + " 条（确认后进入创作卡）") + "</span>"
    + "</div>";
}
    // 6 行摘要审核卡包装
    const reviewDetailRows = function (r) { return proposalDetailRows(r, { bigScore: true, totalTurns: totalTurns }); };
    let auditCardHtml = '';
    // 卡片集合由投稿状态决定（规则 1）：collected 起才有审题卡；rejected 不显示
    if (collectedDone) {
      // 审题卡内部状态（规则 2.3）：待审题 / 审题中（生成中 → 审题选择）/ 审题锁定
      const reviewBusy = !!(window.__reviewBusy && window.__reviewBusy[id]);
      const lockedP = (review && isProposal(review)) ? review : null;   // 已锁定的提案
      const hasList = !!(storedProposals && storedProposals.length);    // 上一轮 R1 的选项还在
      const canRerun = !isPublished;                                    // 已发布是终态，审题卡只读
      if (reviewBusy) {
        auditCardHtml = card('审题', "<span style='color:#4f8cff'>审题中 · 生成中…（通常几秒）</span>", "", 'process');
      } else if (hasList && !lockedP) {
        // 生成完了、还没锁定 → 审题选择：勾一条 → 按该提案创作（锁定 + 进创作）
        auditCardHtml = card('审题', "<span style='color:#4f8cff'>审题中 · 审题选择：" + storedProposals.length + " 条提案</span> "
          + (canRerun ? actBtn('重新审题', 'review') : ''), renderProposalCards(id, storedProposals, totalTurns), 'process');
      } else if (proposalsRejected && !lockedP) {
        auditCardHtml = card('审题', "<span style='color:#f85149'>审题中 · 这一轮没挑出提案</span>",
          "<div class='detail-info'><div class='detail-row'><span class='k'>审题结论</span><span class='v'><div style='white-space:pre-wrap;line-height:1.7'>" + esc(proposalsRejected) + "</div></span></div></div>"
          + (canRerun ? "<div style='margin-top:10px;display:flex;gap:8px'>" + actBtn('重新审题', 'review') + "</div>" : ""), 'result');
      } else if (lockedP) {
        auditCardHtml = card('审题', "<span style='color:#bc8cff'>审题锁定</span> "
          + (canRerun ? actBtn('重新审题', 'review') : ''),
          "<div class='detail-info'>" + reviewDetailRows(lockedP) + "</div>", 'result');
      } else {
        auditCardHtml = card('审题', "<span class='muted'>待审题</span> "
          + (canRerun ? actBtn('开始审题', 'review') : ''), '', 'entry');
      }
    }
    let createCardHtml = '';
    // 卡片集合由投稿状态决定（规则 1）：selected 起才有创作卡（crafted/published 是它的后续态）
    if (isSelected || isCrafted || isPublished) {
      // 创作卡内部状态（规则 2.4）：待创作 / 创作中（生成中 → 脚本展示+编辑+打磨+TTS）/ 创作定稿
      const lockedC = (review && isProposal(review)) ? review : null;
      const genInFlight = !!(window.__creating && window.__creating[id]);   // R2 正在生成（弹窗里点了确认创作）
      const genBar = genInFlight ? "<div style='color:#4f8cff;font-size:12px;margin-bottom:8px'><span class='spin' style='display:inline-block'></span> 生成中…（思考模式通常 40-90 秒）</div>" : "";
      if (isCrafted || isPublished) {
        // 创作定稿：语音合成确认后的成稿（published 时成片音频也能直接听）
        const epAudioId = isPublished && dt.episodes && dt.episodes[0] ? dt.episodes[0].id : null;
        const pubAudioSrc = epAudioId ? '/api/audio/episode?env=' + encodeURIComponent(labEnv || '') + '&episodeId=' + encodeURIComponent(epAudioId) : null;
        createCardHtml = card('创作', "<span style='color:#3fb950'>创作定稿</span>", renderCraftedBody(id, (ps && ps.scriptList) || [], null, pubAudioSrc), 'result');
      } else if (creationState === 'creating') {
        if (hasScripts && typeof preloadSegAudioCache === 'function') { try { await preloadSegAudioCache(id, workScripts); } catch {} }
        // 生成中可能还没有脚本 → 空数组兜底（否则整页渲染失败）
        const scriptsHtml = (workScripts || []).map(function (s, si) {
          const canMerge = (typeof segCanMerge === 'function') ? segCanMerge(id, s.segments) : false;   // ≥2 段（或全部）有语音即可合成，未生成段会跳过
          // 打磨按钮：脚本区里**没有可磨的台词**（没段、或全是空文本）就禁用——点它没有任何东西可磨
          const canPolish = (s.segments || []).some(function (x) { return String((x && x.text) || '').trim(); });
          const fid = (s && s.fidelity) ? (" · 接话 " + (s.fidelity.hostNew || 0) + " 段") : '';
          const qHints = (function (sc) {
            const segs = (sc && sc.segments) || [];
            const long = segs.filter(function (x) { return String(x.text || '').length > 100; }).length;
            const tail = segs.slice(-3).map(function (x) { return String(x.text || ''); }).join('');
            const recap = /从[^，。；]{1,14}(退|走|聊|转|收|落|砍)到[^，。；]{1,14}/.test(tail);
            const tips = [];
            if (long) tips.push('超长段 ' + long);
            if (recap) tips.push('收尾疑似复盘');
            return tips.length ? " · <span style='color:#d29922'>⚠ " + tips.join(' · ') + "</span>" : '';
          })(s);
          return "<div style='margin-bottom:10px'>"
            + "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:4px'>"
            + "<div style='display:flex;align-items:center;gap:8px'><span class='who' style='font-size:11px;color:#d29922'>脚本 " + (si + 1) + "（" + (s.segments || []).length + " 段" + fid + qHints + "）</span>" + actBtn('打磨控制台', 'polish', "data-si='" + si + "' style='font-size:12px' " + (canPolish ? '' : "disabled title='脚本区里还没有台词——先创作或载入脚本' ")).replace("class='ac-act'", "class='pg'") + "</div>"
            + "<span style='display:flex;align-items:center;gap:8px'><label class='muted' style='font-size:11px;display:flex;align-items:center;gap:3px;cursor:pointer'><input type='checkbox' class='seg-select-all' data-si='" + si + "' onchange='toggleSelectAllSegs(" + si + ", this.checked)'>全选</label><button class='pg seg-batch-tts' data-act='tts' data-id='" + id + "' data-si='" + si + "' disabled>批量生成语音</button></span>"
            + "</div>"
            + "<div class='script-segs' data-si='" + si + "'>" + renderSegsHtml(s, id, si) + "</div>"
            + "<div style='display:flex;justify-content:flex-end;margin-top:8px'><button class='pg seg-merge-btn' data-act='merge' data-id='" + id + "' data-si='" + si + "' " + (canMerge ? '' : "disabled title='需至少生成 2 段（或全部段）语音——未生成段会被跳过'") + " style='font-size:12px'>🎬 语音合成</button></div>"
            + "</div>";
        }).join('');
        const createBody = scriptsHtml ? scriptsHtml + (typeof mergeBgmBarHtml === 'function' ? mergeBgmBarHtml(id) : '') : "<div class='muted'>脚本还没出来</div>";
        // 创作中：生成中 = 进度条；出稿后 =「脚本展示 + 编辑 + 打磨 + TTS」+ 卡片头「重新创作」
        // 这里展示的是**产物**：脚本来自服务端（本地草稿仅兜底未保存的编辑），和卡片状态无关
        createCardHtml = card('创作', "<span style='color:#d29922'>创作中</span> "
          + (hasScripts && !genInFlight ? actBtn('重新创作', 'create') : ''),
          genBar + (hasScripts ? createBody : ''), 'process');
      } else {
        // 待创作：有方向才能进创作（方向＝审题锁定的那条提案）
        createCardHtml = card('创作', "<span style='color:#8a91a0'>待创作</span> "
          + (lockedC ? actBtn('创作脚本', 'create') : ''),
          // 待创作：卡上不再重复「方向」（它在审题卡里）；有方向就是干净的一张待创作卡
          lockedC ? '' : "<div class='muted' style='font-size:12px'>先去审题卡片勾一条提案 →「确认提案」</div>", lockedC ? 'entry' : 'result');
      }
    }
    let publishCardHtml = '';
    if (isCrafted || isPublished) {
      window.currentPubId = id;
      window.workflowState = { id: id, audioKey: null, meta: null, cover: null };
      // 发布卡内部状态（规则 2.5）：待发布（输入框+自动填充）/ 发布中 / 发布完成
      const publishing = !!(window.__publishing && window.__publishing[id]);
      const pubStatus = isPublished
        ? "<span id='pubCardStatus' style='color:#3fb950'>发布完成</span>"
        : (publishing
          ? "<span id='pubCardStatus' style='color:#4f8cff'><span class='spin' style='display:inline-block'></span> 发布中…</span>"
          : "<span id='pubCardStatus' style='color:#d29922'>待发布</span>");
      const pubBody = (typeof renderPublishCard === 'function') ? renderPublishCard(id, dt, rawStatus, labEnv, (ps && ps.scriptList) || []) : '';
      publishCardHtml = card('发布', pubStatus, pubBody, isPublished ? 'result' : 'process');
    }
    let pubUrlHtml = '';
    if (isPublished) {
      let pubSlug = null;
      try { if (dt.episodes && dt.episodes[0] && dt.episodes[0].slug) pubSlug = dt.episodes[0].slug; } catch {}
      if (!pubSlug && typeof loadPubMeta === 'function') { try { pubSlug = (loadPubMeta(id) || {}).slug || null; } catch {} }
      const siteBaseUrl = (d.siteUrl || '').replace(/\/$/, '');
      const pubUrl = pubSlug ? (siteBaseUrl ? siteBaseUrl + '/episode/' + pubSlug : '/episode/' + pubSlug) : null;
      if (pubUrl) pubUrlHtml = "<div style='margin-top:12px;font-size:13px'><span class='k'>节目地址</span> <a href='" + esc(pubUrl) + "' target='_blank' rel='noopener'>" + esc(pubUrl) + "</a></div>";
    }
    const hostSampleV = (dt.voiceSamples && dt.voiceSamples[0]) || null;
    const hostUserIdV = dt.userId || null;
    const guestIdV = (dt.guest && dt.guest.id) || null;
    const hostNameV = (dt.host && (dt.host.callName || (dt.host.personaInfo && dt.host.personaInfo.displayName))) || '主持人';
    const guestNameV = (dt.guest && dt.guest.name) || '嘉宾';
    const subBody = [];
    subBody.push(row('标题', dt.title ? esc(dt.title) : "<span class='muted'>加载中...</span>"));
    subBody.push(row('投稿时间', fmtDate(dt.createdAt)));
    subBody.push(row('对话链接', "<a href='" + esc(dt.url || '') + "' target='_blank' rel='noopener'>" + esc(dt.url || '—') + "</a>"));
    subBody.push(row('投稿人', esc((dt.host && dt.host.personaInfo && dt.host.personaInfo.displayName) || '?') + ' · ' + esc(dt.userEmail || '')));
    subBody.push(row('称呼', esc((dt.host && dt.host.callName) || '（无，用「主持人」）')));
    subBody.push(row('建议', esc(dt.suggestion || '—')));
    const hostBtn = (hostSampleV && hostUserIdV)
      ? "<button class='sample-play' data-src='/api/audio/host?env=" + encodeURIComponent(labEnv || '') + "&userId=" + encodeURIComponent(hostUserIdV) + "' onclick='toggleSampleAudio(this)'>▶</button><span style='font-size:12px'>" + esc(hostNameV) + "</span>"
      : "<span class='muted' style='font-size:12px'>主持人无声样</span>";
    const guestBtn = guestIdV
      ? "<button class='sample-play' data-src='/api/audio/guest?env=" + encodeURIComponent(labEnv || '') + "&platform=" + encodeURIComponent(guestIdV) + "' onclick='toggleSampleAudio(this)'>▶</button><span style='font-size:12px'>" + esc(guestNameV) + "</span> <button class='gv-icon-btn' title='管理声线' data-act='guestvoice' data-id='" + id + "' data-gid='" + esc(guestIdV) + "' data-gname='" + esc(guestNameV) + "'>⚙</button>"
      : "<span class='muted' style='font-size:12px'>嘉宾无声线</span> <button class='gv-icon-btn' title='配置声线' data-act='guestvoice' data-id='" + id + "' data-gname='" + esc(guestNameV) + "'>🎙</button>";
    subBody.push(row('音色采样', hostBtn + "&nbsp;&nbsp;&nbsp;" + guestBtn));
    // 拒稿动作放投稿卡头部（发布前可用）；data-act 委托分发
    // 首尾默认展开：首=投稿卡 → 直接置 open；尾=最后一张非空卡片
    const rejectBtnHtml = (!isPublished && !isRejected)
      ? "<button class='pg' style='position:absolute;right:12px;bottom:12px;font-size:12px;padding:4px 14px;color:#f85149;border-color:#f85149' data-act='reject' data-id='" + id + "'>拒稿</button>"
      : '';
    let subCard = card('投稿', statusHtml, "<div style='position:relative'>" + subBody.join('') + rejectBtnHtml + "</div>", 'result');
    subCard = subCard.replace("class='ac-card'", "class='ac-card open'");
    const openTail = function (html) { return html ? html.replace("class='ac-card'", "class='ac-card open'") : html; };
    if (publishCardHtml) publishCardHtml = openTail(publishCardHtml);
    else if (createCardHtml) createCardHtml = openTail(createCardHtml);
    else if (auditCardHtml) auditCardHtml = openTail(auditCardHtml);
    else if (collectCardHtml) collectCardHtml = openTail(collectCardHtml);
    const H = [];
    H.push("<span class='back' onclick='showList()'>← 返回列表</span>");
    H.push("<div class='ac'>");
    H.push(subCard);
    if (collectCardHtml) H.push(collectCardHtml);
    if (auditCardHtml) H.push(auditCardHtml);
    if (createCardHtml) H.push(createCardHtml);
    if (publishCardHtml) H.push(publishCardHtml);
    H.push("</div>");
    // rejected：投稿卡 + 拒审结果（平铺，不套卡片）
    if (isRejected) {
      H.push("<div style='margin-top:14px'>");
      H.push("<div class='muted' style='font-size:11px;margin-bottom:6px'>拒审结果</div>");
      H.push("<div style='font-size:13px;margin:3px 0'><span style='color:#8a91a0;display:inline-block;min-width:70px'>拒审时间</span>" + (dt.reviewedAt ? esc(fmtDate(dt.reviewedAt)) : '—') + "</div>");
      H.push("<div style='font-size:13px;margin:3px 0'><span style='color:#8a91a0;display:inline-block;min-width:70px'>拒审理由</span><span style='color:#f85149;white-space:pre-line'>" + esc(dt.rejectedReason || '（无）') + "</span></div>");
      H.push("</div>");
    }
    if (d.progress) H.push("<div class='card' style='margin-top:12px'><div class='muted' style='font-size:12px'>进度：" + esc(d.progress.step) + " · " + esc(new Date(d.progress.updatedAt).toLocaleString()) + "</div></div>");
    H.push(pubUrlHtml);
    wrap.innerHTML = H.join('');
    if (d.dialogue) { try { sessionStorage.setItem('dlg-' + id, JSON.stringify(d.dialogue)); } catch {} }
    if (isCrafted && typeof initPubDur === 'function') { try { initPubDur(id, labEnv); } catch {} }
    if (isCrafted && typeof updatePubSubmitState === 'function') { try { updatePubSubmitState(); } catch {} }
    // 发布卡预填：该投稿已生成过的 meta（素材槽 metadata）在每次打开时回填表单（刷新/重进不丢）
    if (isCrafted && typeof applyPubMeta === 'function' && typeof getWorkflowInput === 'function') {
      try { const prevMeta = getWorkflowInput(id, 'metadata'); if (prevMeta && typeof prevMeta === 'object') applyPubMeta(prevMeta); } catch {}
    }
    if (collectedDone && dt.collected !== -1) loadCollectBody(id, false, d.dialogue);
    // 创作卡底部左侧的 BGM 常驻配置条：回填该投稿已保存的背景音乐配置
    if (hasScripts && typeof fillBgmPanel === 'function') { try { fillBgmPanel(id); } catch (e) {} }
    if (!dt.title) loadR2Title(id);
  }catch(e){
    wrap.innerHTML='<div class="err">加载失败: '+esc(e.message)+'</div>';
  }
}

// 卡片动作委托（data-act 分发——免内联带参 onclick）
document.addEventListener('click', function (e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  e.stopPropagation();   // 避免触发所在卡片头部的折叠
  const act = b.getAttribute('data-act');
  const sid = b.getAttribute('data-id') || window.__curDetailId;
  if (!sid) return;
  const si = Number(b.getAttribute('data-si') || 0);
  if (act === 'review') runReview(sid);                     // 审题：直接调 LLM，结果进审题卡片
  else if (act === 'confirm-proposal') confirmProposal(sid);   // 确认提案：只锁定选题，不创作
  else if (act === 'create') openCreateFlow(sid);            // 创作卡「重新创作」
  else if (act === 'reject') rejectSubmission(sid);
  else if (act === 'polish') openPolishConsole(sid, si);
  else if (act === 'tts') batchGenSegAudio(sid, si);
  else if (act === 'merge') openMergeDialog(sid, si);
  else if (act === 'browser-fallback') openBrowserFallback(sid);
  else if (act === 'guestvoice') openGuestVoiceModal(b.getAttribute('data-gid') || '', b.getAttribute('data-gname') || '');
});
// 创作入口（创作卡「重新创作」）：带上一版脚本打开脚本创作弹窗 —— 相当于在上一版基础上修改
function openCreateFlow(id){
  var sc = null;
  // 「创作中」= 改稿：带上服务端那一版（本地槽只兜底未保存的草稿）。
  // 「待创作」= 全新创作：不带任何旧产物——旧脚本属于上一条线，不该给模型当底稿。
  try {
    const sSrv = srvOf(id);
    if (sSrv && sSrv.creationState === 'creating') {
      if (Array.isArray(sSrv.scripts) && sSrv.scripts.length) sc = sSrv.scripts[0];
      else { const s = getWorkflowInput(id, 'scripts'); if (Array.isArray(s) && s.length) sc = s[0]; }
    }
  } catch (e) {}
  var rv = lockedProposalOf(id);
  if (!rv) { notice('还没确认提案——先去审题卡片勾一条，点「确认提案」', 'error'); return; }
  if (typeof openScriptModal !== 'function') { notice('script-modal.js 未加载', 'error'); return; }
  return openScriptModal(id, { chosen: rv, previousScript: sc });
}

// 审题：直接调 LLM（不弹控制台），结果内联进审题卡片
async function runReview(id){
  if (!window.__reviewBusy) window.__reviewBusy = {};
  window.__reviewBusy[id] = true;
  if (!window.__pickedProposal) window.__pickedProposal = {};
  delete window.__pickedProposal[id];          // 新结果出来后重新勾选
  // 重新审题 = 重来：删掉本地缓存的脚本、提案、锁定。
  // 用「显式空」而不是 null——null 会被装载规则当成「本地没有」，又把远程那份拉回来。
  try {
    setWorkflowInput(id, 'scripts', []);
    setWorkflowInput(id, 'proposals', { pending: true });
    setWorkflowInput(id, 'review', null);   // 远程锁定已被 reopen 清掉，本地清掉即可
    if (window.__workScripts) window.__workScripts[id] = [];
    if (window.__srv && window.__srv[id]) { window.__srv[id].scripts = []; window.__srv[id].review = null; }
  } catch (e) {}
  // 状态先退回 collected（selected/crafted 才有意义；其余状态后端会跳过）——卡片集合由状态决定
  let reopened = false;
  try {
    const ro = await j('/api/run/review/reopen', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: id }) });
    reopened = !!(ro && ro.ok && !ro.skipped);
  } catch (e) {}
  if (reopened) { try { if (window.__srv && window.__srv[id]) window.__srv[id].review = null; } catch (e) {} }   // 快照同步（权威仍是服务端）
  try { await openDetail(id); } catch (e) {}   // 立刻显示「审题中 · 生成中…」
  try {
    var d = await j('/api/run/review/round1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: id }) });
    var r = d && d.result;
    if (!r || typeof r !== 'object') throw new Error('没有审题结果');
    // 新契约（exploration_threads + creative_proposal）→ 前端既有机制：
    //   每条线取八字段 + recommended_duration，组成一条可直接锁定的 creative_proposal
    var stored = r;
    if (Array.isArray(r.exploration_threads)) {
      var CPF = ['core_question','initial_state','central_tension','exploration','turning_point','possible_discovery','ending_state','open_question'];
      var rec = r.creative_proposal || null;
      // 推荐线：契约 v2 在顶层给 recommended_thread_id（旧版靠 creative_proposal.thread_id 兜底）
      var recId = r.recommended_thread_id || (rec && rec.thread_id) || '';
      var list = r.exploration_threads.map(function (t) {
        var cp = {};
        CPF.forEach(function (k) { cp[k] = t[k] || ''; });
        cp.title = t.title || '';
        cp.thread_id = t.id || '';
        cp.score = t.score || null;
        cp.evidence = t.evidence || null;
        cp.editorial_reason = t.editorial_reason || '';
        cp.recommended_duration = (rec && rec.recommended_duration) || { category: 'standard', minutes: '8–10' };
        cp.__recommended = !!(recId && t.id === recId);
        return cp;
      });
      // eligibility：不合格（eligible=false）时契约要求 threads=[] + proposal=null ——
      // 理由一并落槽，拒稿时「填写拒稿原因」直接带出来（detail.js 的 proposalsRejected 读 stored.rejection）
      var elig = r.eligibility || null;
      var notEligible = !!(elig && elig.eligible === false);
      stored = { proposals: list, creative_proposal: rec, eligibility: elig, conversation_summary: r.conversation_summary || '', secondary_threads: r.secondary_threads || [], recommended_thread_id: recId };
      if (notEligible && elig.reason) stored.rejection = [String(elig.reason)];
    }
    try { setWorkflowInput(id, 'proposals', stored); } catch (e) {}   // 只写本地；确认提案时才连同选题一起提交远程
    var n = (stored.proposals && stored.proposals.length) || 0;
    if (n) notice('✓ 审题完成：' + n + ' 条探索线——勾一条，点「确认提案」', 'success');
    else notice('审题完成：这篇没过准入闸门——' + (stored.eligibility && stored.eligibility.reason ? String(stored.eligibility.reason).slice(0, 120) : '没有可用的探索线'), 'error');
  } catch (err) { notice('审题失败：' + ((err && err.message) || err), 'error'); }
  window.__reviewBusy[id] = false;
  try { await openDetail(id); } catch (e) {}
}

// 勾选提案（单选，DOM 内更新，不重拉详情）
function pickProposal(id, i){
  if (!window.__pickedProposal) window.__pickedProposal = {};
  window.__pickedProposal[id] = i;
  try {
    document.querySelectorAll('.prop-row').forEach(function (el) {
      var on = Number(el.getAttribute('data-prop')) === i;
      el.style.borderColor = on ? '#4f8cff' : '#262b36';
      el.style.borderLeftColor = on ? '#4f8cff' : '#bc8cff';
      el.style.background = on ? '#0f1420' : '#0b0d11';
      var mk = el.querySelector('.prop-mark');
      if (mk) { mk.textContent = on ? '☑' : '☐'; mk.style.color = on ? '#4f8cff' : '#8a91a0'; }
    });
    var btn = document.getElementById('createFromProposal');
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
    var hint = document.getElementById('pickHint');
    if (hint) hint.textContent = '已选第 ' + (i + 1) + ' 条';
  } catch (e) {}
}

// 「确认提案」：只做一件事——锁定选题（服务端 review → 状态 selected）。
// **不调用创作 LLM、不打开创作弹窗**：创作是下一步的独立动作（创作卡「创作脚本 / 重新创作」）。
async function confirmProposal(id){
  var pr = null;
  try { pr = getWorkflowInput(id, 'proposals') || null; } catch (e) {}
  if (!pr) { try { const s = srvOf(id); pr = (s && s.proposals) || null; } catch (e) {} }   // 本地优先，远程兜底
  var idx = (window.__pickedProposal || {})[id];
  if (!pr || !Array.isArray(pr.proposals) || idx === undefined || idx === null) { notice('先在审题卡片里勾选一条提案', 'error'); return; }
  var chosen = pr.proposals[idx];
  if (!chosen) { notice('提案不存在——请重新审题', 'error'); return; }
  if (!window.__workScripts) window.__workScripts = {};
  try {
    try { setWorkflowInput(id, 'review', chosen); } catch (e) {}   // 本地先落
    var d = await j('/api/run/review/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: id, review: chosen, proposals: pr }) });
    if (!(d && d.saved)) throw new Error((d && d.error) || '提交失败');
    notice('✓ 提案已确认——创作卡已进入「待创作」，点「创作脚本」开始', 'success');
  } catch (err) { notice('确认提案失败：' + ((err && err.message) || err), 'error'); return; }
  try { await openDetail(id); } catch (e) {}   // 重拉详情：审题卡 → 审题锁定，创作卡 → 待创作
}
async function rejectSubmission(id){
  let draft = '';
  {
    const s = srvOf(id);
    try {
      // 空提案场景：审题结果里的 rejection 文案（服务端 production.reviewProposals）
      const pr = (s && s.proposals) || null;
      if (pr && Array.isArray(pr.rejection) && pr.rejection.length) draft = String(pr.rejection[0]).trim();
    } catch {}
    if (!draft) {
      try {
        const rv = (s && s.review) || null;
        if (rv && typeof rv.rejection_draft === 'string' && rv.rejection_draft.trim()) draft = rv.rejection_draft.trim();
        else if (rv && rv.score != null) {
          const s = Number(rv.score);
          draft = Number.isFinite(s)
            ? '这篇对话暂未达到创作标准（综合评分 ' + s.toFixed(1) + '）。如果你愿意，可以带着一个更想聊清楚的问题再来，很期待下一条对话。'
            : '';
        }
      } catch {}
    }
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
  // 生成期间：不禁用播放按钮（可随时播放已生成的段）；仅禁用打磨按钮避免被打磨覆盖
  document.querySelectorAll('.polish-btn').forEach(b => { b.disabled = true; });
  const btn = document.querySelector('.seg-batch-tts[data-si="' + si + '"]');
  if (btn) { btn.disabled = true; btn.textContent = '生成中 ' + 0 + '/' + checks.length + '...'; }
  const indices = checks.map(c => Number(c.dataset.segi));
  let done = 0;
  (async () => {
    for (const segi of indices) {
      // 已生成的段自动跳过（有缓存直接计入完成，不再调用 TTS）
      const k0 = segRowKey(id, si, segi);
      if (k0 && segAudioGet(k0)) { done++; if (btn) btn.textContent = '生成中 ' + done + '/' + checks.length + '...'; continue; }
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
// 空格键控制：鼠标 hover 在某段（.seg-row）上时按空格 → 已生成语音则播放/暂停；未生成则触发生成语音
document.addEventListener('keydown', function (e) {
  if (e.code !== 'Space') return;
  // 输入态（输入框/文本域/下拉/按钮/可编辑/补全弹层打开）不拦截空格默认行为
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.tagName === 'BUTTON' || t.tagName === 'A' || t.isContentEditable)) return;
  if (document.querySelector('.seg-tag-pop') || document.querySelector('.seg-add-menu')) return;
  const row = document.querySelector('.seg-row:hover');
  if (!row) return;
  e.preventDefault();                       // 阻止空格滚动页面
  const id = location.pathname.slice(1);
  const si = Number(row.dataset.si);
  const segi = Number(row.dataset.segi);
  if (!id || isNaN(si) || isNaN(segi)) return;
  const key = row.dataset.segkey;
  if (key && segAudioGet(key)) {
    // 已生成语音 → 播放/暂停该段
    if (typeof playSegAudio === 'function') playSegAudio(id, si, segi);
  } else {
    // 未生成语音 → 空格触发生成流程
    if (typeof genSegAudio === 'function') genSegAudio(id, si, segi);
  }
});
// m 键快捷键：触发「语音合成」——单脚本直接合成；多脚本时以鼠标悬停所在脚本为准（未生成语音的段会被跳过）
document.addEventListener('keydown', function (e) {
  const k = e.key;
  if (!k || k.toLowerCase() !== 'm') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;      // 排除浏览器/编辑器组合键
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  if (document.querySelector('.seg-tag-pop') || document.querySelector('.seg-add-menu')) return;
  const all = [].slice.call(document.querySelectorAll('.seg-merge-btn'));
  if (!all.length) return;
  let btn = null;
  if (all.length === 1) {
    btn = all[0];
  } else {
    // 多脚本：优先按鼠标悬停位置（片段行 / 该脚本 segs 区 / 该脚本合成按钮）定位
    const row = document.querySelector('.seg-row:hover');
    const area = row ? null : document.querySelector('.script-segs:hover');
    const btnHov = (!row && !area) ? document.querySelector('.seg-merge-btn:hover') : null;
    const src = row || area || btnHov;
    if (src) {
      const si = Number(src.dataset.si);
      if (!isNaN(si)) btn = all.find(function (b) { return Number(b.dataset.si) === si; }) || null;
    }
  }
  // 兜底：单脚本必然命中；多脚本但无法按悬停定位（如创作卡折叠、没有悬停目标）→ 取第一个可用脚本
  if (!btn || btn.disabled) btn = all.find(function (b) { return !b.disabled; }) || null;
  if (!btn) return;                   // 与按钮一致：语音不足时不触发
  // 创作卡被折叠时也触发：先把所在卡片展开（合成面板与流程可见）
  const card = btn.closest ? btn.closest('.ac-card') : null;
  if (card) card.classList.add('open');
  e.preventDefault();
  btn.click();
});

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
// 语感标签着色：只读展示把 [标签] 染成与正文不同的颜色（textarea 编辑态仍显示原文）
function fmtSeg(t){
  return esc(String(t)).replace(/\[([^\[\]]*)\]/g, "<span style='color:#bc8cff'>[$1]</span>");
}

// Fish Audio 标签补全目录：编辑段文本时输入 [ 弹出（情绪 / 语气 / 强调 / 停顿 / 音效）
const FISH_TAG_GROUPS = [
  { name: '情绪', tags: [
    ['calm','平静'],['curious','好奇'],['doubtful','怀疑'],['confused','困惑'],['surprised','惊讶'],
    ['moved','感动'],['empathetic','共情'],['worried','担忧'],['happy','开心'],['sad','难过'],
    ['nervous','紧张'],['excited','兴奋'],['satisfied','满意'],['relaxed','放松'],['grateful','感激'],
    ['proud','自豪'],['sarcastic','讽刺'],['hopeful','希望'],['determined','坚定'],['anxious','焦虑'],
    ['relieved','释然'],['frustrated','沮丧'],['delighted','欣喜'],['scared','害怕'],['upset','不安'],
    ['depressed','低落'],['embarrassed','尴尬'],['disgusted','反感'],['ashamed','羞愧'],['lonely','孤独'],
    ['nostalgic','怀念'],['sympathetic','同情'],['compassionate','关切'],['resigned','认命'],['bored','无聊'],
    ['guilty','内疚'],['jealous','嫉妒'],['envious','羡慕'],['disappointed','失望'],['regretful','遗憾'],
    ['optimistic','乐观'],['pessimistic','悲观'],['uncertain','不确定'],['indifferent','冷淡'],
    ['hysterical','歇斯底里'],['disdainful','轻蔑'],['contemptuous','鄙视'],['unhappy','不悦'],['confident','自信']
  ]},
  { name: '语气', tags: [
    ['soft tone','轻柔'],['whispering','耳语'],['in a hurry tone','急促'],['shouting','大声'],['screaming','尖叫']
  ]},
  { name: '强调', tags: [['emphasis','重读紧跟其后的词']] },
  { name: '停顿', tags: [['break','短停顿'],['long-break','长停顿']] },
  { name: '音效', tags: [['laughing','笑声——台词里的“哈哈”换成它（标签后不跟“哈哈”）'],['chuckling','轻笑'],['sighing','叹气/释然']] }
];
// 展开成扁平项（补全过滤/导航用）
function fishTagFlat(){
  const out = [];
  FISH_TAG_GROUPS.forEach(g => (g.tags || []).forEach(([tag, note]) => out.push({ group: g.name, tag, note })));
  return out;
}

// 段行编辑（双击文本进入；编辑态 = view 隐藏 + textarea 显示，失焦自动保存、Esc 取消）
function segEditEls(id, si, segi){
  const row = document.querySelector('.seg-row[data-si="' + si + '"][data-segi="' + segi + '"]');
  if (!row) return null;
  const view = document.getElementById('sgsv-' + id + '-' + si + '-' + segi);
  const edit = document.getElementById('sgse-' + id + '-' + si + '-' + segi);
  if (!view || !edit) return null;
  return { row: row, view: view, edit: edit, ta: edit.querySelector('.seg-ta') };
}
function segStoredText(id, si, segi){
  try {
    const ws = labWorkScriptsOf(id);
    if (ws && ws[si] && ws[si].segments && ws[si].segments[segi]) return String(ws[si].segments[segi].text || '');
  } catch (e) {}
  return '';
}
function setPolishLocked(si, locked){
  const polishBtn = document.querySelector('.polish-btn[data-si="' + si + '"]');
  if (!polishBtn) return;
  polishBtn.disabled = locked;
  polishBtn.title = locked ? '编辑中不可打磨' : '';
}
function segsArea(si){
  return document.querySelector('.script-segs[data-si="' + si + '"]') || document.querySelector('.script-segs');
}
// 重绘某脚本整个 segs 区域（插入/删除段后调用）
function rerenderSegsArea(id, si){
  const el = segsArea(si);
  const ws = labWorkScriptsOf(id);
  if (el && ws && ws[si]) el.innerHTML = renderSegsHtml(ws[si], id, si);
  if (typeof updateMergeBtn === 'function') updateMergeBtn(id, si);
}

function renderSegsHtml(script, id, si){
  const segs = (script && script.segments) || [];
  const gapExprs = (typeof loadGapExprs === 'function') ? loadGapExprs(id, segs.length) : [];
  const parts = [];
  // 段首插入槽（＋ 在开头插入）
  parts.push("<div class='seg-add-slot'><i class='seg-add-line'></i><button type='button' class='seg-add-btn' onclick='openSegAddMenu(this,\"" + id + "\"," + si + ",0)' title='在开头插入段落'>+</button><i class='seg-add-line'></i></div>");
  segs.forEach((seg, segi) => {
    const spk = seg.speaker === 'guest' ? 'guest' : 'host';
    // 新方法论口径：host 段命中 chain = 原话/改写；没命中 = 现场的接话（不是缺陷）
    const talkBadge = "<span style='color:#58a6ff;font-size:10px;border:1px solid #58a6ff66;border-radius:8px;padding:0 6px;margin-left:6px'>接话</span>";
    const badge = (spk === 'host')
      ? (seg.chain === false ? talkBadge
        : seg.src === 'original' ? "<span style='color:#3fb950;font-size:10px;border:1px solid #3fb95066;border-radius:8px;padding:0 6px;margin-left:6px'>原话</span>"
        : seg.src === 'rewrite' ? "<span style='color:#d29922;font-size:10px;border:1px solid #d2992266;border-radius:8px;padding:0 6px;margin-left:6px'>改写</span>"
        : talkBadge)
      : '';
    parts.push(`<div class='seg-row' data-si='${si}' data-segi='${segi}' data-segkey='${segKey(id, seg)}'>`
      + `<input type='checkbox' class='seg-check' data-si='${si}' data-segi='${segi}' onchange='updateBatchTtsBtn(${si})' style='align-self:center;flex-shrink:0'>`
      + `<div class='script-seg seg-${spk}'>`
        + `<div class='script-seg-head'><span class='who who-${spk}'>${esc(seg.speaker)}</span>${badge}<button type='button' class='seg-del-btn' title='删除该段' onclick='deleteSeg(\"${id}\",${si},${segi})'>🗑</button></div>`
        + `<div class='script-seg-view' id='sgsv-${id}-${si}-${segi}' ondblclick='openSegEdit(\"${id}\",${si},${segi})' title='双击编辑（失焦自动保存）' style='cursor:text'>${fmtSeg(seg.text)}</div>`
        + `<div class='script-seg-edit' id='sgse-${id}-${si}-${segi}' style='display:none'>`
          + `<textarea class='seg-ta' spellcheck='false' data-id='${id}' data-si='${si}' data-segi='${segi}' oninput='segTagInput(this)' onkeydown='segTaKey(this,event)' onblur='segEditBlur(this)'>${esc(seg.text)}</textarea>`
        + `</div>`
      + `</div>`
      + `<div class='seg-tts-side'>`
        + (segAudioGet(segKey(id, seg))
            ? `<span class='seg-tts-group'><button class='seg-tts-btn' onclick='playSegAudio(\"${id}\",${si},${segi})' title='播放'>▶</button><button class='seg-tts-btn' onclick='regenSegAudio(\"${id}\",${si},${segi})' title='重新生成'>↻</button></span>`
            : `<button class='seg-tts-btn' data-si='${si}' data-segi='${segi}' onclick='genSegAudio(\"${id}\",${si},${segi})' title='生成语音'>🔊</button>`)
      + `</div>`
    + `</div>`);
    // 段与段之间：＋ 插入按钮 + 段间隔气泡（气泡点击配置两段间停顿）
    if (segi < segs.length - 1) {
      parts.push("<div class='seg-between'><button type='button' class='seg-add-btn' onclick='openSegAddMenu(this,\"" + id + "\"," + si + "," + (segi + 1) + ")' title='在两段之间插入段落'>+</button>"
        + (typeof gapBubbleHtml === 'function' ? gapBubbleHtml(id, si, segi, gapExprs[segi] || defaultGapExpr()) : '')
        + "<i class='seg-add-line'></i></div>");
    }
  });
  // 段尾插入槽（＋ 在末尾追加）
  parts.push("<div class='seg-add-slot'><i class='seg-add-line'></i><button type='button' class='seg-add-btn' onclick='openSegAddMenu(this,\"" + id + "\"," + si + "," + segs.length + ")' title='在末尾追加段落'>+</button><i class='seg-add-line'></i></div>");
  return parts.join('');
}

// 创作成功预览态：仅显示 segs + full audio 播放器（合成后配置锁定）
function renderPreviewBody(id, scripts, fullMeta){
  const script = scripts[fullMeta.scriptIndex] || scripts[0] || { segments: [] };
  const segs = script.segments || [];
  const rows = segs.map((seg, i) => `<div class='script-seg seg-${seg.speaker === 'guest' ? 'guest' : 'host'}' style='margin-bottom:6px;padding:8px 10px'><span class='who who-${seg.speaker === 'guest' ? 'guest' : 'host'}'>${esc(seg.speaker)}</span> <span style='font-size:13px'>${fmtSeg(seg.text)}</span></div>`).join('');
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
  const rows = segs.map((seg, i) => `<div class='script-seg seg-${seg.speaker === 'guest' ? 'guest' : 'host'}' style='margin-bottom:6px;padding:8px 10px'><span class='who who-${seg.speaker === 'guest' ? 'guest' : 'host'}'>${esc(seg.speaker)}</span> <span style='font-size:13px'>${fmtSeg(seg.text)}</span></div>`).join('');
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

// ===== 脚本段落级手工编辑：双击进入编辑，失焦自动保存（无保存/取消按钮）=====
function openSegEdit(id, si, segi){
  const els = segEditEls(id, si, segi);
  if (!els) return;
  if (els.edit.style.display !== 'none') return;   // 已在编辑中
  els.view.style.display = 'none';
  els.edit.style.display = '';
  setPolishLocked(si, true);                        // 编辑中禁用批量打磨（避免被打磨覆盖）
  els.ta.focus();
  const len = els.ta.value.length;
  try { els.ta.setSelectionRange(len, len); } catch (e) {}
}
function segEditExit(id, si, segi){                 // 关闭编辑框（不写脚本），view 显示当前已存文本
  const els = segEditEls(id, si, segi);
  if (!els) return;
  closeSegTagPopup();
  if (els.ta) delete els.ta.dataset.cancelled;
  els.edit.style.display = 'none';
  if (els.view) { els.view.style.display = ''; els.view.innerHTML = fmtSeg(segStoredText(id, si, segi)); }
  setPolishLocked(si, false);
}
function segEditCancel(id, si, segi){               // Esc：取消编辑（新插入的空段 → 移除该行）
  const els = segEditEls(id, si, segi);
  if (!els || !els.ta) return;
  els.ta.dataset.cancelled = '1';                   // 拦截随后的 blur 自动保存
  closeSegTagPopup();
  if (segStoredText(id, si, segi) === '') segRemoveRow(id, si, segi);
  else segEditExit(id, si, segi);
}
function segEditBlur(ta){                           // 失焦自动保存
  if (!ta || !ta.dataset) return;
  if (ta.dataset.cancelled) { delete ta.dataset.cancelled; return; }
  if (!ta.isConnected) return;
  const id = ta.dataset.id, si = Number(ta.dataset.si || 0), segi = Number(ta.dataset.segi || 0);
  if (!id || isNaN(si) || isNaN(segi)) return;
  closeSegTagPopup();
  const stored = segStoredText(id, si, segi);
  const text = String(ta.value || '');
  if (!text.trim()) {
    // 空文本：新插入的空段撤销（移除该行）；已有段保持原文（不允许清成空段）
    if (stored === '') segRemoveRow(id, si, segi);
    else segEditExit(id, si, segi);
    return;
  }
  const fresh = ta.dataset.fresh === '1';
  const changed = text !== stored;
  const ok = segSaveText(id, si, segi, text);
  if (ok) delete ta.dataset.fresh;
  segEditExit(id, si, segi);
  if (ok && fresh && changed) notice('✓ 新段已保存', 'success');
}
// 保存一段文本：只写本地工作槽（合成确认时才定稿入库）；语音缓存按内容 key 自动失效
function segSaveText(id, si, segi, text){
  const current = (labWorkScriptsOf(id) || []).slice();
  if (!current.length || !current[si] || !Array.isArray(current[si].segments) || !current[si].segments[segi]) return false;
  const seg = current[si].segments[segi];
  if (seg.text !== text) {
    seg.text = text;
    delete seg.src; delete seg.fromTurn; delete seg.origRatio; delete seg.chain;   // 手工改过 → 不再标 原话/改写/接话
  }
  saveScripts(id, current);
  const els = segEditEls(id, si, segi);
  if (els) {
    if (els.row) els.row.dataset.segkey = segKey(id, current[si].segments[segi]);
    if (els.view) els.view.innerHTML = fmtSeg(seg.text);
    refreshSegTtsSide(id, si, segi);
  }
  if (typeof updateMergeBtn === 'function') updateMergeBtn(id, si);
  return true;
}
// 重绘单行语音按钮（按当前内容 key 命中缓存）
function refreshSegTtsSide(id, si, segi){
  const side = document.querySelector('.seg-row[data-si="' + si + '"][data-segi="' + segi + '"] .seg-tts-side');
  if (!side) return;
  const key = segRowKey(id, si, segi);
  side.innerHTML = (key && segAudioGet(key))
    ? `<span class='seg-tts-group'><button class='seg-tts-btn' onclick='playSegAudio("${id}",${si},${segi})' title='播放'>▶</button><button class='seg-tts-btn' onclick='regenSegAudio("${id}",${si},${segi})' title='重新生成'>↻</button></span>`
    : `<button class='seg-tts-btn' data-si='${si}' data-segi='${segi}' onclick='genSegAudio("${id}",${si},${segi})' title='生成语音'>🔊</button>`;
}
function segRemoveRow(id, si, segi){                // 删除一段（撤销空段插入/确认删除等）→ 整块重绘
  const current = (labWorkScriptsOf(id) || []).slice();
  if (!current.length || !current[si] || !Array.isArray(current[si].segments)) return;
  if (segi < 0 || segi >= current[si].segments.length) return;
  const segs = current[si].segments.slice();
  segs.splice(segi, 1);
  current[si] = Object.assign({}, current[si], { segments: segs });
  saveScripts(id, current);
  rerenderSegsArea(id, si);
  setPolishLocked(si, false);
}
// 删除一段（段头 🗑 → 确认框 → 删除该段；该段语音缓存按内容 key 保留，重新输入同文本仍可命中）
function deleteSeg(id, si, segi){
  const els = segEditEls(id, si, segi);
  if (!els) return;
  // 取当前已存段（编辑中先失焦自动保存，这里读到的是最新文本）
  let spk = '', text = '';
  try {
    const ws = labWorkScriptsOf(id);
    if (ws && ws[si] && ws[si].segments && ws[si].segments[segi]) {
      spk = ws[si].segments[segi].speaker || '';
      text = String(ws[si].segments[segi].text || '');
    }
  } catch (e) {}
  if (!text) text = segStoredText(id, si, segi);
  const snip = text.length > 20 ? text.slice(0, 20) + '…' : text;
  const who = spk ? spk + ' 段' : '该段';
  if (!confirm('确定删除' + who + '吗？\n「' + snip + '」\n删除后如需可重新插入，语音需重新生成。')) return;
  segRemoveRow(id, si, segi);
  notice('✓ 已删除' + who, 'success');
}
// 编辑框键盘：标签补全导航 / Esc 关闭补全或取消编辑
function segTaKey(ta, e){
  if (!ta || !e) return;
  const pop = document.querySelector('.seg-tag-pop');
  const id = ta.dataset.id, si = Number(ta.dataset.si || 0), segi = Number(ta.dataset.segi || 0);
  if (pop && pop.dataset.for === id + '|' + si + '|' + segi) {
    const items = [].slice.call(pop.querySelectorAll('.seg-tag-item'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!items.length) return;
      e.preventDefault();
      let idx = items.findIndex(function (x) { return x.classList.contains('active'); });
      idx = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
      items.forEach(function (x, i) { x.classList.toggle('active', i === idx); });
      try { items[idx].scrollIntoView({ block: 'nearest' }); } catch (err) {}
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      const active = pop.querySelector('.seg-tag-item.active') || pop.querySelector('.seg-tag-item');
      if (active) { e.preventDefault(); segTagApply(ta, active); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); closeSegTagPopup(); return; }
    return;   // 补全打开时其它键照常输入
  }
  if (e.key === 'Escape') { e.preventDefault(); segEditCancel(id, si, segi); }
}

// ===== Fish Audio 标签补全：编辑段文本输入 [ 弹出（情绪/语气/强调/停顿/音效）=====
let segTagPopEl = null;
function closeSegTagPopup(){
  if (segTagPopEl) { segTagPopEl.remove(); segTagPopEl = null; }
}
// 光标前最近的未闭合 [ → {start, query}；无则 null
function segTagOpenBracket(ta){
  const v = ta.value;
  const pos = (ta.selectionStart == null) ? v.length : ta.selectionStart;
  const before = v.slice(0, pos);
  const lb = before.lastIndexOf('[');
  if (lb === -1 || before.lastIndexOf(']') > lb) return null;
  const query = before.slice(lb + 1);
  if (/[\[\]\n]/.test(query)) return null;
  return { start: lb, query: query };
}
function segTagInput(ta){
  const ctx = segTagOpenBracket(ta);
  if (!ctx) { closeSegTagPopup(); return; }
  buildSegTagPopup(ta, ctx);
}
function segTagPopTa(){
  if (!segTagPopEl || !segTagPopEl.dataset.for) return null;
  const parts = String(segTagPopEl.dataset.for).split('|');
  if (parts.length !== 3) return null;
  return document.querySelector('.seg-ta[data-id="' + parts[0] + '"][data-si="' + parts[1] + '"][data-segi="' + parts[2] + '"]');
}
function buildSegTagPopup(ta, ctx){
  const q = ctx.query.trim().toLowerCase();
  const all = fishTagFlat();
  const matched = q ? all.filter(function (x) { return x.tag.toLowerCase().indexOf(q) !== -1; }) : all;
  if (q && !matched.length) { closeSegTagPopup(); return; }   // 无匹配 → 保持自由输入（Fish 支持自定标签）
  const pos = segTagPopupPos(ta);
  let html = '';
  let lastGroup = '';
  matched.forEach(function (x) {
    if (x.group !== lastGroup) { html += "<div class='seg-tag-group'>" + esc(x.group) + "</div>"; lastGroup = x.group; }
    html += "<button type='button' class='seg-tag-item' data-tag='" + esc(x.tag) + "'><span class='t'>[" + esc(x.tag) + "]</span><span class='n'>" + esc(x.note) + "</span></button>";
  });
  if (!q) html += "<div class='seg-tag-foot'>情绪可加强度：[slightly / very / extremely]＋情绪 · ↑↓ 选择 · Enter 补全 · Esc 关闭</div>";
  if (!segTagPopEl) { segTagPopEl = document.createElement('div'); segTagPopEl.className = 'seg-tag-pop'; document.body.appendChild(segTagPopEl); }
  segTagPopEl.innerHTML = html;
  segTagPopEl.dataset.for = ta.dataset.id + '|' + ta.dataset.si + '|' + ta.dataset.segi;
  segTagPopEl.style.left = pos.x + 'px';
  segTagPopEl.style.top = pos.y + 'px';
  const first = segTagPopEl.querySelector('.seg-tag-item');
  if (first) first.classList.add('active');
}
function segTagPopupPos(ta){
  const rect = ta.getBoundingClientRect();
  const cs = getComputedStyle(ta);
  let x = rect.left + 8, y = rect.bottom + 6;
  try {
    const c = document.createElement('canvas').getContext('2d');
    c.font = cs.font || '12px ui-monospace,Menlo,monospace';
    const v = ta.value || '';
    const caret = (ta.selectionStart == null) ? v.length : ta.selectionStart;
    const before = v.slice(0, caret);
    const lines = before.split('\n');
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padT = parseFloat(cs.paddingTop) || 0;
    const lineH = parseFloat(cs.lineHeight) || 16;
    x = rect.left + padL + c.measureText(lines[lines.length - 1]).width + 6;
    y = rect.top + padT + lines.length * lineH + 4;
  } catch (e) {}
  x = Math.max(8, Math.min(x, window.innerWidth - 292));
  y = Math.max(8, Math.min(y, window.innerHeight - 60));
  return { x: x, y: y };
}
function segTagApply(ta, item){
  const tag = item ? item.getAttribute('data-tag') : '';
  const ctx = segTagOpenBracket(ta);
  closeSegTagPopup();
  if (!ctx || !tag) return;
  const v = ta.value;
  const caret = (ta.selectionStart == null) ? v.length : ta.selectionStart;
  const ins = '[' + tag + ']';
  const after = v.slice(caret);
  const tail = (after.charAt(0) && !/\s/.test(after.charAt(0)) && after.charAt(0) !== ']') ? ' ' : '';
  const newVal = v.slice(0, ctx.start) + ins + tail + after;
  const newCaret = v.slice(0, ctx.start).length + ins.length + tail.length;
  ta.value = newVal;
  ta.focus();
  try { ta.setSelectionRange(newCaret, newCaret); } catch (e) {}
  ta.dispatchEvent(new Event('input', { bubbles: true }));   // 走 segTagInput（无未闭合 [ → 弹层保持关闭）
}

// ===== ＋ 插入段落：点 ＋ → 选 guest(AI)/host(主持人) → 插入空段并进入编辑（输入失焦自动保存）=====
let segAddMenuEl = null;
function closeSegAddMenu(){
  if (segAddMenuEl) { segAddMenuEl.remove(); segAddMenuEl = null; }
}
function openSegAddMenu(btn, id, si, at){
  closeSegAddMenu();
  const cur = (typeof labWorkScriptsOf === 'function') ? labWorkScriptsOf(id) : null;
  if (!cur || !cur[si] || !Array.isArray(cur[si].segments)) { notice('未找到工作脚本（请先采纳脚本）', 'error'); return; }
  const r = btn.getBoundingClientRect();
  const m = document.createElement('div');
  m.className = 'seg-add-menu';
  m.dataset.key = id + '|' + si + '|' + at;
  m.innerHTML = "<div class='seg-add-menu-t'>插入段落 · 脚本 " + (si + 1) + "</div>"
    + "<button type='button' class='seg-add-menu-it' data-spk='guest'><b>guest</b><span>嘉宾（AI）</span></button>"
    + "<button type='button' class='seg-add-menu-it' data-spk='host'><b>host</b><span>主持人</span></button>";
  document.body.appendChild(m);
  let top = r.bottom + 6;
  if (top + m.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - m.offsetHeight - 6);
  m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 8)) + 'px';
  m.style.top = top + 'px';
  segAddMenuEl = m;
}
function insertSegRowAt(id, si, at, spk){
  closeSegAddMenu();
  const cur = (typeof labWorkScriptsOf === 'function' ? labWorkScriptsOf(id) : null) || [];
  if (!cur.length || !cur[si] || !Array.isArray(cur[si].segments)) { notice('工作脚本已变化，请刷新重试', 'error'); return; }
  const segs = cur[si].segments.slice();
  const idx = Math.max(0, Math.min(at, segs.length));
  segs.splice(idx, 0, { speaker: spk, text: '' });
  cur[si] = Object.assign({}, cur[si], { segments: segs });
  saveScripts(id, cur);
  rerenderSegsArea(id, si);
  // 新段直接进入编辑（失焦自动保存；留空失焦 / Esc → 自动撤销该插入）
  const els = segEditEls(id, si, idx);
  if (els) {
    if (els.row) els.row.dataset.fresh = '1';
    if (els.ta) els.ta.dataset.fresh = '1';
    openSegEdit(id, si, idx);
  }
  notice('已插入空 ' + spk + ' 段——输入台词后点击别处自动保存', 'info');
}
// 全局：点击外部关闭 ＋菜单 / 标签补全；点补全项保持编辑框焦点（防失焦自动保存）
document.addEventListener('mousedown', function (e) {
  const t = e.target;
  if (!t || !t.closest) return;
  const tagIt = t.closest('.seg-tag-item');
  if (tagIt && segTagPopEl) {
    e.preventDefault();
    const ta = segTagPopTa();
    if (ta) segTagApply(ta, tagIt);
    return;
  }
  if (segAddMenuEl && !segAddMenuEl.contains(t)) closeSegAddMenu();
  if (segTagPopEl && !segTagPopEl.contains(t)) closeSegTagPopup();
});
// 全局：＋菜单选 guest/host → 插入段
document.addEventListener('click', function (e) {
  const it = e.target && e.target.closest ? e.target.closest('.seg-add-menu-it') : null;
  if (!it || !segAddMenuEl || !segAddMenuEl.dataset.key) return;
  const key = String(segAddMenuEl.dataset.key).split('|');
  if (key.length !== 3) return;
  insertSegRowAt(key[0], Number(key[1]), Number(key[2]), it.getAttribute('data-spk') || 'guest');
});
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
    key: 'r4-meta',
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

// ===== 提案墙 / 审题 / 创作控制台（proposal wall 补完：round1 提案 → 选这条 → round2 重演创作 → 采纳锁定）=====



// （脚本创作走 script-modal.js 弹窗；旧的 round2 控制台入口已下线）

// round1 审题：产出 1-N 提案 → 存本地槽（提案墙数据源）；采纳发生在提案被选之后（review/save 锁定）

// 语感打磨（r3-polish）：采纳 = 替换本地工作槽对应脚本（定稿前不落 R2）

async function openPolishConsole(id, si){
  if (typeof openLlmConsole !== 'function') { alert('llm-console.js 未加载'); return; }
  // 数据在**点的时候**现从脚本编辑器取（不缓存、不回退服务端副本）；
  // 脚本区里没有可磨的台词时按钮是禁用的，这里再挡一道（键盘/脚本触发的路径）。
  var live = (typeof labWorkScriptsOf === 'function') ? labWorkScriptsOf(id) : null;
  var target0 = Array.isArray(live) ? live[si] : null;
  var hasText = !!(target0 && Array.isArray(target0.segments) && target0.segments.some(function (x) { return String((x && x.text) || '').trim(); }));
  if (!hasText) { notice('脚本区里还没有台词——先创作或载入脚本再打磨', 'error'); return; }
  openLlmConsole({
    id: id, key: 'r3-polish', title: '语感打磨（脚本 ' + (si + 1) + '，控制台）', url: '/api/run/polish',
    scoring: true,
    buildRequest: function () {
      // 每次请求都现取：先把编辑器里**正在改的那一段**落定（失焦即存），再读最新工作副本。
      try {
        const ae = document.activeElement;
        if (ae && ae.tagName === 'TEXTAREA') ae.blur();
      } catch (e) {}
      const ws = (typeof labWorkScriptsOf === 'function') ? labWorkScriptsOf(id) : null;
      return { id: id, scriptIndex: si, scripts: Array.isArray(ws) ? ws : [] };
    },
    onDone: async function (ev) {
      var polished = ev.response && ev.response.result;
      if (!polished || !Array.isArray(polished.segments)) throw new Error('该版没有打磨结果（segments）');
      // 当前稿兜底顺序：本地工作槽 → 内存 → 服务端快照 → 服务端详情。
      // 拿不到就直接把打磨结果当成当前稿——**绝不让它"打磨完了却没进脚本区"**。
      var scripts = (typeof labWorkScriptsOf === 'function') ? labWorkScriptsOf(id) : null;
      if (!Array.isArray(scripts) || !scripts.length) scripts = (srvOf(id) && srvOf(id).scripts) || null;
      if (!Array.isArray(scripts) || !scripts.length) {
        try {
          const dd = await j('/api/detail/' + id);
          const rs = (dd && dd.detail && dd.detail.reviewScripts) || null;
          if (Array.isArray(rs) && rs.length) scripts = rs;
        } catch (e) {}
      }
      var next;
      if (Array.isArray(scripts) && scripts.length) {
        if (si >= scripts.length) si = 0;
        next = scripts.map(function (s2, i) { return (i === si ? polished : s2); });
      } else {
        next = [polished];
      }
      saveScripts(id, next);
      notice('✓ 打磨版已写进脚本区（本地生效；语音合成确认时入库）', 'success');
      try { await openDetail(id); } catch (e) {}
    }
  });
}

/** 脚本改动统一只写本地（编辑/删段/插段/打磨都走这里）。
 *  远程提交点 = 「确认生成语音」（merge.js 合成确认时把本地终稿 PUT 到 R2 scripts）。
 *  卡片渲染读本地工作副本，所以本地写完立刻可见。 */
function saveScripts(id, scripts){
  try { setWorkflowInput(id, 'scripts', scripts); } catch (e) {}
  try { if (!window.__workScripts) window.__workScripts = {}; window.__workScripts[id] = scripts; } catch (e) {}
  return true;
}

// 当前投稿的工作脚本（内存槽优先，兜底素材 store）——TTS/合成/上传用工作副本
function labWorkScriptsOf(id) {
  try {
    if (window.__workScripts && Array.isArray(window.__workScripts[id]) && window.__workScripts[id].length) return window.__workScripts[id];
  } catch (e) {}
  try {
    const ws = getWorkflowInput(id, 'scripts');
    if (Array.isArray(ws) && ws.length) return ws;
  } catch (e) {}
  return null;
}

// 浏览器兜底采集：脚本为静态资源 web/js/console-fallback.js（fetch 展示，避免内联转义）
async function openBrowserFallback(id) {
  let script = '';
  try { const rr = await fetch('/js/console-fallback.js?t=' + Date.now()); script = await rr.text(); } catch (e) { notice('脚本加载失败: ' + e.message, 'error'); }
  if (!script) script = '// 加载失败，请刷新后重试';
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:991;display:flex;align-items:center;justify-content:center';
  const win = document.createElement('div');
  win.style.cssText = 'width:min(860px,95vw);background:#0d1117;border:1px solid #30363d;border-radius:10px;padding:16px;box-sizing:border-box';
  win.innerHTML = '<div style="font-size:14px;font-weight:600;margin-bottom:8px">浏览器兜底采集（console-script）</div>'
    + '<div style="font-size:12px;color:#8a91a0;line-height:1.7;margin-bottom:10px">① 在新标签打开分享页（需已登录/能正常显示对话，先滚到底部让消息加载完）→ ② F12 → Console 粘贴下面脚本回车 → ③ 脚本复制<strong>完整 DOM</strong>，回到这里粘贴并提交（提取在 lab 端做）。</div>'
    + '<pre id="fbScript" style="background:#0b0d11;border:1px solid #262b36;border-radius:6px;padding:10px;font-size:11px;max-height:200px;overflow:auto;white-space:pre-wrap;user-select:text">' + esc(script) + '</pre>'
    + '<div style="margin-top:8px;display:flex;justify-content:flex-end"><button class="pg" id="fbCopy">复制脚本</button></div>'
    + '<textarea id="fbJson" spellcheck="false" placeholder="把复制到的完整 DOM（或 messages JSON）粘贴到这里…" style="width:100%;box-sizing:border-box;height:150px;margin-top:8px;background:#0b0d11;border:1px solid #262b36;color:#e6e8ee;border-radius:6px;padding:8px;font-size:12px;font-family:ui-monospace,Menlo,monospace"></textarea>'
    + '<div style="margin-top:10px;display:flex;justify-content:flex-end;gap:8px"><button class="pg" id="fbCancel">取消</button><button class="pg" id="fbOk" style="border-color:#3fb950;color:#3fb950">提交入库</button></div>';
  ov.appendChild(win); document.body.appendChild(ov);
  const close = function () { ov.remove(); };
  ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
  win.querySelector('#fbCancel').onclick = close;
  win.querySelector('#fbCopy').onclick = function () {
    try { navigator.clipboard.writeText(script).then(function () { notice('✓ 脚本已复制', 'success'); }); } catch {}
  };
  win.querySelector('#fbOk').onclick = async function () {
    let raw = (win.querySelector('#fbJson').value || '').trim();
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    let payload = { id: id };
    if (raw.charAt(0) === '<') {
      payload.html = raw;   // 完整 DOM → 服务端 cheerio 提取
    } else {
      let data = null;
      try { data = JSON.parse(raw); } catch (e) { notice('粘贴内容既不是 HTML 也不是合法 JSON', 'error'); return; }
      const messages = (data && Array.isArray(data.messages)) ? data.messages : (Array.isArray(data) ? data : null);
      if (!messages || !messages.length) { notice('未找到 messages 数组', 'error'); return; }
      payload.messages = messages;
      if (data && data.title) payload.title = data.title;
    }
    try {
      const d = await j('/api/run/console-import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      close();
      notice('✓ 已入库：' + (d.detail || (d.count + ' 条')) , 'success');
      openDetail(id);
    } catch (err) { notice('✗ 入库失败: ' + (err && err.message ? err.message : err), 'error'); }
  };
}

// （旧段插入弹窗 openSegInsert 已由段间/段首/段尾 ＋ 按钮替代——见 renderSegsHtml / insertSegRowAt）
