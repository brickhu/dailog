// 首页：投稿列表 + 分页 + 采集（单条/批量）+ 状态轮询
let pageNo = 1, pageTotal = 1;
const fetchingIds = new Set();
let fetchPollTimer = null;

// ---- 采集弹层（单条/批量采集在弹层内显示进度，离开列表页不丢） ----
function openCollectModal(title){
  const m = document.getElementById('collectModal');
  if (!m) return;
  m.style.display = 'flex';
  const t = document.getElementById('collectModalTitle');
  if (t) t.textContent = title || '采集';
  const body = document.getElementById('collectModalBody');
  if (body) body.innerHTML = '<div class="muted">准备采集…</div>';
  const doneBtn = document.getElementById('collectModalDoneBtn');
  if (doneBtn) doneBtn.disabled = true;
  const closeBtn = document.getElementById('collectModalClose');
  if (closeBtn) closeBtn.disabled = true;
}
function closeCollectModal(){
  const m = document.getElementById('collectModal');
  if (m) m.style.display = 'none';
}
function updateCollectModal(d){
  const body = document.getElementById('collectModalBody');
  if (!body) return;
  const fetching = (d && d.fetching) || [];
  const results = (d && d.results) || {};
  const rows = [];
  fetching.forEach((f) => {
    rows.push(`<div style='margin-bottom:6px'><span class='spin' style='display:inline-block'></span> 采集中 <span class='mono muted'>${esc(f.url || f.id || '')}</span></div>`);
  });
  Object.keys(results).forEach((id) => {
    const r = results[id];
    const ok = r && r.ok;
    rows.push(`<div style='margin-bottom:6px;color:${ok ? '#3fb950' : '#f85149'}'><b>${ok ? '✓' : '✗'}</b> <span>${esc((r && r.detail) || (ok ? '采集成功' : '采集失败'))}</span></div>`);
  });
  body.innerHTML = rows.length ? rows.join('') : '<div class="muted">暂无采集任务</div>';
  const done = fetching.length === 0;
  const doneBtn = document.getElementById('collectModalDoneBtn');
  if (doneBtn) doneBtn.disabled = !done;
  const closeBtn = document.getElementById('collectModalClose');
  if (closeBtn) closeBtn.disabled = !done;
  const titleEl = document.getElementById('collectModalTitle');
  if (titleEl) titleEl.textContent = done ? '采集完成' : ('采集中 ' + fetching.length + ' 条…');
}

