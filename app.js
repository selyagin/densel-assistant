/* ===================== Densel Assistant — core app logic ===================== */
/* Полностью статичное клиентское приложение. У админа чтение идёт через api.github.com (без CDN,
   всегда актуально), у клиента (сестры) — через публичный data.json на
   GitHub Pages (может отставать на несколько минут). Запись — только для
   админа, через GitHub Contents API с личным токеном в localStorage. */

const BUILD_ID = '2026-08-28.10-bulk-53';

const LS_DATA = 'densel_data_cache';
const LS_SESSION = 'densel_session';
const LS_GH_SETTINGS = 'densel_gh_settings';
const LS_GH_TOKEN = 'densel_gh_token';

let DATA = null;
let SESSION = null;
let CURRENT_TAB = 'overview';
const ERROR_LOG = [];

function logError(where, e){
  ERROR_LOG.push({ where, message: (e && e.message) || String(e), stack: (e && e.stack) || '', time: new Date().toISOString() });
  if(ERROR_LOG.length > 20) ERROR_LOG.shift();
}

function $(sel, root=document){ return root.querySelector(sel); }
function $all(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }
function on(sel, event, handler){
  const el = $(sel);
  if(el){ el.addEventListener(event, handler); }
  else { logError('on()', new Error('элемент не найден: ' + sel)); }
}

