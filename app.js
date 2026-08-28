/* ===================== Densel Assistant — core app logic ===================== */
/* Полностью статичное клиентское приложение. "База данных" — файл data.json
   в этом же репозитории. Чтение — обычным fetch (с обходом кэша), запись
   (только для админа) — через GitHub Contents API с личным токеном, который
   вводится в разделе "Настройки" и хранится ТОЛЬКО в localStorage устройства. */

const LS_DATA = 'densel_data_cache';
const LS_SESSION = 'densel_session';
const LS_GH_SETTINGS = 'densel_gh_settings';
const LS_GH_TOKEN = 'densel_gh_token';

let DATA = null;
let SESSION = null; // {accountId, role, login}
let CURRENT_TAB = 'overview';

/* ---------- Utils ---------- */
function $(sel, root=document){ return root.querySelector(sel); }
function $all(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }

function toast(msg, ms=3200){
  const el = $('#toast');
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

/* ---------- Data load / save ---------- */
async function loadData(showToastOnFallback){
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
  try{
    if(syncEl) syncEl.textContent = 'сохранение…';
    const getRes = await fetch(`${api}?ref=${branchName}`, {
      headers: {Authorization:`Bearer ${token}`, Accept:'application/vnd.github+json'}
    });
    if(getRes.status === 401) throw new Error('токен неверен или просрочен (401). создайте новый в разделе Настройки.');
    if(getRes.status === 404) throw new Error('репозиторий/файл не найден (404). Спроверьте владельца, имя репозитория и ветку.');
    let sha;
    if(getRes.ok){ sha = (await getRes.json()).sha; }
    const body = {
      message: commitMessage || 'Densel Assistant: обновление данных',
      content: utf8ToBase64(JSON.stringify(DATA, null, 2)),
      branch: branchName
    };
    if(sha) body.sha = sha;
    const putRes = await fetch(api, {
      method:'PUT',
      headers:{Authorization:`Bearer ${token}`, Accept:'application/vnd.github+json', 'Content-Type':'application/json'},
      body: JSON.stringify(body)
    });
    if(!putRes.ok){
      const err = await putRes.json().catch(()=>({}));
      if(putRes.status === 401) throw new Error('токен неверен или просрочен (401)');
      if(putRes.status === 403) throw new Error('нет прав на запись (403) — у токена должен быть доступ Contents: Read and write именно к этому репозиторию');
      if(putRes.status === 404) throw new Error('репозиторий или файл не найден (404) — проверьте владельца/название/ветку');
      if(putRes.status === 422) throw new Error('конфликт версии файла (422) — нажмите "Обновить данные" и повторите');
      throw new Error(err.message || `HTTP ${putRes.status}`);
    }
    if(syncEl) syncEl.textContent = `сохранено ${new Date().toLocaleTimeString('ru-RU')}`;
    toast('Изменения сохранены в GitHub ✓');
    return true;
  }catch(e){
    if(syncEl) syncEl.textContent = 'ошибка синхронизации';
    toast('Ошибка сохранения в GitHub: ' + e.message, 5000);
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
    if(repoRes.status === 401){
      resultEl.textContent = '❌ токен неверен или просрочен. создайте новый в GitHub → Settings → Developer settings → Personal access tokens.';
      resultEl.className = 'hint-text error-text';
      return;
    }
    if(repoRes.status === 404){
      resultEl.textContent = '❌ репозиторий не найден или у токена нет доступа. Проверьте владельца/название и то, что в токене выбран именно этот репозиторий.';
      resultEl.className = 'hint-text error-text';
      return;
    }
    if(!repoRes.ok){
      resultEl.textContent = `❌ Ошибка GitHub API: HTTP ${repoRes.status}`;
      resultEl.className = 'hint-text error-text';
      return;
    }
    const repoInfo = await repoRes.json();
    const perms = repoInfo.permissions || {};
    const fileRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/data.json?ref=${branch||'main'}`, {
      headers: {Authorization:`Bearer ${token}`, Accept:'application/vnd.github+json'}
    });
    if(!perms.push){
      resultEl.textContent = '⚠️ токен подключен, но нет права записи (push). Пересоздайте токен: Repository access → Only select repositories → densel-assistant, Permissions → Contents → Read and write.';
      resultEl.className = 'hint-text error-text';
      return;
    }
    if(!fileRes.ok){
      resultEl.textContent = `⚠️ доступ к репозиторию есть, но файл data.json не найден по ветке "${branch||'main'}" (HTTP ${fileRes.status}). Проверьте имя ветки.`;
      resultEl.className = 'hint-text error-text';
      return;
    }
    resultEl.textContent = `✅ токен работает, есть доступ на запись к ${owner}/${repo} (${branch||'main'}). Можно сохранять изменения.`;
    resultEl.className = 'hint-text';
  }catch(e){
    resultEl.textContent = '❌ Не удалось связаться с GitHub API: ' + e.message;
    resultEl.className = 'hint-text error-text';
  }
}

/* ---------- Force sync (manual refresh) ---------- */
async function forceSync(){
  toast('Обновляем данные…', 1500);
  try{
    const fresh = await loadData(false);
    if(SESSION){
      if(SESSION.role === 'admin') renderAdminDashboard();
      else renderClientDashboard();
    }
    toast(fresh ? 'Данные обновлены ✓' : 'Показаны сохраненные ранее данные (нет соединения)');
  }catch(e){
    toast('Не удалось обновить данные: ' + e.message, 4000);
  }
}

/* ---------- Status logic ---------- */
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

function computeAdvanceStreaks(){
  const streaks = {};
  const cur = currentPeriod();
  DATA.providers.forEach(pr=>{
    let count = 0;
    let period = addMonths(cur, 1);
    while(true){
      const p = DATA.payments.find(x=>x.providerId===pr.id && x.period===period);
      if(p && (p.amountPaid||0) >= p.amountDue){ count++; period = addMonths(period,1); }
      else break;
    }
    if(count>0) streaks[pr.id] = count;
  });
  return streaks;
}

function providerById(id){ return DATA.providers.find(p=>p.id===id); }

/* ---------- Rendering: shared payment row ---------- */
function paymentRowHtml(p, editable){
  const provider = providerById(p.providerId) || {name:'Неизвестно', color:'#888', logo:'?'};
  const status = getPaymentStatus(p);
  const pct = Math.min(100, Math.round(((p.amountPaid||0)/p.amountDue)*100));
  const logoHtml = provider.logoUrl
    ? `<img src="${provider.logoUrl}" alt="${provider.name}">`
    : (provider.logo || provider.name[0]);
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

/* ---------- Summary cards ---------- */
function buildSummary(paymentsScope){
  const cur = currentPeriod();
  const curPayments = paymentsScope.filter(p=>p.period===cur);
  const toPay = curPayments.reduce((s,p)=>s + Math.max(0, p.amountDue-(p.amountPaid||0)), 0);
  const paidThisMonth = curPayments.reduce((s,p)=>s + (p.amountPaid||0), 0);
  const overdue = paymentsScope.filter(p=>getPaymentStatus(p)==='overdue');
  const overdueSum = overdue.reduce((s,p)=>s + Math.max(0, p.amountDue-(p.amountPaid||0)), 0);
  const streaks = computeAdvanceStreaks();
  const maxAhead = Object.values(streaks).length ? Math.max(...Object.values(streaks)) : 0;

  return `
    <div class="summary-card"><div class="label">К оплате (${periodLabel(cur)})</div><div class="value amber">${fmtMoney(toPay)}</div></div>
    <div class="summary-card"><div class="label">Оплачено в этом месяце</div><div class="value green">${fmtMoney(paidThisMonth)}</div></div>
    <div class="summary-card"><div class="label">Просрочено</div><div class="value ${overdue.length?'red':''}">${overdue.length} · ${fmtMoney(overdueSum)}</div></div>
    <div class="summary-card"><div class="label">Оплата заранее</div><div class="value">${maxAhead>0? maxAhead+' мес.' : '—'}</div></div>
  `;
}

/* ---------- Charts (pure SVG, no dependencies) ---------- */
function renderTrendChart(svgEl, periods){
  const W=320,H=160,pad={l:8,r:8,t:14,b:20};
  const totals = periods.map(per=>{
    const items = DATA.payments.filter(p=>p.period===per);
    return {
      due: items.reduce((s,p)=>s+p.amountDue,0),
      paid: items.reduce((s,p)=>s+(p.amountPaid||0),0)
    };
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

/* ---------- Client dashboard ---------- */
function renderClientDashboard(){
  const account = DATA.accounts.find(a=>a.id===SESSION.accountId);
  $('#clientGreeting').textContent = `Здравствуйте, ${account.name || account.login}`;

  const payments = DATA.payments.slice().sort((a,b)=> b.period.localeCompare(a.period));
  $('#clientSummary').innerHTML = buildSummary(payments);

  const periods = Array.from(new Set(payments.map(p=>p.period))).sort().reverse();
  const filterEl = $('#periodFilter');
  filterEl.innerHTML = `<option value="all">Все периоды</option>` +
    periods.map(p=>`<option value="${p}">${periodLabel(p)}</option>`).join('');
  filterEl.value = periods.includes(currentPeriod()) ? currentPeriod() : 'all';

  function renderList(){
    const val = filterEl.value;
    const list = val==='all' ? payments : payments.filter(p=>p.period===val);
    $('#paymentsList').innerHTML = list.length
      ? list.map(p=>paymentRowHtml(p,false)).join('')
      : '<p class="muted">Нет платежей за выбранный период</p>';
  }
  filterEl.onchange = renderList;
  renderList();

  const rangeSel = $('#statsRange');
  function renderCharts(){
    const periods12 = last12Periods(parseInt(rangeSel.value,10));
    renderTrendChart($('#trendChart'), periods12);
    renderDonutChart($('#donutChart'), $('#donutLegend'));
  }
  rangeSel.onchange = renderCharts;
  renderCharts();
}

/* ---------- Admin dashboard ---------- */
function renderAdminDashboard(){
  renderAdminOverview();
  renderAdminPayments();
  renderAdminProviders();
  renderAdminAccounts();
  populatePasswordAccountSelect();
  loadSettingsForm();
}

function renderAdminOverview(){
  const payments = DATA.payments;
  $('#adminSummary').innerHTML = buildSummary(payments);
  const upcoming = payments
    .filter(p=>getPaymentStatus(p)!=='paid' && getPaymentStatus(p)!=='advance')
    .sort((a,b)=> new Date(a.dueDate) - new Date(b.dueDate))
    .slice(0,6);
  $('#upcomingList').innerHTML = upcoming.length
    ? upcoming.map(p=>paymentRowHtml(p,false)).join('')
    : '<p class="muted">Нет активных начислений</p>';
}

function renderAdminPayments(){
  const list = DATA.payments.slice().sort((a,b)=> b.period.localeCompare(a.period));
  const el = $('#adminPaymentsList');
  el.innerHTML = list.length
    ? list.map(p=>paymentRowHtml(p,true)).join('')
    : '<p class="muted">Платежей пока нет — добавьте первый.</p>';
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

function renderAdminProviders(){
  const el = $('#providersList');
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
  sel.innerHTML = DATA.accounts.map(a=>`<option value="${a.id}">${a.name||a.login} (${a.login})</option>`).join('');
}

function loadSettingsForm(){
  const s = getGhSettings();
  $('#ghOwner').value = s.owner || '';
  $('#ghRepo').value = s.repo || '';
  $('#ghBranch').value = s.branch || 'main';
  $('#ghToken').value = getGhToken();
  const resultEl = $('#tokenCheckResult');
  if(resultEl){ resultEl.textContent = ''; resultEl.className = 'hint-text'; }
}

/* ---------- Modals ---------- */
function openModal(html){
  $('#modalBox').innerHTML = html;
  $('#modalOverlay').classList.add('active');
}
function closeModal(){ $('#modalOverlay').classList.remove('active'); }
$('#modalOverlay').addEventListener('click', e=>{ if(e.target.id==='modalOverlay') closeModal(); });

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
  $('#pf_cancel').onclick = closeModal;
  $('#paymentForm').onsubmit = async (e)=>{
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
  $('#pr_cancel').onclick = closeModal;
  $('#providerForm').onsubmit = async (e)=>{
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
  $('#ac_cancel').onclick = closeModal;
  $('#accountForm').onsubmit = async (e)=>{
    e.preventDefault();
    const login = $('#ac_login').value.trim();
    if(DATA.accounts.some(a=>a.login.toLowerCase()===login.toLowerCase())){
      toast('такой логин уже существует'); return;
    }
    const salt = randomSalt();
    const passHash = await sha256Hex(salt + $('#ac_pass').value);
    DATA.accounts.push({
      id:'acc_'+Date.now(), role:$('#ac_role').value, login, name:$('#ac_name').value.trim(), salt, passHash
    });
    closeModal();
    await saveData('Новая учётная запись');
    renderAdminDashboard();
  };
}

/* ---------- Settings & password forms ---------- */
$('#settingsForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const settings = {owner:$('#ghOwner').value.trim(), repo:$('#ghRepo').value.trim(), branch:$('#ghBranch').value.trim()||'main'};
  localStorage.setItem(LS_GH_SETTINGS, JSON.stringify(settings));
  localStorage.setItem(LS_GH_TOKEN, $('#ghToken').value.trim());
  $('#settingsMsg').textContent = 'Настройки сохранены на этом устройстве.';
  toast('Настройки GitHub сохранены');
});

$('#checkTokenBtn').addEventListener('click', checkGithubToken);

$('#passwordForm').addEventListener('submit', async (e)=>{
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

/* ---------- Tabs ---------- */
$all('.tab').forEach(tab=>{
  tab.addEventListener('click', ()=>{
    $all('.tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    $all('.tab-panel').forEach(p=>p.classList.remove('active'));
    $('#tab-'+tab.dataset.tab).classList.add('active');
    CURRENT_TAB = tab.dataset.tab;
  });
});

$('#addPaymentBtn').addEventListener('click', ()=>openPaymentModal(null));
$('#addProviderBtn').addEventListener('click', ()=>openProviderModal(null));
$('#addAccountBtn').addEventListener('click', ()=>openAccountModal());

/* ---------- Manual sync buttons ---------- */
$('#clientSyncBtn').addEventListener('click', forceSync);
$('#adminSyncBtn').addEventListener('click', forceSync);

/* ---------- Auth ---------- */
function showScreen(id){
  $all('.screen').forEach(s=>s.classList.remove('active'));
  $('#'+id).classList.add('active');
}

$('#loginForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const login = $('#loginInput').value.trim();
  const password = $('#passwordInput').value;
  const account = DATA.accounts.find(a=>a.login.toLowerCase()===login.toLowerCase());
  const errEl = $('#loginError');
  if(!account){ errEl.textContent = 'Неверный логин или пароль'; return; }
  const hash = await sha256Hex(account.salt + password);
  if(hash !== account.passHash){ errEl.textContent = 'Неверный логин или пароль'; return; }
  errEl.textContent = '';
  SESSION = {accountId: account.id, role: account.role, login: account.login};
  localStorage.setItem(LS_SESSION, JSON.stringify(SESSION));
  enterApp();
});

function logout(){
  SESSION = null;
  localStorage.removeItem(LS_SESSION);
  $('#loginInput').value=''; $('#passwordInput').value='';
  showScreen('loginScreen');
}
$('#clientLogoutBtn').addEventListener('click', logout);
$('#adminLogoutBtn').addEventListener('click', logout);

function enterApp(){
  if(SESSION.role === 'admin'){
    showScreen('adminScreen');
    renderAdminDashboard();
  }else{
    showScreen('clientScreen');
    renderClientDashboard();
  }
}

/* ---------- Boot ---------- */
async function boot(){
  await loadData(true);
  const savedSession = localStorage.getItem(LS_SESSION);
  if(savedSession){
    try{
      SESSION = JSON.parse(savedSession);
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
