(() => {
  const nativeFetch = window.fetch.bind(window);
  const state = { online: navigator.onLine, lastOk: null, lastError: '', conflict: '' };
  const watched = /\/repos\/[^/]+\/[^/]+\/contents\/(?:data|meter-readings)\.json(?:[?#]|$)/;

  function isAdmin() { return document.querySelector('#adminScreen.active'); }
  function esc(value) { const n = document.createElement('span'); n.textContent = value; return n.innerHTML; }
  function fmt(date) { return date ? date.toLocaleString('ru-RU') : 'ещё не выполнялась'; }
  function isWatched(url) { return watched.test(String(url || '')); }
  function statusText() {
    if (!state.online) return 'Нет сети';
    if (state.conflict) return 'Конфликт данных';
    if (state.lastError) return 'Ошибка синхронизации';
    return state.lastOk ? 'Синхронизировано' : 'Ожидается синхронизация';
  }
  function badgeClass() { return !state.online || state.conflict || state.lastError ? 'pending' : state.lastOk ? 'paid' : 'pending'; }

  function render() {
    if (!isAdmin()) return;
    const host = document.getElementById('tab-overview'); if (!host) return;
    document.getElementById('syncStatusCard')?.remove();
    const detail = state.conflict
      ? 'Файл был изменён в GitHub другим устройством или вкладкой. Текущая запись не выполнена: обновите страницу и повторите действие.'
      : state.lastError
        ? state.lastError
        : state.online
          ? `Последняя успешная синхронизация: ${fmt(state.lastOk)}.`
          : 'Проверьте подключение к интернету. Локальные данные могут быть неактуальны.';
    const card = document.createElement('section'); card.id = 'syncStatusCard'; card.className = 'panel glass fade-up';
    card.innerHTML = `<div class="panel-head"><h3>Синхронизация</h3><span class="badge ${badgeClass()}">${statusText()}</span></div><p class="muted">${esc(detail)}</p>${state.conflict ? '<button class="btn primary full" id="reloadAfterConflictBtn">Обновить страницу</button>' : ''}`;
    host.appendChild(card);
    card.querySelector('#reloadAfterConflictBtn')?.addEventListener('click', () => location.reload());
  }

  window.fetch = async (input, init = {}) => {
    const url = input instanceof Request ? input.url : input;
    const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const watch = isWatched(url);
    try {
      const response = await nativeFetch(input, init);
      if (watch) {
        if (method === 'PUT' && response.status === 409) {
          state.conflict = 'Конфликт версий GitHub'; state.lastError = '';
        } else if (response.ok) {
          state.lastOk = new Date(); state.lastError = ''; if (method === 'PUT') state.conflict = '';
        } else if (method === 'PUT') {
          state.lastError = `GitHub вернул HTTP ${response.status}. Данные не считаются сохранёнными.`;
        }
        render();
      }
      return response;
    } catch (e) {
      if (watch) { state.lastError = `Нет связи с GitHub: ${e.message}`; render(); }
      throw e;
    }
  };
  window.addEventListener('online', () => { state.online = true; state.lastError = ''; render(); });
  window.addEventListener('offline', () => { state.online = false; render(); });
  const observer = new MutationObserver(render);
  observer.observe(document.documentElement, { subtree:true, childList:true, attributes:true, attributeFilter:['class'] });
  window.DenselSyncStatus = { state, render };
  render();
})();
