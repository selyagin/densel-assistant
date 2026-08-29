(() => {
  function removeDummyPool() {
    document.querySelectorAll('button').forEach(btn => {
      if (/^\s*\+?\s*пул на месяц\s*$/i.test(btn.textContent || '')) btn.remove();
    });
  }
  function restoreBulkButton() {
    try { if (!document.getElementById('bulkPaymentsBtn') && typeof ensureBulkPaymentsButton === 'function') ensureBulkPaymentsButton(); } catch (_) {}
  }
  function refreshButtons() { removeDummyPool(); restoreBulkButton(); }
  function isPaidSummary(target) {
    const card = target.closest?.('#clientSummary .summary-card');
    if (!card) return false;
    return /оплач/i.test(card.querySelector('.label')?.textContent || '');
  }
  document.addEventListener('click', event => {
    if (!isPaidSummary(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try { window.DenselPaymentsTools?.openHistory?.(); } catch (e) { console.error('Не удалось открыть историю оплат', e); }
  }, true);
  [0, 150, 600, 1400, 2800].forEach(ms => setTimeout(refreshButtons, ms));
  document.addEventListener('click', () => setTimeout(refreshButtons, 120), true);
  document.addEventListener('change', () => setTimeout(refreshButtons, 120), true);
  window.DenselPaymentsHotfix = { refreshButtons };
})();
