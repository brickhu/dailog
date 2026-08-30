// 设置页：提示词配置（prompts.json，本地 + R2 同步）
let currentPrompt = null;

function openDesign(){
  if (location.pathname !== '/settings') history.pushState(null, '', '/settings');
  document.getElementById('listWrap').style.display='none';
  document.getElementById('detailWrap').style.display='none';
  const sb=document.getElementById('statbar'); if(sb) sb.style.display='none';
  const pg=document.getElementById('pager'); if(pg) pg.style.display='none';
  const ld=document.getElementById('listLoading'); if(ld) ld.style.display='none';
  document.getElementById('designWrap').style.display='block';
  loadPrompts();
}

function backToApp(){
  document.getElementById('designWrap').style.display='none';
  showList();
}

async function loadPrompts(){
  const listEl=document.getElementById('promptList');
  try{
    const d=await j('/api/prompts');
    currentPrompt = d.prompts[0] ? d.prompts[0].name : null;
    listEl.innerHTML=d.prompts.map(p=>`<button class='item' data-name='${esc(p.name)}' onclick='selectPrompt("${esc(p.name)}")'>${esc(p.name)}</button>`).join('')||'<div class="muted">无提示词</div>';
    if (currentPrompt) await selectPrompt(currentPrompt);
    const st=document.getElementById('promptStatus'); if(st) st.textContent='';
  }catch(e){
    listEl.innerHTML='<div class="err">加载失败: '+esc(e.message)+'</div>';
  }
}

async function selectPrompt(name){
  currentPrompt = name;
  document.querySelectorAll('#promptList .item').forEach(b=>b.classList.toggle('active', b.dataset.name===name));
  document.getElementById('promptName').textContent=name;
  try{
    const d=await j('/api/prompts');
    const p=d.prompts.find(x=>x.name===name);
    document.getElementById('promptEditor').value = p ? p.content : '';
    const st=document.getElementById('promptStatus'); if(st) st.textContent='';
  }catch(e){
    const st=document.getElementById('promptStatus'); if(st) st.textContent='❌ '+e.message;
  }
}

async function savePrompt(){
  if (!currentPrompt) return;
  const st=document.getElementById('promptStatus');
  st.textContent='保存中…';
  try{
    const d=await j('/api/prompts/'+currentPrompt,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({content:document.getElementById('promptEditor').value})});
    st.textContent='✓ '+(d.message||'已保存');
  }catch(e){ st.textContent='❌ '+e.message; }
}
