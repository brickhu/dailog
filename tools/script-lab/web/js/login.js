// 登录页：环境选择 + 密码登录 / 已登录直进
let labStatuses = [];

function showLogin(err, statuses){
  if (location.pathname !== '/login') history.replaceState(null, '', '/login');
  document.getElementById('loginView').style.display='flex';
  document.getElementById('appView').style.display='none';
  labStatuses = statuses || [];
  const sel=document.getElementById('envSelect');
  if (sel) sel.innerHTML=labStatuses.map(s=>`<option value='${s.name}'>${s.name}${s.label?' — '+s.label:''}</option>`).join('');
  const main=document.getElementById('loginMain');
  if (err) { if(main) main.innerHTML='<div class="err">'+esc(err)+'</div>'; return; }
  if (labStatuses.length===0) { if(main) main.innerHTML='<div class="muted">无可用环境——请配置 .dailog-editor/envs.json</div>'; return; }
  if (sel) { const first = labStatuses.find(s=>s.name===sel.value) || labStatuses[0]; renderLoginMain(first); }
}

function renderLoginMain(s){
  if(!s) return;
  const st=document.getElementById('envStatus');
  if(st) st.textContent = s.loggedIn ? ('已登录'+(s.userEmail?' · '+s.userEmail:'')) : '未登录——需配对';
  const main=document.getElementById('loginMain');
  if(!main) return;
  if (s.loggedIn){
    main.innerHTML=`<button onclick='enterLogged()'>进入控制台</button>`;
  } else {
    main.innerHTML=`
      <input id='loginEmail' type='email' placeholder='邮箱' autocomplete='username' style='margin-bottom:8px'>
      <input id='loginPwd' type='password' placeholder='密码' autocomplete='current-password' style='margin-bottom:8px' onkeydown='if(event.key==="Enter")passwordLogin()'>
      <button onclick='passwordLogin()' id='btnPwdLogin'>登 录</button>
      <div class='err' id='loginErr'></div>`;
  }
}

function onEnvChange(){
  const s=labStatuses.find(x=>x.name===document.getElementById('envSelect').value);
  if (s) renderLoginMain(s);
}

function enterLogged(){
  const name=document.getElementById('envSelect').value;
  labEnv=name;
  history.replaceState(null, '', '/');
  enterApp({name});
}

async function passwordLogin(){
  const name=document.getElementById('envSelect').value;
  const email=document.getElementById('loginEmail').value.trim();
  const pwd=document.getElementById('loginPwd').value;
  const err=document.getElementById('loginErr');
  if(!email||!pwd){err.textContent='请输入邮箱和密码';return}
  const btn=document.getElementById('btnPwdLogin'); if(btn)btn.disabled=true; btn.textContent='登录中…';
  err.className='err';
  try{
    await j('/api/auth/password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({env:name,email,password:pwd})});
    err.className='ok';err.textContent='✅ 登录成功，进入控制台…';
    localStorage.setItem('dailog-lab-cookie-'+name, '1');  // 标记该环境走 cookie 会话
    history.replaceState(null, '', '/');
    setTimeout(()=>enterApp({name}), 600);
  }catch(e){err.textContent=e.message; if(btn){btn.disabled=false;btn.textContent='登 录';}}
}
