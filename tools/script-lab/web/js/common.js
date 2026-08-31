// dailog lab 共享基础：API 请求 / 工具函数 / 路由 / 登录入口
let labEnv = null;

async function j(u, opts){
  const h = (opts&&opts.headers)||{};
  if (labEnv) h['X-Lab-Env'] = labEnv;
  const tok = labEnv ? localStorage.getItem('dailog-lab-token-'+labEnv) : null;
  if (tok) h['Authorization'] = 'Bearer '+tok;
  opts = {...(opts||{}), headers:h};
  const r=await fetch(u,opts);
  const d=await r.json().catch(()=>({ok:false,error:'HTTP '+r.status}));
  if(!r.ok||d.ok===false)throw new Error(d.error||'HTTP '+r.status);
  return d;
}

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}

// 全局通知（右上角 toast，自动消失）
let noticeTimer = null;
function notice(msg, type){
  let el = document.getElementById('appNotice');
  if (!el) {
    el = document.createElement('div');
    el.id = 'appNotice';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = 'app-notice ' + (type || 'info');
  el.style.display = 'block';
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { el.style.display = 'none'; }, 3500);
}

function fmtDate(s){ if(!s) return '—'; const d=new Date(s); if(isNaN(d)) return String(s).slice(0,16); const p=n=>String(n).padStart(2,'0'); return d.getFullYear()+'/'+(d.getMonth()+1)+'/'+d.getDate()+' '+p(d.getHours())+':'+p(d.getMinutes()); }

// 路径路由：/ → 列表；/login → 登录；/settings → 设置；/<id> → 投稿详情
window.addEventListener('popstate', routeInit);
function routeInit(){
  const p = location.pathname;
  if (p === '/login') {
    document.getElementById('appView').style.display='none';
    document.getElementById('loginView').style.display='flex';
    return;
  }
  if (p === '/settings') { openDesign(); return; }
  const id = p.slice(1);
  if (id && /^[0-9a-fA-F-]{8,64}$/.test(id)) { openDetail(id); return; }
  // 首页
  const ld=document.getElementById('listLoading'); if(ld) ld.style.display='none';
  const sb=document.getElementById('statbar'); if(sb) sb.style.display='flex';
  const pg=document.getElementById('pager'); if(pg) pg.style.display='flex';
  document.getElementById('listWrap').style.display='block';
  document.getElementById('detailWrap').style.display='none';
  document.getElementById('designWrap').style.display='none';
  loadApp();
}

function showList(){
  document.getElementById('detailWrap').style.display='none';
  document.getElementById('designWrap').style.display='none';
  const sb=document.getElementById('statbar'); if(sb) sb.style.display='flex';
  const pg=document.getElementById('pager'); if(pg) pg.style.display='flex';
  document.getElementById('listWrap').style.display='block';
  history.replaceState(null,'','/');
  loadApp();
}

function goDetail(id){
  history.pushState(null, '', '/' + id);
  openDetail(id);
}

async function boot(){
  try {
    const envsD = await j('/api/envs');
    const envs = envsD.envs || [];
    if (!envs.length) { showLogin('无可用环境——请配置 .dailog-editor/envs.json'); return; }
    // 逐个探测登录态：cookie 会话（密码登录）或 Bearer token（配对码）皆可
    const statuses = [];
    for (const e of envs) {
      const hasCookie = localStorage.getItem('dailog-lab-cookie-'+e.name) === '1';
      const tok = localStorage.getItem('dailog-lab-token-'+e.name);
      let loggedIn = false, userEmail = '';
      if (hasCookie || tok) {
        try {
          labEnv = e.name;
          const me = await j('/api/me');
          loggedIn = true; userEmail = me.email || me.username || '';
        } catch { /* 登录态失效 */ }
        labEnv = null;
      }
      statuses.push({ ...e, loggedIn, userEmail });
    }
    const logged = statuses.filter(s=>s.loggedIn);
    if (logged.length === 1) {
      // 只有一个已登录环境 → 本地直进（不再调后端 select）
      labEnv = logged[0].name;
      enterApp(logged[0]);
      return;
    }
    // 0 个或多个已登录 → 登录页选择
    showLogin(null, statuses);
  } catch(e) { showLogin(e.message); }
}

function enterApp(envObj){
  labEnv = envObj.name;
  document.getElementById('loginView').style.display='none';
  document.getElementById('appView').style.display='block';
  document.getElementById('envTag').textContent=envObj.name||'';
  document.getElementById('userEmail').textContent=envObj.userEmail||'…';
  routeInit();
}

function logout(){
  if (!confirm('确定要退出登录吗？')) return;
  if (labEnv) { localStorage.removeItem('dailog-lab-token-'+labEnv); localStorage.removeItem('dailog-lab-cookie-'+labEnv); }
  labEnv = null;
  document.getElementById('appView').style.display='none';
  document.getElementById('loginView').style.display='flex';
  boot();
}

// 复制完整 ID（通用）
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.copy-btn');
  if (!btn) return;
  const id = btn.getAttribute('data-id');
  if (!id) return;
  let ok = false;
  try {
    const ta = document.createElement('textarea'); ta.value = id; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.focus(); ta.select(); ta.setSelectionRange(0, ta.value.length);
    ok = document.execCommand('copy'); ta.remove();
  } catch { ok = false; }
  if (!ok) { try { await navigator.clipboard.writeText(id); ok = true; } catch {} }
  const old = btn.textContent; btn.textContent = ok ? '✓' : '✗'; setTimeout(() => { btn.textContent = old; }, 1200);
});
