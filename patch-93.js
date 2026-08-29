(() => {
  const esc = value => { const n=document.createElement('span'); n.textContent=String(value ?? ''); return n.innerHTML; };
  const currentPeriod = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; };
  const defaultDue = period => `${period}-25`;
  const lastAmount = providerId => { const list=(DATA?.payments||[]).filter(p=>p.providerId===providerId).sort((a,b)=>String(b.period).localeCompare(String(a.period))); return list.length ? Number(list[0].amountDue||0) : ''; };
  function openIndividualBulkModal() {
    if (!Array.isArray(DATA?.providers) || !DATA.providers.length) { toast('Сначала добавьте поставщика.'); return; }
    const initial=currentPeriod(), due=defaultDue(initial);
    const rows=DATA.providers.map(pr=>`<div class="account-row" style="display:grid;grid-template-columns:26px 1fr;gap:9px;align-items:center"><input type="checkbox" class="ib-check" data-id="${esc(pr.id)}" checked style="width:18px;height:18px"><div><strong>${esc(pr.name)}</strong><div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:7px"><input type="number" step="0.01" min="0" class="ib-amount" data-id="${esc(pr.id)}" value="${esc(lastAmount(pr.id))}" placeholder="Сумма" style="width:110px"><input type="date" class="ib-due" data-id="${esc(pr.id)}" value="${due}" style="flex:1;min-width:145px"></div></div></div>`).join('');
    openModal(`<h3>Добавить платежи на месяц</h3><form id="individualBulkForm" class="settings-form"><label class="field"><span>Период начисления</span><input id="ib-period" type="month" value="${initial}" required></label><div class="field"><span>Общий срок — шаблон</span><div style="display:flex;gap:8px"><input id="ib-master-due" type="date" value="${due}" style="flex:1"><button type="button" class="btn ghost small" id="ib-apply-due">Применить всем</button></div><small class="muted">У каждого поставщика ниже можно указать свой срок.</small></div><div class="accounts-list">${rows}</div><p id="ib-hint" class="muted"></p><div class="modal-actions"><button type="button" class="btn ghost full" id="ib-cancel">Отмена</button><button type="submit" class="btn primary full">Создать платежи</button></div></form>`);
    const form=document.getElementById('individualBulkForm'), periodEl=document.getElementById('ib-period'), master=document.getElementById('ib-master-due');
    const applyAll=()=>form.querySelectorAll('.ib-due').forEach(input=>input.value=master.value);
    document.getElementById('ib-cancel').onclick=closeModal; document.getElementById('ib-apply-due').onclick=applyAll;
    periodEl.onchange=()=>{ const next=defaultDue(periodEl.value); master.value=next; applyAll(); };
    form.onsubmit=async event=>{
      event.preventDefault(); const selected=[...form.querySelectorAll('.ib-check:checked')]; if(!selected.length){toast('Выберите хотя бы одного поставщика.'); return;}
      const create=[], duplicates=[];
      for(const check of selected){ const id=check.dataset.id, amountEl=form.querySelector(`.ib-amount[data-id="${CSS.escape(id)}"]`), dueEl=form.querySelector(`.ib-due[data-id="${CSS.escape(id)}"]`); const amount=Number(amountEl.value||0), dueDate=dueEl.value;
        if(!Number.isFinite(amount)||amount<0){toast('Проверьте суммы.'); return;} if(!dueDate){toast('Укажите срок для каждого выбранного платежа.'); return;}
        if(DATA.payments.some(p=>p.providerId===id&&p.period===periodEl.value)){duplicates.push((DATA.providers.find(p=>p.id===id)||{}).name||id); continue;}
        create.push({id:`p_${Date.now()}_${create.length}`,providerId:id,period:periodEl.value,amountDue:amount,dueDate,amountPaid:0,paidDate:null});
      }
      if(!create.length){toast(`За ${periodEl.value} уже есть платежи: ${duplicates.join(', ')}.`); return;}
      const names=create.map(p=>(DATA.providers.find(x=>x.id===p.providerId)||{}).name||p.providerId).join(', ');
      if(!confirm(`Создать ${create.length} платеж(ей) за ${periodEl.value}?\n${names}`)) return;
      DATA.payments.push(...create); closeModal(); const saved=await saveData(`Densel Assistant: пакетное добавление ${create.length} платеж(ей) за ${periodEl.value}`); if(saved) renderAdminDashboard(); else { DATA.payments=DATA.payments.filter(p=>!create.some(x=>x.id===p.id)); renderAdminDashboard(); }
      if(duplicates.length) toast(`Создано: ${create.length}. Пропущены дубли: ${duplicates.join(', ')}.`,6000);
    };
  }
  document.addEventListener('click',event=>{ const btn=event.target.closest?.('#bulkPaymentsBtn'); if(!btn) return; event.preventDefault(); event.stopImmediatePropagation(); openIndividualBulkModal(); },true);
  window.DenselIndividualBulk={openIndividualBulkModal};
})();
