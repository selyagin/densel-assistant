(() => {
  const state = { backup: null, fileName: '', error: '', message: '' };
  const fetchApi = window.fetch.bind(window);
  const encoder = new TextEncoder();
  function settings() { try { return JSON.parse(localStorage.getItem('densel_gh_settings') || '{}'); } catch (_) { return {}; } }
  function token() { return localStorage.getItem('densel_gh_token') || ''; }
  function isAdmin() { return document.querySelector('#adminScreen.active'); }
  function esc(value) { const n = document.createElement('span'); n.textContent = String(value || ''); return n.innerHTML; }
  function b64(value) { let raw = ''; encoder.encode(JSON.stringify(value, null, 2)).forEach(b => raw += String.fromCharCode(b)); return btoa(raw); }
  function decode(content) { const raw = atob(String(content || '').replace(/\n/g,'')); const bytes = new Uint8Array(raw.length); for (let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i); return JSON.parse(new TextDecoder().decode(bytes)); }
  function api(path) { const s = settings(); return `https://api.github.com/repos/${s.owner}/${s.repo}/contents/${path}`; }
  function validRoot(value) { return value && typeof value === 'object' && !Array.isArray(value); }
  function validateBackup(value) {
    if (!validRoot(value)) return 'Файл резервной копии должен быть JSON-объектом.';
    if (value.format !== 'densel-backup' || value.version !== 1) return 'Это не резервная копия Densel Assistant версии 1.';
    if (!validRoot(value.data) || !validRoot(value.meterReadings)) return 'В резервной копии отсутствуют корректные разделы data и meterReadings.';
    return '';
  }
  async function getPublic(path) { const r = await fetchApi(`${path}?_backup=${Date.now()}`, {cache:'no-store'}); if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`); return r.json(); }
  async function readRepo(path) {
    const s=settings(), t=token(); if (!s.owner || !s.repo || !t) throw new Error('Настройте GitHub-доступ в админском режиме.');
    const r = await fetchApi(`${api(path)}?ref=${s.branch || 'main'}&_=${Date.now()}`, {headers:{Authorization:`Bearer ${t}`,Accept:'application/vnd.github+json'},cache:'no-store'});
    if (!r.ok) throw new Error(`${path}: GitHub вернул HTTP ${r.status}`); const item=await r.json(); return {sha:item.sha,data:decode(item.content)};
  }
  async function writeRepo(path, data, sha) {
    const s=settings(), t=token();
    const r = await fetchApi(api(path), {method:'PUT',headers:{Authorization:`Bearer ${t}`,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({message:`Восстановление из резервной копии: ${path}`,content:b64(data),branch:s.branch || 'main',sha})});
    if (!r.ok) throw new Error(`${path}: GitHub вернул HTTP ${r.status}`);
  }
  async function exportBackup() {
    try {
      state.error=''; state.message='Подготавливаю резервную копию…'; render();
      const [data, meterReadings] = await Promise.all([getPublic('./data.json'),getPublic('./meter-readings.json')]);
      const backup={format:'densel-backup',version:1,createdAt:new Date().toISOString(),data,meterReadings};
      const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}), url=URL.createObjectURL(blob), a=document.createElement('a');
      a.href=url; a.download=`densel-backup-${new Date().toISOString().slice(0,10)}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
      state.message='Резервная копия сформирована. В ней нет токена GitHub и настроек доступа.'; render();
    } catch(e) { state.error=`Не удалось создать копию: ${e.message}`; state.message=''; render(); }
  }
  async function chooseFile(event) {
    const file=event.target.files?.[0]; if (!file) return;
    try { const backup=JSON.parse(await file.text()), err=validateBackup(backup); if (err) throw new Error(err); state.backup=backup; state.fileName=file.name; state.error=''; state.message='Копия проверена. Перед восстановлением будут сохранены только data.json и meter-readings.json.'; } catch(e) { state.backup=null; state.fileName=''; state.error=`Файл не принят: ${e.message}`; state.message=''; }
    event.target.value=''; render();
  }
  async function restore() {
    if (!state.backup) return;
    const proceed=confirm(`Восстановить data.json и meter-readings.json из файла «${state.fileName}»? Текущие версии этих двух файлов в GitHub будут заменены. Токены и настройки не затрагиваются.`); if (!proceed) return;
    try {
      state.error=''; state.message='Проверяю актуальные версии в GitHub…'; render();
      const [dataCurrent,meterCurrent]=await Promise.all([readRepo('data.json'),readRepo('meter-readings.json')]);
      state.message='Восстанавливаю data.json…'; render(); await writeRepo('data.json',state.backup.data,dataCurrent.sha);
      state.message='Восстанавливаю meter-readings.json…'; render(); await writeRepo('meter-readings.json',state.backup.meterReadings,meterCurrent.sha);
      state.message='Восстановление завершено. Обновите страницу, чтобы загрузить восстановленные данные.'; state.backup=null; state.fileName=''; render();
    } catch(e) { state.error=`Восстановление остановлено: ${e.message}. Проверьте данные и обновите страницу перед повторной попыткой.`; state.message=''; render(); }
  }
  function render() {
    if (!isAdmin()) return; const host=document.getElementById('tab-overview'); if (!host) return;
    document.getElementById('backupCard')?.remove(); const card=document.createElement('section'); card.id='backupCard'; card.className='panel glass fade-up';
    const fileInfo=state.backup ? `<p class="muted">Выбран файл: ${esc(state.fileName)}. Будут восстановлены два раздела: платежи и показания.</p><button class="btn primary full" id="restoreBackupBtn">Восстановить эту копию</button>` : '';
    card.innerHTML=`<div class="panel-head"><h3>Резервная копия</h3><span class="badge paid">Локально</span></div><p class="muted">Экспортируются только data.json и meter-readings.json. GitHub-токен, пароль и настройки доступа в файл не попадают.</p><button class="btn ghost full" id="exportBackupBtn">Экспортировать копию</button><label class="btn ghost full" style="display:block;text-align:center;margin-top:8px">Выбрать копию для проверки<input id="importBackupInput" type="file" accept="application/json,.json" hidden></label>${fileInfo}${state.message?`<p class="muted" style="margin-top:10px">${esc(state.message)}</p>`:''}${state.error?`<p style="margin-top:10px;color:#b42318;font-weight:600">${esc(state.error)}</p>`:''}`;
    host.appendChild(card); card.querySelector('#exportBackupBtn').addEventListener('click',exportBackup); card.querySelector('#importBackupInput').addEventListener('change',chooseFile); card.querySelector('#restoreBackupBtn')?.addEventListener('click',restore);
  }
  const observer=new MutationObserver(render); observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
  window.DenselBackup={exportBackup,validateBackup}; render();
})();
