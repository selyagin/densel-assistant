(() => {
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
    box.innerHTML = `
      <h3>${provider}</h3>
      <div class="payment-row" style="margin-bottom:14px;">
        ${logo}
        <div class="payment-info">
          <div class="top-line"><h4>${provider}</h4><span class="badge">${badge}</span></div>
          <div class="period">${period}</div>
          <div class="payment-amounts">${amounts}</div>
          ${progress}
        </div>
      </div>
      <p class="muted small">История платежей и прогноз появятся на следующем шаге.</p>
      <div class="modal-actions"><button type="button" class="btn ghost full" id="detail61Close">Закрыть</button></div>`;
    overlay.classList.add('active');
    document.getElementById('detail61Close')?.addEventListener('click', () => overlay.classList.remove('active'));
  }

  document.addEventListener('click', (event) => {
    const client = document.querySelector('#clientScreen.active');
    if (!client) return;
    if (event.target.closest('button, select, input, a')) return;
    const row = event.target.closest('.payment-row');
    if (row && client.contains(row)) openDetail(row);
  });
})();
