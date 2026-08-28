(() => {
  const state = { data: null, sha: null };
  const enc = new TextEncoder();
  const DISMISS_KEY = 'densel_meter_banner_dismissed';
  function currentPeriod(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; }
  function b64(str) { let binary = ''; enc.encode(str).forEach(b => binary += String.fromCharCode(b)); return btoa(binary); }
  function gh() { try { return JSON.parse(localStorage.getItem('densel_gh_settings') || '{}'); } catch (_) { return {}; } }
  function token() { return localStorage.getItem('densel_gh_token') || ''; }
  function apiUrl() { const s = gh(); return `https://api.github.com/repos/${s.owner}/${s.repo}/contents/meter-readings.json`; }
  function isAdmin() { return document.querySelector('#adminScreen.active'); }
  function isClient() { return document.querySelector('#clientScreen.active'); }
  function isSubmitted(date = new Date()) { const c = state.data?.current || {}; return c.status === 'submitted' && c.period === currentPeriod(date); }
  function statusFor(date = new Date()) { if (isSubmitted(date)) return 'submitted'; return date.getDate() >= 25 ? 'urgent' : 'waiting'; }
  function bannerText() { return (state.data?.notice?.text || 'Пожалуйста, передайте показания счётчиков до конца месяца.').trim(); }
  function escapeHtml(value) { const n = document.createElement('div'); n.textContent = value; return n.innerHTML; }
  async function load() {
    const s = gh(), t = token();
    if (s.owner && s.repo && t) {
      const res = await fetch(`${apiUrl()}?ref=${s.branch || 'main'}&_=${Date.now()}`, { cache:'no-store', headers:{Authorization:`Bearer ${t}`,Accept:'application/vnd.github+json'} });
      if (!res.ok) throw new Error(`Не удалось прочитать показания: HTTP ${res.status}`);
      const json = await res.json(), raw = atob((json.content || '').replace(/\n/g,'')), bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      state.data = JSON.parse(new TextDecoder().decode(bytes)); state.sha = json.sha; return;
    }
    const res = await fetch(`./meter-readings.json?_=${Date.now()}`, {cache:'no-store'});
    if (!res.ok) throw new Error(`Не удалось прочитать показания: HTTP ${res.status}`);
    state.data = await res.json();
  }
  async function save(message) {
    const s = gh(), t = token();
    if (!s.owner || !s.repo || !t) throw new Error('Для сохранения войдите в админскую часть и настройте GitHub-доступ.');
    const res = await fetch(apiUrl(), { method:'PUT', headers:{Authorization:`Bearer ${t}`,Accept:'application/vnd.github+json','Content-Type':'application/json'}, body:JSON.stringify({message,content:b64(JSON.stringify(state.data,null,2)),branch:s.branch || 'main',sha:state.sha}) });
    if (!res.ok) throw new Error(`Ошибка сохранения показаний: HTTP ${res.status}`);
    state.sha = (await res.json()).content.sha;
  }
  function renderAdmin() {
    if (!isAdmin() || document.getElementById('meterAdminCard')) return;
    const host = document.getElementById('tab-overview'); if (!host) return;
    const current = state.data?.current || {}, submitted = isSubmitted();
    const card = document.createElement('section'); card.id = 'meterAdminCard'; card.className = 'panel glass fade-up';
    card.innerHTML = `<div class="panel-head"><h3>Показания счётчиков</h3><span class="badge ${submitted?'paid':'pending'}">${submitted?'Переданы':'Не переданы'}</span></div><p class="muted">Период: ${currentPeriod()}${submitted && current.submittedAt ? ` · переданы: ${current.submittedAt}` : ''}</p><button class="btn ${submitted?'ghost':'primary'} full" id="meterSubmitBtn">${submitted?'Отменить отметку':'Отметить «Переданы»'}</button><div style="margin-top:16px"><label class="muted" for="meterNoticeText">Текст красного баннера для сестры</label><textarea id="meterNoticeText" rows="3" style="width:100%;margin-top:7px;box-sizing:border-box">${escapeHtml(bannerText())}</textarea><button class="btn ghost full" style="margin-top:8px" id="meterNoticeSaveBtn">Сохранить текст баннера</button></div>`;
    host.appendChild(card);
    document.getElementById('meterSubmitBtn').addEventListener('click', async () => {
      try { const now = new Date().toISOString().slice(0,10); if (submitted) { state.data.current = {period:currentPeriod(),status:'not_submitted',submittedAt:null,note:''}; await save('Показания: отмена отметки передачи'); } else { state.data.history = state.data.history || []; if (state.data.current?.period) state.data.history.push(state.data.current); state.data.current = {period:currentPeriod(),status:'submitted',submittedAt:now,note:''}; await save('Показания: отмечены как переданные'); } card.remove(); renderAdmin(); } catch (e) { alert(e.message); }
    });
    document.getElementById('meterNoticeSaveBtn').addEventListener('click', async () => {
      try { const text = document.getElementById('meterNoticeText').value.trim(); if (!text) throw new Error('Введите текст баннера.'); state.data.notice = {text}; await save('Показания: обновлён текст баннера'); alert('Текст баннера сохранён.'); } catch (e) { alert(e.message); }
    });
  }
  function renderClient() {
    if (!isClient()) return;
    const status = statusFor(), current = state.data?.current || {}, summary = document.getElementById('clientSummary');
    if (summary && !document.getElementById('meterClientCard')) {
      const card = document.createElement('section'); card.id = 'meterClientCard'; card.className = 'summary-card';
      if (status === 'submitted') card.innerHTML = `<div class="label">Показания счётчиков</div><div class="value green">Переданы ✓</div><div class="sub">Дата передачи: ${current.submittedAt || '—'}</div>`;
      else if (status === 'urgent') card.innerHTML = `<div class="label">Показания счётчиков</div><div class="value red">Не переданы</div><div class="sub">Передайте показания до конца месяца</div>`;
      else card.innerHTML = `<div class="label">Показания счётчиков</div><div class="value amber">Ожидаются</div><div class="sub">Передать можно до конца месяца</div>`;
      summary.insertBefore(card, summary.firstChild);
    }
    if (status !== 'urgent' || sessionStorage.getItem(DISMISS_KEY) === currentPeriod() || document.getElementById('meterUrgentBanner')) return;
    const screen = document.getElementById('clientScreen'); if (!screen) return;
    const banner = document.createElement('div'); banner.id = 'meterUrgentBanner'; banner.setAttribute('role','alert');
    banner.style.cssText = 'margin:12px 0;padding:14px 42px 14px 14px;border-radius:14px;background:#b42318;color:#fff;font-weight:600;line-height:1.35;position:relative;box-shadow:0 6px 18px rgba(180,35,24,.28)';
    banner.innerHTML = `<span>${escapeHtml(bannerText())}</span><button type="button" aria-label="Закрыть" style="position:absolute;right:10px;top:7px;border:0;background:transparent;color:#fff;font-size:28px;line-height:28px">×</button>`;
    banner.querySelector('button').addEventListener('click', () => { sessionStorage.setItem(DISMISS_KEY, currentPeriod()); banner.remove(); });
    screen.insertBefore(banner, screen.firstChild);
  }
  async function init() { try { await load(); renderAdmin(); renderClient(); } catch (e) { console.error(e); } }
  let wasClient = false;
  const observer = new MutationObserver(() => { const client = !!isClient(); if (wasClient && !client) sessionStorage.removeItem(DISMISS_KEY); wasClient = client; if (state.data) { renderAdmin(); renderClient(); } });
  observer.observe(document.documentElement, {subtree:true,childList:true,attributes:true,attributeFilter:['class']});
  window.DenselMeterStatus = { statusFor };
  init();
})();
