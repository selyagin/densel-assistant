(() => {
  const rules = () => window.DenselPaymentRules;
  const data = () => { try { return JSON.parse(localStorage.getItem('densel_data_cache') || '{}'); } catch (_) { return {}; } };
  const money = n => Number(n || 0).toLocaleString('ru-RU',{maximumFractionDigits:2}) + ' ₽';
  const esc = v => { const e=document.createElement('span'); e.textContent=String(v ?? ''); return e.innerHTML; };
  const labels={due:'К оплате',partial:'Оплачено частично',overdue:'Просрочено'};
  function unpaid() { const r=rules(); return (data().payments||[]).filter(p=>['due','partial','overdue'].includes(r.status(p))); }
  function openUnpaid() {
    document.getElementById('unpaidOverlay')?.remove(); const list=unpaid(), r=rules();
    const overlay=document.createElement('div'); overlay.id='unpaidOverlay'; overlay.style.cssText='position:fixed;inset:0;z-index:10001;background:rgba(10,15,30,.72);display:flex;align-items:flex-end;justify-content:center;padding:12px;box-sizing:border-box';
    const providers=Object.fromEntries((data().providers||[]).map(p=>[p.id,p]));
    const rows=list.map(raw=>{const p=r.normalized(raw),st=r.status(raw),pr=providers[raw.providerId]||{};return `<article style="padding:12px 0;border-bottom:1px solid rgba(128,128,128,.16)"><div style="display:flex;justify-content:space-between;gap:10px"><strong>${esc(pr.name||'Услуга')}</strong><span class="badge ${st==='overdue'?'pending':'paid'}">${labels[st]}</span></div><div class="muted">Остаток: ${money(r.balance(raw))} · Срок: ${esc(p.dueDate||'—')}</div></article>`;}).join('') || '<p class="muted">На данный момент неоплаченных начислений нет.</p>';
    overlay.innerHTML=`<section style="width:min(680px,100%);max-height:80vh;overflow:auto;background:#10182b;color:#f5f7ff;border-radius:20px;padding:18px;box-sizing:border-box"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><div><h3 style="margin:0">К оплате</h3><div class="muted">Непогашенные начисления</div></div><button type="button" id="unpaidClose" class="btn ghost">Закрыть</button></div><div id="unpaidRows" style="margin-top:12px">${rows}</div></section>`;
    overlay.querySelector('#unpaidClose').onclick=()=>overlay.remove(); overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();}); document.body.appendChild(overlay);
  }
  function refreshCard() {
    const card=document.querySelector('#clientSummary [data-summary-action="due-this-month"]'); if(!card) return;
    const r=rules(), list=unpaid(), total=list.reduce((s,p)=>s+r.balance(p),0), hasOverdue=list.some(p=>r.status(p)==='overdue');
    const value=card.querySelector('.value'), sub=card.querySelector('.sub'); if(value) value.textContent=money(total);
    if(sub) sub.textContent=total===0?'Всё оплачено':hasOverdue?'Есть просроченные начисления':`${list.length} к оплате`;
    card.style.borderColor=hasOverdue?'#f16d64':total>0?'#22d3ee':'rgba(128,128,128,.35)'; card.style.cursor='pointer'; card.setAttribute('aria-label',total===0?'К оплате: всё оплачено':'Открыть неоплаченные начисления');
  }
  document.addEventListener('click',e=>{if(!e.target.closest?.('#clientSummary [data-summary-action="due-this-month"]'))return;e.preventDefault();e.stopImmediatePropagation();openUnpaid();},true);
  [100,500,1200,2500].forEach(ms=>setTimeout(refreshCard,ms));
  window.DenselDueCard={refreshCard,openUnpaid};
})();
