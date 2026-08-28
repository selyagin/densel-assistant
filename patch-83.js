(() => {
  const nativeFetch = window.fetch.bind(window);
  const state = { events: [], error: '', loading: false };
  const MAX_EVENTS = 200;

  function settings() { try { return JSON.parse(localStorage.getItem('densel_gh_settings') || '{}'); } catch (_) { return {}; } }
  function token() { return localStorage.getItem('densel_gh_token') || ''; }
  function api(path) { const s = settings(); return `https://api.github.com/repos/${s.owner}/${s.repo}/contents/${path}`; }
  function isAdmin() { return document.querySelector('#adminScreen.active'); }
  function watched(url) { return /\/repos\/[^/]+\/[^/]+\/contents\/(data|meter-readings)\.json(?:[?#]|$)/.exec(String(url || '')); }
  function text(value) { const n = document.createElement('span'); n.textContent = value; return n.innerHTML; }
  function encode(value) { const bytes = new TextEncoder().encode(JSON.stringify(value, null, 2)); let raw = ''; bytes.forEach(b => raw += String.fromCharCode(b)); return btoa(raw); }
  function decode(value) { const raw = atob(String(value || '').replace(/\n/g,'')); const bytes = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i); return JSON.parse(new TextDecoder().decode(bytes)); }
  function eventTitle(file) { return file === 'meter-readings' ? 'Изменён статус показаний счётчиков' : 'Изменены данные платежей'; }

  async function readLog(withToken = false) {
    const headers = { Accept:'application/vnd.github+json' }; if (withToken && token()) headers.Authorization = `Bearer ${token()}`;
    const response = await nativeFetch(`${withToken ? api('activity-log.json') : './activity-log.json'}?_=${Date.now()}`, { headers, cache:'no-store' });
    if (response.status === 404) return { sha:null, data:{schemaVersion:1, events:[]} };
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (withToken) { const item = await response.json(); return { sha:item.sha, data:decode(item.content) }; }
    return { sha:null, data:await response.json() };
  }
  async function record(file) {
    const s = settings(), t = token();
    if (!s.owner || !s.repo || !t) return;
    try {
      const current = await readLog(true);
      const events = Array.isArray(current.data.events) ? current.data.events : [];
      events.unshift({ id:`evt-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, at:new Date().toISOString(), type:file === 'meter-readings' ? 'meter_updated' : 'payments_updated', title:eventTitle(file) });
      const data = { schemaVersion:1, events:events.slice(0, MAX_EVENTS) };
      const body = { message:`Журнал: ${eventTitle(file)}`, content:encode(data), branch:s.branch || 'main' }; if (current.sha) body.sha = current.sha;
      const response = await nativeFetch(api('activity-log.json'), { method:'PUT', headers:{Authorization:`Bearer ${t}`,Accept:'application/vnd.github+json','Content-Type':'application/json'}, body:JSON.stringify(body) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.events = data.events; state.error = ''; render();
    } catch (e) { state.error = `Журнал не обновлён: ${e.message}`; render(); }
  }
  async function load() {
    if (state.loading) return; state.loading = true;
    try { state.events = (await readLog(false)).data.events || []; state.error = ''; } catch (e) { state.error = `Не удалось прочитать журнал: ${e.message}`; }
    state.loading = false; render();
  }
  function render() {
    if (!isAdmin()) return;
    const host = document.getElementById('tab-overview'); if (!host) return;
    document.getElementById('activityLogCard')?.remove();
    const rows = state.events.slice(0, 8).map(e => `<div style="padding:9px 0;border-bottom:1px solid rgba(128,128,128,.16)"><strong>${text(e.title || 'Событие')}</strong><div class="muted">${text(e.at ? new Date(e.at).toLocaleString('ru-RU') : 'Дата не указана')}</div></div>`).join('') || '<p class="muted">Действий пока нет.</p>';
    const card = document.createElement('section'); card.id = 'activityLogCard'; card.className = 'panel glass fade-up';
    card.innerHTML = `<div class="panel-head"><h3>Журнал действий</h3><span class="badge paid">${state.events.length}</span></div>${rows}${state.error ? `<p class="muted" style="color:#b42318">${text(state.error)}</p>` : ''}<button class="btn ghost full" id="reloadActivityLogBtn">Обновить журнал</button>`;
    host.appendChild(card); card.querySelector('#reloadActivityLogBtn').addEventListener('click', load);
  }
  window.fetch = async (input, init = {}) => {
    const url = input instanceof Request ? input.url : input;
    const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const match = method === 'PUT' ? watched(url) : null;
    const response = await nativeFetch(input, init);
    if (match && response.ok) record(match[1]);
    return response;
  };
  const observer = new MutationObserver(render);
  observer.observe(document.documentElement, {subtree:true,childList:true,attributes:true,attributeFilter:['class']});
  window.DenselActivityLog = { load, record };
  load();
})();
