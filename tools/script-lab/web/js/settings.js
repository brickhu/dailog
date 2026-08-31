// 设置页：提示词是工程文件（tools/script-lab/prompts/，VSCode 编辑 + git 备份 + lab 热更新）
// 本页仅保留：字典文件清单展示 + LLM 配置说明
function openDesign(){
  if (location.pathname !== '/settings') history.pushState(null, '', '/settings');
  document.getElementById('listWrap').style.display='none';
  document.getElementById('detailWrap').style.display='none';
  const sb=document.getElementById('statbar'); if(sb) sb.style.display='none';
  const pg=document.getElementById('pager'); if(pg) pg.style.display='none';
  const ld=document.getElementById('listLoading'); if(ld) ld.style.display='none';
  document.getElementById('designWrap').style.display='block';
  listPromptFiles();
}

function backToApp(){
  document.getElementById('designWrap').style.display='none';
  showList();
}

function switchSettingsTab(tab){
  document.querySelectorAll('.prompt-list .item').forEach(b => b.classList.toggle('active', b.dataset.nav === tab));
  document.getElementById('panel-prompts').style.display = tab === 'prompts' ? 'block' : 'none';
  document.getElementById('panel-llm').style.display = tab === 'llm' ? 'block' : 'none';
}

// 展示字典文件清单（读 /api/prompts/list —— lab 从工程目录列出）
async function listPromptFiles(){
  const el = document.getElementById('promptFiles');
  if (!el) return;
  try {
    const d = await j('/api/prompts/list');
    const files = (d && d.files) || [];
    el.textContent = files.length ? files.join('  ') : '（无字典文件）';
  } catch(e) {
    el.textContent = '（读取失败: ' + e.message + '）';
  }
}


