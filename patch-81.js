(() => {
  const FILES = [
    { path: './data.json', title: 'Платежи', required: [] },
    { path: './meter-readings.json', title: 'Показания счётчиков', required: ['current'] }
  ];
  const state = { results: [], checkedAt: null };

  function isAdmin() { return document.querySelector('#adminScreen.active'); }
  function text(value) { const node = document.createElement('span'); node.textContent = value; return node.innerHTML; }
  function periodOk(value) { return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value); }
  function dateOk(value) { return value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)); }

  function validate(file, data) {
    const errors = [];
    if (!data || Array.isArray(data) || typeof data !== 'object') return ['Корневой элемент должен быть JSON-объектом.'];
    file.required.forEach(key => { if (!(key in data)) errors.push(`Нет обязательного поля «${key}».`); });
    if (file.path.includes('meter-readings')) {
      const current = data.current;
      if (current && (typeof current !== 'object' || Array.isArray(current))) errors.push('Поле «current» должно быть объектом.');
      if (current?.period && !periodOk(current.period)) errors.push('Поле «current.period» должно иметь вид ГГГГ-ММ.');
      if (current?.status && !['submitted','not_submitted'].includes(current.status)) errors.push('Недопустимое значение «current.status».');
      if (current && 'submittedAt' in current && !dateOk(current.submittedAt)) errors.push('Поле «current.submittedAt» должно иметь вид ГГГГ-ММ-ДД или быть пустым.');
      if (data.schemaVersion !== undefined && (!Number.isInteger(data.schemaVersion) || data.schemaVersion < 1)) errors.push('«schemaVersion» должна быть целым числом не меньше 1.');
    }
    return errors;
  }

  async function check() {
    state.results = await Promise.all(FILES.map(async file => {
      try {
        const response = await fetch(`${file.path}?_diagnostic=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) return { ...file, ok: false, errors: [`HTTP ${response.status}: файл недоступен.`] };
        const data = await response.json(), errors = validate(file, data);
        return { ...file, ok: errors.length === 0, errors, schemaVersion: data.schemaVersion || 'не задана' };
      } catch (e) { return { ...file, ok: false, errors: [`Не удалось прочитать JSON: ${e.message}`] }; }
    }));
    state.checkedAt = new Date(); render(); return state.results;
  }

  function render() {
    if (!isAdmin()) return;
    const host = document.getElementById('tab-overview'); if (!host) return;
    document.getElementById('dataIntegrityCard')?.remove();
    const card = document.createElement('section'); card.id = 'dataIntegrityCard'; card.className = 'panel glass fade-up';
    const rows = state.results.length ? state.results.map(r => `<div style="padding:10px 0;border-bottom:1px solid rgba(128,128,128,.16)"><strong>${text(r.title)}</strong><div class="muted">${r.ok ? `✓ Проверено · версия: ${text(String(r.schemaVersion))}` : `⚠ ${r.errors.map(text).join(' ')}`}</div></div>`).join('') : '<p class="muted">Проверка ещё не выполнялась.</p>';
    card.innerHTML = `<div class="panel-head"><h3>Целостность данных</h3><span class="badge ${state.results.length && state.results.every(r => r.ok) ? 'paid' : 'pending'}">${state.results.length && state.results.every(r => r.ok) ? 'В норме' : 'Нужна проверка'}</span></div>${rows}<p class="muted" style="margin-top:10px">${state.checkedAt ? `Последняя проверка: ${state.checkedAt.toLocaleString('ru-RU')}` : 'Данные не изменяются этой проверкой.'}</p><button class="btn ghost full" id="checkDataIntegrityBtn">Проверить данные</button>`;
    host.appendChild(card);
    card.querySelector('#checkDataIntegrityBtn').addEventListener('click', check);
  }

  const observer = new MutationObserver(() => render());
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  window.DenselDataIntegrity = { check, validate };
  check();
})();