async function loadApp(){
  // 首屏加载中：隐藏 批量采集条 / 表格 / 分页，显示“加载中....”
  const ld=document.getElementById('listLoading'); if(ld) ld.style.display='block';
  const sb=document.getElementById('statbar'); if(sb) sb.style.display='none';
  const lw=document.getElementById('listWrap'); if(lw) lw.style.display='none';
  const pg=document.getElementById('pager'); if(pg) pg.style.display='none';
  const bb0=document.getElementById('btnBatch'); if(bb0){ bb0.textContent='批量采集'; }
  try{
    const o=await j('/api/overview');
    document.getElementById('userEmail').textContent=o.userEmail||'—';
    const d=await j('/api/submissions?page='+pageNo+'&pageSize=50');
    const rows=d.rows||[];
    window._lastRows = rows;
    fetchingIds.clear();
    pageTotal = Math.max(1, Math.ceil((d.total||rows.length)/50));
    const pcEl=document.getElementById('pendingCount');
    pcEl.textContent=(d.pendingCount!==undefined?d.pendingCount:rows.filter(r=>r.stage==='待采集').length);
    pcEl.classList.toggle('zero', Number(pcEl.textContent)===0);
    document.getElementById('pendingCount').dataset.total=d.total||rows.length;
    const bb=document.getElementById('btnBatch');
    bb.disabled = Number(document.getElementById('pendingCount').textContent)===0;
    if (Number(document.getElementById('pendingCount').textContent)===0) bb.textContent='批量采集';
    renderPager();
    const tb=document.getElementById('rows');
    tb.innerHTML=rows.map(r=>`
      <tr>
        <td class='cicon-cell'>${fetchIcon(r)}</td>
        <td style='white-space:nowrap;max-width:160px'><span title='${r.id}' style='font-size:13px;display:inline-block;max-width:118px;overflow:hidden;text-overflow:ellipsis;vertical-align:bottom' class='mono'>${esc(r.id)}</span> <button class='copy-btn' data-id='${r.id}' title='复制完整 ID'>⧉</button></td>
        <td>
          <div style='display:flex;align-items:center;gap:6px'>
          ${r.title
            ? `<a href='${esc(r.url)}' target='_blank' rel='noopener' title='${esc(r.title)}' style='font-size:13px;display:inline-block;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'>${esc(r.title)}</a>`
            : (r.url ? `<a class='mono url' href='${esc(r.url)}' target='_blank' rel='noopener'>${esc(r.url)}</a>` : '—')}
          ${r.dialogueCount && r.dialogueCount.messages ? `<span class='tag' title='消息数'>${r.dialogueCount.messages} 条</span>` : ''}
          </div>
        </td>
        <td>${esc(r.displayName||'?')} <span class='muted mono'>(${esc(r.userEmail||'')})</span></td>
        <td class='mono muted'>${fmtDate(r.createdAt)}</td>
        <td><span class='tag ${esc(r.stage)}'>${esc(r.stage)}</span></td>
        <td><a class='detail-link' href='/${r.id}' onclick='event.preventDefault();goDetail("${r.id}")'>进入 →</a></td>
      </tr>`).join('') || "<tr><td colspan='5' class='muted'>暂无投稿</td></tr>";
  }catch(e){
    document.getElementById('rows').innerHTML="<tr><td colspan='5' class='muted'>加载失败: "+esc(e.message)+"</td></tr>";
  }
  if(ld) ld.style.display='none';
  if(sb) sb.style.display='flex';
  if(lw) lw.style.display='block';
  if(pg) pg.style.display='flex';
}

function fetchIcon(r){
  const c = r.collected;
  if (c === 1) {
    return `<span style='display:inline-flex;align-items:center;gap:4px'><span class='cicon done' title='已采集'>✓</span></span>`;
  }
  if (fetchingIds.has(r.id)) return `<span class='cicon fetching' title='采集中'><span class='spin'></span></span>`;
  if (c === -1) return `<span class='cicon failed' data-fetch-id='${r.id}' title='采集失败，点击重试'>✗</span>`;
  return `<span class='cicon pending' data-fetch-id='${r.id}' title='点击采集'>⇩</span>`;
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-fetch-id]');
  if (!el) return;
  e.stopPropagation();
  singleFetch(el.getAttribute('data-fetch-id'));
});

