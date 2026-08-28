(() => {
  const state = { data: null, sha: null };
  const enc = new TextEncoder();

  function currentPeriod() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  function b64(str) {
    let binary = ''; enc.encode(str).forEach(b => binary += String.fromCharCode(b)); return btoa(binary);
  }
  function gh() {
    try { return JSON.parse(localStorage.getItem('densel_gh_settings') || '{}'); } catch (_) { return {}; }
  }
  function token() { return localStorage.getItem('densel_gh_token') || ''; }
  function apiUrl() {
    const s = gh(); return `https://api.github.com/repos/${s.owner}/${s.repo}/contents/meter-readings.json`;
  }
  function isAdmin() { return document.querySelector('#adminScreen.active'); }

  async function load() {
    const s = gh(), t = token();
    if (!s.owner || !s.repo || !t) return;
    const res = await fetch(`${apiUrl()}?ref=${s.branch || 'main'}&_=${Date.now()}`, { cache:'no-store', headers:{Authorization:`Bearer ${t}`,Accept:'application/vnd.github+json'} });
    if (!res.ok) throw new Error(`Не удалось прочитать показания: HTTP ${res.status}`);
    const json = await res.json();
    const raw = atob((json.content || '').replace(/\n/g,''));
    const bytes = new Uint8Array(raw.length); for(let i=0;i<raw.length;i++) bytes[i] = raw.charCodeAt(i);
    state.data = JSON.parse(new TextDecoder().decode(bytes)); state.sha = json.sha;
  }

  async function save(message) {
    const s = gh(), t = token();
    const res = await fetch(apiUrl(), { method:'PUT', headers:{Authorization:`Bearer ${t}`,Accept:'application/vnd.github+json','Content-Type':'application/json'}, body:JSON.stringify({message,content:b64(JSON.stringify(state.data,null,2)),branch:s.branch || 'main',sha:state.sha}) });
    if (!res.ok) throw new Error(`Ошибка сохранения показаний: HTTP ${res.status}`);
    state.sha = (await res.json()).content.sha;
  }

  function render() {
    if (!isAdmin() || document.getElementById('meterAdminCard')) return;
    const host = document.getElementById('tab-overview'); if (!host) return;
    const current = state.data?.current || {};
    const submitted = current.status === 'submitted' && current.period === currentPeriod();
    const card = document.createElement('section'); card.id = 'meterAdminCard'; card.className = 'panel glass fade-up';
    card.innerHTML = `<div class="panel-head"><h3>Показания счётчиков</h3><span class="badge ${submitted?'paid':'pending'}">${submitted?'Переданы':'Не переданы'}</span></div><p class="muted">Период: ${currentPeriod()}${submitted && current.submittedAt ? ` · переданы: ${current.submittedAt}` : ''}</p><button class="btn ${submitted?'ghost':'primary'} full" id="meterSubmitBtn">${submitted?'Отменить отметку':'Отметить «Переданы»'}</button>`;
    host.appendChild(card);
    document.getElementById('meterSubmitBtn').addEventListener('click', async () => {
      try {
        const now = new Date().toISOString().slice(0,10);
        if (submitted) { state.data.current = {period:currentPeriod(),status:'not_submitted',submittedAt:null,note:''}; await save('Показания: отмена отметки передачи'); }
        else { state.data.history = state.data.history || []; if (state.data.current?.period) state.data.history.push(state.data.current); state.data.current = {period:currentPeriod(),status:'submitted',submittedAt:now,note:''}; await save('Показания: отмечены как переданные'); }
        card.remove(); render();
      } catch (e) { alert(e.message); }
    });
  }

  async function init() { try { await load(); render(); } catch (e) { console.error(e); } }
  const observer = new MutationObserver(() => { if (isAdmin() && !document.getElementById('meterAdminCard') && state.data) render(); });
  observer.observe(document.documentElement, {subtree:true,childList:true,attributes:true,attributeFilter:['class']});
  init();
})();
