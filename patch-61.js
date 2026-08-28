(() => {
  function paymentData() {
    try { return JSON.parse(localStorage.getItem('densel_data_cache') || '{}'); }
    catch (_) { return {}; }
  }

  function money(value) {
    return (Number(value || 0)).toLocaleString('ru-RU') + ' ₽';
  }

  function openDetail(row) {
    const overlay = document.getElementById('modalOverlay');
    const box = document.getElementById('modalBox');
    if (!overlay || !box) return;

    const provider = row.querySelector('h4')?.textContent?.trim() || 'Платёж';
    const period = row.querySelector('.period')?.textContent?.trim() || '';
    const badge = row.querySelector('.badge')?.textContent?.trim() || '';
    const amounts = row.querySelector('.payment-amounts')?.innerHTML || '';
    const progress = row.querySelector('.progress-bar')?.outerHTML || '';
    const logo = row.querySelector('.payment-logo')?.outerHTML || '';
    const data = paymentData();
    const selected = (data.payments || []).find(p => p.id === row.dataset.id);
    const history = selected
      ? (data.payments || []).filter(p => p.providerId === selected.providerId && p.period < selected.period).sort((a,b) => b.period.localeCompare(a.period))
      : [];
    const historyHtml = history.length
      ? history.map(p => `<div class="payment-row" style="padding:10px;margin-top:8px;"><div class="payment-info"><div class="top-line"><h4>${p.period}</h4><b>${money(p.amountDue)}</b></div><div class="payment-amounts"><span>Оплачено: <b>${money(p.amountPaid)}</b></span>${p.paidDate ? `<span>Дата: <b>${p.paidDate}</b></span>` : ''}</div></div></div>`).join('')
      : '<p class="muted small">Предыдущих платежей по этой услуге пока нет.</p>';

    box.innerHTML = `<h3>${provider}</h3><div class="payment-row" style="margin-bottom:14px;">${logo}<div class="payment-info"><div class="top-line"><h4>${provider}</h4><span class="badge">${badge}</span></div><div class="period">${period}</div><div class="payment-amounts">${amounts}</div>${progress}</div></div><h4 style="margin:20px 0 6px;">Предыдущие периоды</h4>${historyHtml}<div class="modal-actions"><button type="button" class="btn ghost full" id="detail61Close">Закрыть</button></div>`;
    overlay.classList.add('active');
    document.getElementById('detail61Close')?.addEventListener('click', () => overlay.classList.remove('active'));
  }

  document.addEventListener('click', (event) => {
    const client = document.querySelector('#clientScreen.active');
    if (!client || event.target.closest('button, select, input, a')) return;
    const row = event.target.closest('.payment-row');
    if (row && client.contains(row)) openDetail(row);
  });
})();