async function singleFetch(id){
  // 打开采集弹层（离开列表页不丢进度）
  openCollectModal('采集中…');
  // 立即显示 spinner + 状态条（不等 server）
  fetchingIds.add(id);
  renderRows();
  const idle=document.getElementById('statIdle'); const busy=document.getElementById('statFetching');
  if(idle&&busy){ idle.style.display='none'; busy.style.display='block'; }
  const bb=document.getElementById('btnBatch'); if(bb) bb.style.display='none';
  const ue=document.getElementById('fetchingUrl'); if(ue) ue.textContent=id.slice(0,8)+'…';
  startFetchPoll();
  try{
    await j('/api/run/fetch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});
  }catch(e){ alert(e.message); }
}

async function startFetchPoll(){
  if (fetchPollTimer) return;
  fetchPollTimer = setInterval(async () => {
    try{
      const d = await j('/api/status/fetch');
      fetchingIds.clear();
      // 采集弹层：同步更新进度
      if (typeof updateCollectModal === 'function') { try { updateCollectModal(d); } catch {} }
      const fetching = d.fetching||[];
      fetching.forEach(f=>fetchingIds.add(f.id));
      // 统计条切换：队列非空显示"正在采集：<url>"+spinner
      const idle=document.getElementById('statIdle'); const busy=document.getElementById('statFetching');
      const urlEl=document.getElementById('fetchingUrl');
      const bb=document.getElementById('btnBatch');
      if (fetching.length>0 && busy && idle){
        idle.style.display='none'; busy.style.display='block';
        if (urlEl) urlEl.textContent=((fetching[0].url)||'').slice(0,80);
        if (bb) bb.style.display='none';
      } else if (busy && idle) {
        idle.style.display='block'; busy.style.display='none';
        if (bb) bb.style.display='inline-block';
      }
      renderRows();
      // 无进行中的采集且有完成结果 → 刷新列表（图标/状态更新）
      const results = d.results||{};
      if (fetching.length===0 && Object.keys(results).length>0){
        clearInterval(fetchPollTimer); fetchPollTimer=null;
        loadApp();
        return;
      }
    }catch(e){ clearInterval(fetchPollTimer); fetchPollTimer=null; }
  }, 2000);
}

function renderRows(){
  // 仅重渲染图标列（简单方式：整表重渲染，保留 rows 数据）
  if (window._rowsCache) { window._lastRows = window._rowsCache; }
  if (window._lastRows) {
    const tb=document.getElementById('rows');
    tb.innerHTML=window._lastRows.map(r=>`<tr>
      <td class='cicon-cell'>${fetchIcon(r)}</td>
      <td style='white-space:nowrap'><span title='${r.id}' style='font-size:13px'>${r.title?esc(r.title):'(无标题)'}</span> <button class='copy-btn' data-id='${r.id}' title='复制完整 ID'>⧉</button></td>
      <td><div style='display:flex;align-items:center;gap:6px'>${r.title
        ? `<a href='${esc(r.url)}' target='_blank' rel='noopener' title='${esc(r.title)}' style='font-size:13px;display:inline-block;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'>${esc(r.title)}</a>`
        : (r.url ? `<a class='mono url' href='${esc(r.url)}' target='_blank' rel='noopener'>${esc(r.url)}</a>` : '—')}
        ${r.dialogueCount && r.dialogueCount.messages ? `<span class='tag' title='消息数'>${r.dialogueCount.messages} 条</span>` : ''}</div></td>
      <td>${esc(r.displayName||'?')} <span class='muted mono'>(${esc(r.userEmail||'')})</span></td>
      <td class='mono muted'>${fmtDate(r.createdAt)}</td>
      <td><span class='tag ${esc(r.stage)}'>${esc(r.stage)}</span></td>
      <td><a class='detail-link' href='/${r.id}' onclick='event.preventDefault();goDetail("${r.id}")'>进入 →</a></td>
    </tr>`).join('');
  }
}

function renderPager(){
  const el=document.getElementById('pager');
  if(!el) return;
  el.innerHTML=`<span class='muted' style='margin-right:10px'>第 ${pageNo}/${pageTotal} 页 · 共 ${document.getElementById('pendingCount').dataset.total||'?'} 条</span>`+
    `<button class='pg' onclick='goPage(${pageNo-1})' ${pageNo<=1?'disabled':''}>上一页</button>`+
    `<button class='pg' onclick='goPage(${pageNo+1})' ${pageNo>=pageTotal?'disabled':''}>下一页</button>`;
}

async function goPage(n){ if(n<1||n>pageTotal) return; pageNo=n; await loadApp(); }

async function batchFetch(){
  openCollectModal('批量采集中…');
  const btn=document.getElementById('btnBatch');
  btn.disabled=true;btn.textContent='采集中…';
  try{
    const d=await j('/api/run/batch',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    const queued=d.queued||0;
    btn.textContent='已入队 '+queued+' 条…';
    // 立即显示采集中状态条
    const idle=document.getElementById('statIdle'); const busy=document.getElementById('statFetching');
    if(idle&&busy){ idle.style.display='none'; busy.style.display='block'; }
    const ue=document.getElementById('fetchingUrl'); if(ue) ue.textContent='批量采集 '+queued+' 条';
    startFetchPoll();
  }catch(e){btn.textContent='❌ '+e.message;setTimeout(()=>{btn.textContent='批量采集';btn.disabled=false},2500)}
}
