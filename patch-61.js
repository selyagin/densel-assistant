(() => {
  function paymentData() {
    try { return JSON.parse(localStorage.getItem('densel_data_cache') || '{}'); }
    catch (_) { return {}; }
  }
  function money(value) { return (Number(value || 0)).toLocaleString('ru-RU') + ' ₽'; }
  function nextPeriod(period) {
    const [year, month] = period.split('-').map(Number);
    const d = new Date(year, month, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  function periodText(period) {
    const names = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
    const [y,m] = period.split('-');
    return `${names[Number(m)-1]} ${y}`;
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
    const sameProvider = selected ? (data.payments || []).filter(p => p.providerId === selected.providerId) : [];
    const history = sameProvider.filter(p => p.period < selected.period).sort((a,b) => b.period.localeCompare(a.period));
    const sourceForForecast = sameProvider.filter(p => Number(p.amountDue) > 0);
    const average = sourceForForecast.length ? sourceForForecast.reduce((sum,p) => sum + Number(p.amountDue), 0) / sourceForForecast.length : 0;
    const forecastPeriod = selected ? nextPeriod(selected.period) : '';
    const historyHtml = history.length
      ? history.map(p => `<div class="payment-row" style="padding:10px;margin-top:8px;"><div class="payment-info"><div class="top-line"><h4>${p.period}</h4><b>${money(p.amountDue)}</b></div><div class="payment-amounts"><span>Оплачено: <b>${money(p.amountPaid)}</b></span>${p.paidDate ? `<span>Дата: <b>${p.paidDate}</b></span>` : ''}</div></div></div>`).join('')
      : '<p class="muted small">Предыдущих платежей по этой услуге пока нет.</p>';
    const forecastHtml = average ? `<div class="summary-card" style="margin-top:8px;"><div class="label">Ожидаемый следующий платёж · ${periodText(forecastPeriod)}</div><div class="value amber">≈ ${money(Math.round(average * 100) / 100)}</div><div class="sub">Прогноз по ${sourceForForecast.length} предыдущим платежам. Это справочная оценка, не начисление.</div></div>` : '<p class="muted small">Недостаточно данных для прогноза.</p>';
    box.innerHTML = `<h3>${provider}</h3><div class="payment-row" style="margin-bottom:14px;">${logo}<div class="payment-info"><div class="top-line"><h4>${provider}</h4><span class="badge">${badge}</span></div><div class="period">${period}</div><div class="payment-amounts">${amounts}</div>${progress}</div></div><h4 style="margin:20px 0 6px;">Ожидаемый следующий платёж</h4>${forecastHtml}<h4 style="margin:20px 0 6px;">Предыдущие периоды</h4>${historyHtml}<div class="modal-actions"><button type="button" class="btn ghost full" id="detail61Close">Закрыть</button></div>`;
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