function toast(msg, ms=3200){
  const el = $('#toast');
  if(!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(()=>el.classList.remove('show'), ms);
}

async function sha256Hex(str){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function randomSalt(){
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function utf8ToBase64(str){
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary);
}
function base64ToUtf8(b64){
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function fmtMoney(n){
  return (Math.round((n||0)*100)/100).toLocaleString('ru-RU', {maximumFractionDigits:2}) + ' ₽';
}
function fmtDate(d){
  if(!d) return '—';
  const dt = new Date(d);
  if(isNaN(dt)) return d;
  return dt.toLocaleDateString('ru-RU', {day:'2-digit', month:'2-digit', year:'numeric'});
}
function currentPeriod(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function periodLabel(p){
  const [y,m] = p.split('-');
  const names = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  return `${names[parseInt(m,10)-1]} ${y}`;
}
function addMonths(period, n){
  const [y,m] = period.split('-').map(Number);
  const d = new Date(y, m-1+n, 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function last12Periods(n){
  const out = [];
  const cur = currentPeriod();
  for(let i=n-1;i>=0;i--) out.push(addMonths(cur, -i));
  return out;
}

async function fetchDataViaApi(){
  const {owner, repo, branch} = getGhSettings();
  const token = getGhToken();
  if(!owner || !repo || !token) return null;
  try{
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/data.json?ref=${branch||'main'}&_=${Date.now()}`, {
      cache: 'no-store',
      headers: {Authorization:`Bearer ${token}`, Accept:'application/vnd.github+json'}
    });
    if(!res.ok) return null;
    const json = await res.json();
    const decoded = base64ToUtf8((json.content||'').replace(/\n/g,''));
    return JSON.parse(decoded);
  }catch(e){
    logError('fetchDataViaApi', e);
    return null;
  }
}

async function loadData(showToastOnFallback, preferApi){
  if(preferApi){
    const apiData = await fetchDataViaApi();
    if(apiData){
      DATA = apiData;
      localStorage.setItem(LS_DATA, JSON.stringify(DATA));
      return true;
    }
  }
  try{
    const res = await fetch('./data.json?v=' + Date.now(), {cache:'no-store'});
    if(!res.ok) throw new Error('fetch failed: HTTP ' + res.status);
    DATA = await res.json();
    localStorage.setItem(LS_DATA, JSON.stringify(DATA));
    return true;
  }catch(e){
    const cached = localStorage.getItem(LS_DATA);
    if(cached){
      DATA = JSON.parse(cached);
      if(showToastOnFallback) toast('Не удалось загрузить свежие данные — показан сохранённый кэш');
      return false;
    }else{
      throw e;
    }
  }
}

function getGhSettings(){
  try{ return JSON.parse(localStorage.getItem(LS_GH_SETTINGS) || '{}'); }catch(e){ return {}; }
}
function getGhToken(){ return localStorage.getItem(LS_GH_TOKEN) || ''; }

async function saveData(commitMessage){
  localStorage.setItem(LS_DATA, JSON.stringify(DATA));
  const {owner, repo, branch} = getGhSettings();
  const token = getGhToken();
  if(!owner || !repo || !token){
    toast('Данные сохранены только локально. заполните GitHub в разделе "Настройки", чтобы синхронизировать с сестрой.');
    return false;
  }
  const branchName = branch || 'main';
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/data.json`;
  const syncEl = $('#syncStatus');

  async function fetchCurrentSha(){
    const getRes = await fetch(`${api}?ref=${branchName}&_=${Date.now()}`, {
      cache: 'no-store',
      headers: {Authorization:`Bearer ${token}`, Accept:'application/vnd.github+json'}
    });
    if(getRes.status === 401) throw new Error('токен неверен или просрочен (401).');
    if(getRes.status === 404) throw new Error('репозиторий/файл не найден (404).');
    if(!getRes.ok) throw new Error(`не удалось прочитать текущую версию файла (HTTP ${getRes.status})`);
    const json = await getRes.json();
    return json.sha;
  }

  async function attemptPut(sha){
    const body = {
      message: commitMessage || 'Densel Assistant: обновление данных',
      content: utf8ToBase64(JSON.stringify(DATA, null, 2)),
      branch: branchName
    };
    if(sha) body.sha = sha;
    return fetch(api, {
      method:'PUT',
      cache: 'no-store',
      headers:{Authorization:`Bearer ${token}`, Accept:'application/vnd.github+json', 'Content-Type':'application/json'},
      body: JSON.stringify(body)
    });
  }

  try{
    if(syncEl) syncEl.textContent = 'сохранение…';
    let sha = await fetchCurrentSha();
    let putRes = await attemptPut(sha);
    if(putRes.status === 409){
      sha = await fetchCurrentSha();
      putRes = await attemptPut(sha);
    }
    if(!putRes.ok){
      const err = await putRes.json().catch(()=>({}));
      if(putRes.status === 401) throw new Error('токен неверен или просрочен (401)');
      if(putRes.status === 403) throw new Error('нет прав на запись (403)');
      if(putRes.status === 404) throw new Error('репозиторий или файл не найден (404)');
      if(putRes.status === 409) throw new Error('конфликт версии файла — попробуйте сохранить ещё раз.');
      if(putRes.status === 422) throw new Error('конфликт версии файла (422)');
      throw new Error(err.message || `HTTP ${putRes.status}`);
    }
    if(syncEl) syncEl.textContent = `сохранено ${new Date().toLocaleTimeString('ru-RU')}`;
    toast('Изменения сохранены в GitHub ✓');
    return true;
  }catch(e){
    if(syncEl) syncEl.textContent = 'ошибка синхронизации';
    toast('Ошибка сохранения в GitHub: ' + e.message, 5000);
    logError('saveData', e);
    return false;
  }
}

async function checkGithubToken(){
  const {owner, repo, branch} = getGhSettings();
  const token = getGhToken();
  const resultEl = $('#tokenCheckResult');
  if(!resultEl) return;
  if(!owner || !repo || !token){
    resultEl.textContent = 'Заполните владельца, репозиторий и токен, затем сохраните настройки.';
    resultEl.className = 'hint-text error-text';
    return;
  }
  resultEl.textContent = 'Проверяю…';
  resultEl.className = 'hint-text';
  try{
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {Authorization:`Bearer ${token}`, Accept:'application/vnd.github+json'}
    });
    if(repoRes.status === 401){ resultEl.textContent = '❌ токен неверен или просрочен.'; resultEl.className='hint-text error-text'; return; }
    if(repoRes.status === 404){ resultEl.textContent = '❌ репозиторий не найден или у токена нет доступа.'; resultEl.className='hint-text error-text'; return; }
    if(!repoRes.ok){ resultEl.textContent = `❌ Ошибка GitHub API: HTTP ${repoRes.status}`; resultEl.className='hint-text error-text'; return; }
    const repoInfo = await repoRes.json();
    const perms = repoInfo.permissions || {};
    const fileRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/data.json?ref=${branch||'main'}`, {
      headers: {Authorization:`Bearer ${token}`, Accept:'application/vnd.github+json'}
    });
    if(!perms.push){ resultEl.textContent = '⚠️ токен подключен, но нет права записи (push).'; resultEl.className='hint-text error-text'; return; }
    if(!fileRes.ok){ resultEl.textContent = `⚠️ доступ есть, но файл data.json не найден по ветке "${branch||'main'}".`; resultEl.className='hint-text error-text'; return; }
    resultEl.textContent = `✅ токен работает, есть доступ на запись к ${owner}/${repo} (${branch||'main'}).`;
    resultEl.className = 'hint-text';
  }catch(e){
    resultEl.textContent = '❌ Не удалось связаться с GitHub API: ' + e.message;
    resultEl.className = 'hint-text error-text';
    logError('checkGithubToken', e);
  }
}

async function forceSync(){
  toast('Обновляем данные…', 1500);
  try{
    const preferApi = !!(SESSION && SESSION.role === 'admin');
    const fresh = await loadData(false, preferApi);
    if(SESSION){
      if(SESSION.role === 'admin') renderAdminDashboard();
      else renderClientDashboard();
    }
    toast(fresh ? 'Данные обновлены ✓' : 'Показаны сохраненные ранее данные (нет соединения)');
  }catch(e){
    toast('Не удалось обновить данные: ' + e.message, 4000);
    logError('forceSync', e);
  }
}

function getPaymentStatus(p){
  const today = new Date(); today.setHours(0,0,0,0);
  const due = p.dueDate ? new Date(p.dueDate) : null;
  const paid = p.amountPaid || 0;
  if(paid >= p.amountDue){
    return p.period > currentPeriod() ? 'advance' : 'paid';
  }
  if(due && due < today) return 'overdue';
  if(paid > 0) return 'partial';
  return 'pending';
}
const STATUS_LABEL = {
  paid:'Оплачено', pending:'Ожидает оплаты', overdue:'Просрочено',
  partial:'Оплачено частично', advance:'Оплачено заранее'
};

function monthsBetweenPeriods(a, b){
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

function computeAdvanceStreaks(){
  const streaks = {};
  const cur = currentPeriod();
  DATA.providers.forEach(pr=>{
    let maxAhead = 0;
    DATA.payments.forEach(p=>{
      if(p.providerId === pr.id && p.period > cur && (p.amountPaid||0) >= p.amountDue){
        const ahead = monthsBetweenPeriods(cur, p.period);
        if(ahead > maxAhead) maxAhead = ahead;
      }
    });
    if(maxAhead > 0) streaks[pr.id] = maxAhead;
  });
  return streaks;
}

function providerById(id){ return DATA.providers.find(p=>p.id===id); }

function paymentRowHtml(p, editable){
  const provider = providerById(p.providerId) || {name:'Неизвестно', color:'#888', logo:'?'};
  const status = getPaymentStatus(p);
  const pct = Math.min(100, Math.round(((p.amountPaid||0)/p.amountDue)*100));
  const logoHtml = provider.logoUrl ? `<img src="${provider.logoUrl}" alt="${provider.name}">` : (provider.logo || provider.name[0]);
  const actions = editable ? `
    <div class="row-actions">
      <button class="icon-btn" data-action="edit" data-id="${p.id}" title="Редактировать">✏️</button>
      <button class="icon-btn" data-action="delete" data-id="${p.id}" title="Удалить">🗑️</button>
    </div>` : '';
  return `
    <div class="payment-row" data-id="${p.id}">
      <div class="payment-logo" style="background:${provider.color || '#334'}">${logoHtml}</div>
      <div class="payment-info">
        <div class="top-line">
          <h4>${provider.name}</h4>
          <span class="badge ${status}">${STATUS_LABEL[status]}</span>
        </div>
        <div class="period">${periodLabel(p.period)} · срок оплаты: ${fmtDate(p.dueDate)}</div>
        <div class="payment-amounts">
          <span>К оплате: <b>${fmtMoney(p.amountDue)}</b></span>
          <span>Оплачено: <b>${fmtMoney(p.amountPaid||0)}</b></span>
          ${p.paidDate ? `<span>Дата оплаты: <b>${fmtDate(p.paidDate)}</b></span>` : ''}
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>
      ${actions}
    </div>`;
}

function buildSummary(paymentsScope){
  const cur = currentPeriod();
  const curPayments = paymentsScope.filter(p=>p.period===cur);
  const toPay = curPayments.reduce((s,p)=>s + Math.max(0, p.amountDue-(p.amountPaid||0)), 0);
  const dueCount = curPayments.filter(p=>{ const st=getPaymentStatus(p); return st!=='paid' && st!=='advance'; }).length;
  const paidThisMonth = curPayments.reduce((s,p)=>s + (p.amountPaid||0), 0);
  const overdue = paymentsScope.filter(p=>getPaymentStatus(p)==='overdue');
  const overdueSum = overdue.reduce((s,p)=>s + Math.max(0, p.amountDue-(p.amountPaid||0)), 0);
  const advanceCount = paymentsScope.filter(p=>getPaymentStatus(p)==='advance').length;

  return `
    <button type="button" class="summary-card summary-btn" data-summary-action="due-this-month">
      <div class="label">К оплате (${periodLabel(cur)})</div>
      <div class="value amber">${fmtMoney(toPay)}</div>
      ${dueCount>0 ? `<div class="sub">${dueCount} платеж${dueCount===1?'':(dueCount<5?'а':'ей')} · подробности →</div>` : ''}
    </button>
    <div class="summary-card"><div class="label">Оплачено в этом месяце</div><div class="value green">${fmtMoney(paidThisMonth)}</div></div>
    <div class="summary-card"><div class="label">Просрочено</div><div class="value ${overdue.length?'red':''}">${overdue.length} · ${fmtMoney(overdueSum)}</div></div>
    <button type="button" class="summary-card summary-btn" data-summary-action="advance" ${advanceCount===0?'disabled':''}>
      <div class="label">Оплата заранее</div>
      <div class="value">${advanceCount>0 ? 'смотреть список' : '—'}</div>
      ${advanceCount>0 ? `<div class="sub">${advanceCount} платеж${advanceCount===1?'':(advanceCount<5?'а':'ей')} →</div>` : ''}
    </button>
  `;
}

function wireSummaryButtons(containerEl, paymentsScope){
  const dueBtn = containerEl.querySelector('[data-summary-action="due-this-month"]');
  if(dueBtn){
    dueBtn.onclick = ()=>{
      const cur = currentPeriod();
      const list = paymentsScope.filter(p=>{
        const st = getPaymentStatus(p);
        return p.period===cur && st!=='paid' && st!=='advance';
      }).sort((a,b)=> new Date(a.dueDate) - new Date(b.dueDate));
      showPaymentsListModal(`Нужно оплатить — ${periodLabel(cur)}`, list);
    };
  }
  const advBtn = containerEl.querySelector('[data-summary-action="advance"]');
  if(advBtn){
    advBtn.onclick = ()=>{
      const list = paymentsScope.filter(p=>getPaymentStatus(p)==='advance').sort((a,b)=> a.period.localeCompare(b.period));
      showPaymentsListModal('Оплачено заранее', list);
    };
  }
}

function showPaymentsListModal(title, list){
  openModal(`
    <h3>${title}</h3>
    <div class="payments-list">
      ${list.length ? list.map(p=>paymentRowHtml(p,false)).join('') : '<p class="muted">Список пуст</p>'}
    </div>
    <div class="modal-actions"><button type="button" class="btn ghost full" id="summaryModalClose">Закрыть</button></div>
  `);
  on('#summaryModalClose', 'click', closeModal);
}

function renderTrendChart(svgEl, periods){
  const W=320,H=160,pad={l:8,r:8,t:14,b:20};
  const totals = periods.map(per=>{
    const items = DATA.payments.filter(p=>p.period===per);
    return { due: items.reduce((s,p)=>s+p.amountDue,0), paid: items.reduce((s,p)=>s+(p.amountPaid||0),0) };
  });
  const max = Math.max(1, ...totals.map(t=>t.due), ...totals.map(t=>t.paid));
  const stepX = (W-pad.l-pad.r) / Math.max(1, periods.length-1);
  const scaleY = v => H-pad.b - (v/max)*(H-pad.t-pad.b);
  const ptsDue = totals.map((t,i)=>`${pad.l+i*stepX},${scaleY(t.due)}`).join(' ');
  const ptsPaid = totals.map((t,i)=>`${pad.l+i*stepX},${scaleY(t.paid)}`).join(' ');
  const labels = periods.map((per,i)=> i%Math.ceil(periods.length/6)===0
    ? `<text x="${pad.l+i*stepX}" y="${H-4}" font-size="7" fill="#9aa1c2" text-anchor="middle">${periodLabel(per).split(' ')[0]}</text>` : '').join('');
  svgEl.innerHTML = `
    <polyline points="${ptsDue}" fill="none" stroke="#a78bfa" stroke-width="2" opacity="0.9"/>
    <polyline points="${ptsPaid}" fill="none" stroke="#22d3ee" stroke-width="2.5"/>
    ${totals.map((t,i)=>`<circle cx="${pad.l+i*stepX}" cy="${scaleY(t.paid)}" r="2.4" fill="#22d3ee"/>`).join('')}
    ${labels}
  `;
}

function renderDonutChart(svgEl, legendEl){
  const cur = currentPeriod();
  const yearPrefix = cur.split('-')[0];
  const byProvider = {};
  DATA.payments.filter(p=>p.period.startsWith(yearPrefix)).forEach(p=>{
    byProvider[p.providerId] = (byProvider[p.providerId]||0) + (p.amountPaid||0);
  });
  const entries = Object.entries(byProvider).filter(([,v])=>v>0);
  const total = entries.reduce((s,[,v])=>s+v,0) || 1;
  const R=60,CX=80,CY=80,STROKE=22;
  let offset = 0;
  const circumference = 2*Math.PI*R;
  let arcs = '';
  entries.forEach(([id,val])=>{
    const provider = providerById(id) || {color:'#888', name:id};
    const frac = val/total;
    const len = frac*circumference;
    arcs += `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${provider.color||'#888'}"
      stroke-width="${STROKE}" stroke-dasharray="${len} ${circumference-len}"
      stroke-dashoffset="${-offset}" transform="rotate(-90 ${CX} ${CY})"/>`;
    offset += len;
  });
  svgEl.innerHTML = entries.length ? arcs : `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="#334" stroke-width="${STROKE}"/>`;
  legendEl.innerHTML = entries.map(([id,val])=>{
    const provider = providerById(id) || {name:id, color:'#888'};
    const pct = Math.round(val/total*100);
    return `<div><span class="dot" style="background:${provider.color}"></span>${provider.name} — ${pct}%</div>`;
  }).join('') || '<div>Нет оплат за этот год</div>';
}

function renderClientDashboard(){
  const account = DATA.accounts.find(a=>a.id===SESSION.accountId);
  const greetEl = $('#clientGreeting');
  if(greetEl) greetEl.textContent = `Здравствуйте, ${account.name || account.login}`;

  const payments = DATA.payments.slice().sort((a,b)=> b.period.localeCompare(a.period));
  const clientSummaryEl = $('#clientSummary');
  if(clientSummaryEl){
    clientSummaryEl.innerHTML = buildSummary(payments);
    wireSummaryButtons(clientSummaryEl, payments);
  }

  const periods = Array.from(new Set(payments.map(p=>p.period))).sort().reverse();
  const filterEl = $('#periodFilter');
  if(filterEl){
    filterEl.innerHTML = `<option value="all">Все периоды</option>` + periods.map(p=>`<option value="${p}">${periodLabel(p)}</option>`).join('');
    filterEl.value = periods.includes(currentPeriod()) ? currentPeriod() : 'all';
  }

  function renderList(){
    const val = filterEl ? filterEl.value : 'all';
    const list = val==='all' ? payments : payments.filter(p=>p.period===val);
    const listEl = $('#paymentsList');
    if(listEl) listEl.innerHTML = list.length ? list.map(p=>paymentRowHtml(p,false)).join('') : '<p class="muted">Нет платежей за выбранный период</p>';
  }
  if(filterEl) filterEl.onchange = renderList;
  renderList();

  const rangeSel = $('#statsRange');
  function renderCharts(){
    const periods12 = last12Periods(parseInt(rangeSel ? rangeSel.value : '12',10));
    const trendEl = $('#trendChart'); if(trendEl) renderTrendChart(trendEl, periods12);
    const donutEl = $('#donutChart'); if(donutEl) renderDonutChart(donutEl, $('#donutLegend'));
  }
  if(rangeSel) rangeSel.onchange = renderCharts;
  renderCharts();
}

function renderAdminDashboard(){
  renderAdminOverview();
  renderAdminPayments();
  renderAdminProviders();
  renderAdminAccounts();
  populatePasswordAccountSelect();
  loadSettingsForm();
  ensureBulkPaymentsButton();
}

function renderAdminOverview(){
  const payments = DATA.payments;
  const adminSummaryEl = $('#adminSummary');
  if(adminSummaryEl){
    adminSummaryEl.innerHTML = buildSummary(payments);
    wireSummaryButtons(adminSummaryEl, payments);
  }
  const upcoming = payments
    .filter(p=>getPaymentStatus(p)!=='paid' && getPaymentStatus(p)!=='advance')
    .sort((a,b)=> new Date(a.dueDate) - new Date(b.dueDate))
    .slice(0,6);
  const upcomingEl = $('#upcomingList');
  if(upcomingEl) upcomingEl.innerHTML = upcoming.length ? upcoming.map(p=>paymentRowHtml(p,false)).join('') : '<p class="muted">Нет активных начислений</p>';
}

function renderAdminPayments(){
  const list = DATA.payments.slice().sort((a,b)=> b.period.localeCompare(a.period));
  const el = $('#adminPaymentsList');
  if(!el) return;
  el.innerHTML = list.length ? list.map(p=>paymentRowHtml(p,true)).join('') : '<p class="muted">Платежей пока нет — добавьте первый.</p>';
  $all('.icon-btn[data-action="edit"]', el).forEach(btn=>{
    btn.onclick = ()=> openPaymentModal(DATA.payments.find(p=>p.id===btn.dataset.id));
  });
  $all('.icon-btn[data-action="delete"]', el).forEach(btn=>{
    btn.onclick = async ()=>{
      if(!confirm('Удалить этот платёж?')) return;
      DATA.payments = DATA.payments.filter(p=>p.id!==btn.dataset.id);
      await saveData('Удаление платежа');
      renderAdminDashboard();
    };
  });
}

/* ---------- 5.1/5.2/5.3: bulk payments button + modal with provider checklist + suggested amounts ---------- */
function getLastAmountForProvider(providerId){
  const list = DATA.payments.filter(p=>p.providerId===providerId).sort((a,b)=> b.period.localeCompare(a.period));
  return list.length ? list[0].amountDue : '';
}

function ensureBulkPaymentsButton(){
  if($('#bulkPaymentsBtn')) return;
  const addBtn = $('#addPaymentBtn');
  if(!addBtn || !addBtn.parentNode) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'bulkPaymentsBtn';
  btn.className = 'btn secondary small';
  btn.style.marginLeft = '8px';
  btn.textContent = '+ Добавить платежи на месяц';
  addBtn.parentNode.insertBefore(btn, addBtn.nextSibling);
  btn.addEventListener('click', openBulkPaymentsModal);
}

function openBulkPaymentsModal(){
  const providerRows = DATA.providers.map(pr => {
    const suggested = getLastAmountForProvider(pr.id);
    return `
    <label class="account-row" style="cursor:pointer;flex-wrap:wrap;">
      <input type="checkbox" class="bulk-provider-check" data-provider-id="${pr.id}" checked style="width:18px;height:18px;flex:0 0 auto;">
      <div class="payment-logo" style="background:${pr.color}">${pr.logoUrl ? `<img src="${pr.logoUrl}">` : (pr.logo||pr.name[0])}</div>
      <div class="payment-info"><h4>${pr.name}</h4>${suggested!=='' ? `<span class="muted">последняя сумма: ${fmtMoney(suggested)}</span>` : `<span class="muted">сумма не найдена — введите вручную</span>`}</div>
      <input type="number" step="0.01" class="bulk-amount-input" data-provider-id="${pr.id}" value="${suggested}" placeholder="Сумма" style="width:100px;flex:0 0 auto;" onclick="event.stopPropagation()">
    </label>
  `;
  }).join('');
  openModal(`
    <h3>Добавить платежи на месяц</h3>
    <form id="bulkPaymentsForm" class="settings-form">
      <label class="field"><span>Период</span><input type="month" id="bulk_period" value="${currentPeriod()}" required></label>
      <label class="field"><span>Поставщики и суммы</span></label>
      <div class="accounts-list">
        ${providerRows || '<p class="muted">Сначала добавьте хотя бы одного поставщика на вкладке «Поставщики»</p>'}
      </div>
      <p class="muted small">Сумма подставлена по последнему платежу этого поставщика — можно изменить вручную. Сроки оплаты появятся на следующем шаге.</p>
      <div class="modal-actions">
        <button type="button" class="btn ghost full" id="bulk_cancel">Отмена</button>
      </div>
    </form>
  `);
  on('#bulk_cancel', 'click', closeModal);
}

function renderAdminProviders(){
  const el = $('#providersList');
  if(!el) return;
  el.innerHTML = DATA.providers.map(pr=>`
    <div class="provider-row">
      <div class="payment-logo" style="background:${pr.color}">${pr.logoUrl ? `<img src="${pr.logoUrl}">` : (pr.logo||pr.name[0])}</div>
      <div class="payment-info"><h4>${pr.name}</h4><span class="muted">${pr.logoUrl || 'без логотипа — используется значок'}</span></div>
      <div class="row-actions">
        <button class="icon-btn" data-action="edit" data-id="${pr.id}">✏️</button>
        <button class="icon-btn" data-action="delete" data-id="${pr.id}">🗑️</button>
      </div>
    </div>`).join('');
  $all('.icon-btn[data-action="edit"]', el).forEach(btn=>{
    btn.onclick = ()=> openProviderModal(DATA.providers.find(p=>p.id===btn.dataset.id));
  });
  $all('.icon-btn[data-action="delete"]', el).forEach(btn=>{
    btn.onclick = async ()=>{
      const inUse = DATA.payments.some(p=>p.providerId===btn.dataset.id);
      if(inUse){ toast('Нельзя удалить: есть связанные платежи'); return; }
      if(!confirm('Удалить поставщика?')) return;
      DATA.providers = DATA.providers.filter(p=>p.id!==btn.dataset.id);
      await saveData('Удаление поставщика');
      renderAdminDashboard();
    };
  });
}

function renderAdminAccounts(){
  const el = $('#accountsList');
  if(!el) return;
  el.innerHTML = DATA.accounts.map(a=>`
    <div class="account-row">
      <div class="payment-logo" style="background:${a.role==='admin'?'#a78bfa':'#22d3ee'}">${(a.name||a.login)[0].toUpperCase()}</div>
      <div class="payment-info"><h4>${a.name || a.login}</h4><span class="muted">${a.login} · ${a.role==='admin'?'Администратор':'Клиент'}</span></div>
      <div class="row-actions">
        <button class="icon-btn" data-action="delete" data-id="${a.id}">🗑️</button>
      </div>
    </div>`).join('');
  $all('.icon-btn[data-action="delete"]', el).forEach(btn=>{
    btn.onclick = async ()=>{
      const acc = DATA.accounts.find(a=>a.id===btn.dataset.id);
      if(acc.id===SESSION.accountId){ toast('Нельзя удалить свою текущую учётку'); return; }
      if(acc.role==='admin' && DATA.accounts.filter(a=>a.role==='admin').length<=1){
        toast('Должна остаться хотя бы одна учётка администратора'); return;
      }
      if(!confirm(`Удалить учётку "${acc.login}"?`)) return;
      DATA.accounts = DATA.accounts.filter(a=>a.id!==acc.id);
      await saveData('Удаление учётной записи');
      renderAdminDashboard();
    };
  });
}

function populatePasswordAccountSelect(){
  const sel = $('#pwAccountSelect');
  if(sel) sel.innerHTML = DATA.accounts.map(a=>`<option value="${a.id}">${a.name||a.login} (${a.login})</option>`).join('');
}

function loadSettingsForm(){
  const s = getGhSettings();
  const owEl=$('#ghOwner'); if(owEl) owEl.value = s.owner || '';
  const repEl=$('#ghRepo'); if(repEl) repEl.value = s.repo || '';
  const brEl=$('#ghBranch'); if(brEl) brEl.value = s.branch || 'main';
  const tokEl=$('#ghToken'); if(tokEl) tokEl.value = getGhToken();
  const resultEl = $('#tokenCheckResult');
  if(resultEl){ resultEl.textContent = ''; resultEl.className = 'hint-text'; }
}

async function collectDiagnosticsReport(){
  const lines = [];
  lines.push('=== Densel Assistant — техническая диагностика ===');
  lines.push('Время отчёта: ' + new Date().toISOString());
  lines.push('BUILD_ID: ' + BUILD_ID);
  lines.push('User-Agent: ' + navigator.userAgent);
  lines.push('Online: ' + navigator.onLine);
  lines.push('URL: ' + location.href);
  lines.push('');
  lines.push('--- Сессия ---');
  lines.push('Роль: ' + (SESSION ? SESSION.role : 'не авторизован'));
  lines.push('Логин: ' + (SESSION ? SESSION.login : '—'));
  lines.push('');
  lines.push('--- Настройки GitHub (без токена) ---');
  const gh = getGhSettings();
  lines.push('owner: ' + (gh.owner || '(не задан)'));
  lines.push('repo: ' + (gh.repo || '(не задан)'));
  lines.push('branch: ' + (gh.branch || 'main'));
  const tok = getGhToken();
  lines.push('token: ' + (tok ? `задан (длина ${tok.length})` : 'не задан'));
  lines.push('');
  lines.push('--- Данные (DATA в памяти) ---');
  if(DATA){
    lines.push('accounts: ' + DATA.accounts.length);
    lines.push('providers: ' + DATA.providers.length);
    lines.push('payments: ' + DATA.payments.length);
  }else{
    lines.push('DATA не загружены');
  }
  lines.push('');
  lines.push('--- Статус синхронизации (UI) ---');
  const syncEl = $('#syncStatus');
  lines.push('syncStatus текст: ' + (syncEl ? syncEl.textContent : '—'));
  lines.push('');
  lines.push('--- Живая проверка через api.github.com (без CDN) ---');
  try{
    const apiData = await fetchDataViaApi();
    if(apiData){
      lines.push('payments на сервере (api.github.com): ' + apiData.payments.length);
      lines.push('accounts на сервере (api.github.com): ' + apiData.accounts.length);
    }else{
      lines.push('Не удалось прочитать через api.github.com (нет токена или ошибка)');
    }
  }catch(e){
    lines.push('Ошибка запроса к api.github.com: ' + e.message);
  }
  lines.push('');
  lines.push('--- Живая проверка data.json на GitHub Pages (через CDN, может отставать) ---');
  try{
    const res = await fetch('./data.json?diag=' + Date.now(), {cache:'no-store'});
    lines.push('HTTP статус: ' + res.status);
    if(res.ok){
      const txt = await res.text();
      lines.push('Размер ответа: ' + txt.length + ' символов');
      try{
        const parsed = JSON.parse(txt);
        lines.push('payments в файле (Pages CDN): ' + (parsed.payments ? parsed.payments.length : '—'));
        lines.push('accounts в файле (Pages CDN): ' + (parsed.accounts ? parsed.accounts.length : '—'));
      }catch(e){ lines.push('Не удалось распарсить JSON: ' + e.message); }
    }
  }catch(e){
    lines.push('Ошибка запроса: ' + e.message);
  }
  lines.push('');
  lines.push('--- Service Worker ---');
  if('serviceWorker' in navigator){
    try{
      const regs = await navigator.serviceWorker.getRegistrations();
      lines.push('Регистраций: ' + regs.length);
      regs.forEach((r,i)=>{
        lines.push(`  [${i}] scope=${r.scope} active=${!!r.active} waiting=${!!r.waiting} installing=${!!r.installing}`);
        if(r.active) lines.push(`      activeScriptURL=${r.active.scriptURL}`);
      });
    }catch(e){ lines.push('Ошибка чтения регистраций SW: ' + e.message); }
    try{
      const cacheNames = await caches.keys();
      lines.push('Кэши (Cache Storage): ' + cacheNames.join(', '));
      for(const name of cacheNames){
        const cache = await caches.open(name);
        const keys = await cache.keys();
        const uniquePaths = [...new Set(keys.map(k=>new URL(k.url).pathname))];
        lines.push(`  ${name}: ${keys.length} записей, уникальных путей: ${uniquePaths.length} — ` + uniquePaths.join(', '));
      }
    }catch(e){ lines.push('Ошибка чтения Cache Storage: ' + e.message); }
  }else{
    lines.push('Service Worker не поддерживается браузером');
  }
  lines.push('');
  lines.push('--- localStorage ключи (без значений паролей/токена) ---');
  Object.keys(localStorage).filter(k=>k.startsWith('densel_')).forEach(k=>{
    if(k === LS_GH_TOKEN){ lines.push(k + ': [скрыто]'); return; }
    const v = localStorage.getItem(k);
    lines.push(k + ': ' + (v && v.length > 200 ? v.slice(0,200) + '…(обрезано)' : v));
  });
  lines.push('');
  lines.push('--- Последние ошибки (максимум 20) ---');
  if(ERROR_LOG.length === 0){
    lines.push('Ошибок не зафиксировано в этой сессии.');
  }else{
    ERROR_LOG.forEach((e,i)=>{ lines.push(`[${i}] ${e.time} — ${e.where}: ${e.message}`); });
  }
  return lines.join('\n');
}

async function runDiagnostics(){
  const out = $('#diagOutput');
  const copyBtn = $('#copyDiagBtn');
  const msg = $('#diagMsg');
  if(!out) return;
  out.style.display = 'block';
  out.textContent = 'Собираю данные…';
  if(msg) msg.textContent = '';
  try{
    const report = await collectDiagnosticsReport();
    out.textContent = report;
    if(copyBtn) copyBtn.style.display = 'block';
  }catch(e){
    out.textContent = 'Ошибка сбора диагностики: ' + e.message;
    logError('runDiagnostics', e);
  }
}

async function copyDiagnostics(){
  const out = $('#diagOutput');
  const msg = $('#diagMsg');
  const text = out ? (out.textContent || '') : '';
  try{
    if(navigator.clipboard && navigator.clipboard.writeText){
      await navigator.clipboard.writeText(text);
    }else{
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    if(msg) msg.textContent = 'Скопировано в буфер обмена ✓';
    toast('Диагностика скопирована');
  }catch(e){
    if(msg) msg.textContent = 'Не удалось скопировать автоматически — выделите текст вручную.';
    logError('copyDiagnostics', e);
  }
}

function openModal(html){
  const box = $('#modalBox'); if(box) box.innerHTML = html;
  const ov = $('#modalOverlay'); if(ov) ov.classList.add('active');
}
function closeModal(){ const ov = $('#modalOverlay'); if(ov) ov.classList.remove('active'); }
on('#modalOverlay', 'click', e=>{ if(e.target.id==='modalOverlay') closeModal(); });

function openPaymentModal(existing){
  const isEdit = !!existing;
  const providerOptions = DATA.providers.map(p=>`<option value="${p.id}" ${existing&&existing.providerId===p.id?'selected':''}>${p.name}</option>`).join('');
  openModal(`
    <h3>${isEdit?'Редактировать платёж':'Новый платёж'}</h3>
    <form id="paymentForm" class="settings-form">
      <label class="field"><span>Поставщик</span><select id="pf_provider" class="select">${providerOptions}</select></label>
      <label class="field"><span>Период</span><input type="month" id="pf_period" value="${existing?existing.period:currentPeriod()}" required></label>
      <label class="field"><span>Сумма к оплате</span><input type="number" step="0.01" id="pf_due" value="${existing?existing.amountDue:''}" required></label>
      <label class="field"><span>Срок оплаты</span><input type="date" id="pf_duedate" value="${existing?existing.dueDate:''}" required></label>
      <label class="field"><span>Оплачено (сумма)</span><input type="number" step="0.01" id="pf_paid" value="${existing?existing.amountPaid||0:0}"></label>
      <label class="field"><span>Дата оплаты</span><input type="date" id="pf_paiddate" value="${existing?existing.paidDate||'':''}"></label>
      <div class="modal-actions">
        <button type="button" class="btn ghost full" id="pf_cancel">Отмена</button>
        <button type="submit" class="btn primary full">Сохранить</button>
      </div>
    </form>
  `);
  on('#pf_cancel', 'click', closeModal);
  const form = $('#paymentForm');
  if(form) form.onsubmit = async (e)=>{
    e.preventDefault();
    const rec = {
      id: existing ? existing.id : 'p_' + Date.now(),
      providerId: $('#pf_provider').value,
      period: $('#pf_period').value,
      amountDue: parseFloat($('#pf_due').value)||0,
      dueDate: $('#pf_duedate').value,
      amountPaid: parseFloat($('#pf_paid').value)||0,
      paidDate: $('#pf_paiddate').value || null
    };
    if(isEdit){
      const idx = DATA.payments.findIndex(p=>p.id===existing.id);
      DATA.payments[idx] = rec;
    }else{
      DATA.payments.push(rec);
    }
    closeModal();
    await saveData(isEdit?'Редактирование платежа':'Новый платёж');
    renderAdminDashboard();
  };
}

function openProviderModal(existing){
  openModal(`
    <h3>${existing?'Редактировать поставщика':'Новый поставщик'}</h3>
    <form id="providerForm" class="settings-form">
      <label class="field"><span>Название</span><input type="text" id="pr_name" value="${existing?existing.name:''}" required></label>
      <label class="field"><span>Значок (emoji или буква)</span><input type="text" id="pr_logo" maxlength="2" value="${existing?existing.logo||'':''}"></label>
      <label class="field"><span>Цвет (HEX)</span><input type="text" id="pr_color" value="${existing?existing.color:'#22d3ee'}"></label>
      <label class="field"><span>Путь к файлу логотипа в репозитории (опционально)</span><input type="text" id="pr_logourl" placeholder="assets/logos/name.png" value="${existing?existing.logoUrl||'':''}"></label>
      <div class="modal-actions">
        <button type="button" class="btn ghost full" id="pr_cancel">Отмена</button>
        <button type="submit" class="btn primary full">Сохранить</button>
      </div>
    </form>
  `);
  on('#pr_cancel', 'click', closeModal);
  const form = $('#providerForm');
  if(form) form.onsubmit = async (e)=>{
    e.preventDefault();
    const rec = {
      id: existing ? existing.id : 'pr_' + Date.now(),
      name: $('#pr_name').value.trim(),
      logo: $('#pr_logo').value.trim(),
      color: $('#pr_color').value.trim() || '#22d3ee',
      logoUrl: $('#pr_logourl').value.trim() || null
    };
    if(existing){
      const idx = DATA.providers.findIndex(p=>p.id===existing.id);
      DATA.providers[idx] = rec;
    }else{
      DATA.providers.push(rec);
    }
    closeModal();
    await saveData(existing?'Редактирование поставщика':'Новый поставщик');
    renderAdminDashboard();
  };
}

function openAccountModal(){
  openModal(`
    <h3>Новая учётная запись</h3>
    <form id="accountForm" class="settings-form">
      <label class="field"><span>Имя (для отображения)</span><input type="text" id="ac_name" required></label>
      <label class="field"><span>Логин</span><input type="text" id="ac_login" required></label>
      <label class="field"><span>Пароль</span><input type="password" id="ac_pass" minlength="4" required></label>
      <label class="field"><span>Роль</span>
        <select id="ac_role" class="select">
          <option value="client">Клиент</option>
          <option value="admin">Администратор</option>
        </select>
      </label>
      <div class="modal-actions">
        <button type="button" class="btn ghost full" id="ac_cancel">Отмена</button>
        <button type="submit" class="btn primary full">Создать</button>
      </div>
    </form>
  `);
  on('#ac_cancel', 'click', closeModal);
  const form = $('#accountForm');
  if(form) form.onsubmit = async (e)=>{
    e.preventDefault();
    const login = $('#ac_login').value.trim();
    if(DATA.accounts.some(a=>a.login.toLowerCase()===login.toLowerCase())){
      toast('такой логин уже существует'); return;
    }
    const salt = randomSalt();
    const passHash = await sha256Hex(salt + $('#ac_pass').value);
    DATA.accounts.push({ id:'acc_'+Date.now(), role:$('#ac_role').value, login, name:$('#ac_name').value.trim(), salt, passHash });
    closeModal();
    await saveData('Новая учётная запись');
    renderAdminDashboard();
  };
}

on('#settingsForm', 'submit', async (e)=>{
  e.preventDefault();
  const settings = {owner:$('#ghOwner').value.trim(), repo:$('#ghRepo').value.trim(), branch:$('#ghBranch').value.trim()||'main'};
  localStorage.setItem(LS_GH_SETTINGS, JSON.stringify(settings));
  localStorage.setItem(LS_GH_TOKEN, $('#ghToken').value.trim());
  $('#settingsMsg').textContent = 'Настройки сохранены на этом устройстве.';
  toast('Настройки GitHub сохранены');
});

on('#checkTokenBtn', 'click', checkGithubToken);

on('#passwordForm', 'submit', async (e)=>{
  e.preventDefault();
  const accId = $('#pwAccountSelect').value;
  const acc = DATA.accounts.find(a=>a.id===accId);
  const newPass = $('#pwNewInput').value;
  if(newPass.length<4){ $('#pwMsg').textContent = 'Пароль слишком короткий'; return; }
  acc.salt = randomSalt();
  acc.passHash = await sha256Hex(acc.salt + newPass);
  await saveData('Смена пароля');
  $('#pwMsg').textContent = 'Пароль обновлен.';
  $('#pwNewInput').value = '';
  toast('Пароль изменён');
});

$all('.tab').forEach(tab=>{
  tab.addEventListener('click', ()=>{
    $all('.tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    $all('.tab-panel').forEach(p=>p.classList.remove('active'));
    const panel = $('#tab-'+tab.dataset.tab); if(panel) panel.classList.add('active');
    CURRENT_TAB = tab.dataset.tab;
  });
});

on('#addPaymentBtn', 'click', ()=>openPaymentModal(null));
on('#addProviderBtn', 'click', ()=>openProviderModal(null));
on('#addAccountBtn', 'click', ()=>openAccountModal());

on('#clientSyncBtn', 'click', forceSync);
on('#adminSyncBtn', 'click', forceSync);

on('#collectDiagBtn', 'click', runDiagnostics);
on('#copyDiagBtn', 'click', copyDiagnostics);

function showScreen(id){
  $all('.screen').forEach(s=>s.classList.remove('active'));
  const el = $('#'+id); if(el) el.classList.add('active');
}

on('#loginForm', 'submit', async (e)=>{
  e.preventDefault();
  const login = $('#loginInput').value.trim();
  const password = $('#passwordInput').value;
  const account = DATA && DATA.accounts ? DATA.accounts.find(a=>a.login.toLowerCase()===login.toLowerCase()) : null;
  const errEl = $('#loginError');
  if(!DATA){ if(errEl) errEl.textContent = 'Данные ещё не загружены, подождите секунду и повторите'; return; }
  if(!account){ if(errEl) errEl.textContent = 'Неверный логин или пароль'; return; }
  const hash = await sha256Hex(account.salt + password);
  if(hash !== account.passHash){ if(errEl) errEl.textContent = 'Неверный логин или пароль'; return; }
  if(errEl) errEl.textContent = '';
  SESSION = {accountId: account.id, role: account.role, login: account.login};
  localStorage.setItem(LS_SESSION, JSON.stringify(SESSION));
  enterApp();
});

function logout(){
  SESSION = null;
  localStorage.removeItem(LS_SESSION);
  const li=$('#loginInput'); if(li) li.value='';
  const pi=$('#passwordInput'); if(pi) pi.value='';
  showScreen('loginScreen');
}
on('#clientLogoutBtn', 'click', logout);
on('#adminLogoutBtn', 'click', logout);

function enterApp(){
  if(SESSION.role === 'admin'){
    showScreen('adminScreen');
    renderAdminDashboard();
  }else{
    showScreen('clientScreen');
    renderClientDashboard();
  }
}

async function boot(){
  const savedSessionRaw = localStorage.getItem(LS_SESSION);
  let preSessionRole = null;
  if(savedSessionRaw){
    try{ preSessionRole = JSON.parse(savedSessionRaw).role; }catch(e){}
  }
  try{
    await loadData(true, preSessionRole === 'admin');
  }catch(e){
    logError('boot/loadData', e);
    toast('Не удалось загрузить данные: ' + e.message, 5000);
  }
  if(savedSessionRaw && DATA){
    try{
      SESSION = JSON.parse(savedSessionRaw);
      const acc = DATA.accounts.find(a=>a.id===SESSION.accountId);
      if(acc){ enterApp(); return; }
    }catch(e){}
  }
  showScreen('loginScreen');
}

if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  });
}

boot();
