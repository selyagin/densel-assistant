(() => {
  function isoMonth(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
  function localDay(date = new Date()) {
    const d = new Date(date); d.setHours(0, 0, 0, 0); return d;
  }
  function number(value) {
    const result = Number(value); return Number.isFinite(result) ? result : 0;
  }
  function normalized(payment) {
    return {
      id: payment.id,
      amount: number(payment.amount ?? payment.amountDue),
      paidAmount: number(payment.paidAmount ?? payment.amountPaid),
      billingMonth: payment.billingMonth ?? payment.period ?? '',
      dueDate: payment.dueDate ?? null,
      paymentDate: payment.paymentDate ?? payment.paidDate ?? null
    };
  }
  function status(payment, now = new Date()) {
    const p = normalized(payment), current = isoMonth(now), due = p.dueDate ? localDay(p.dueDate) : null, today = localDay(now);
    if (p.billingMonth > current && p.paidAmount === 0) return 'planned';
    if (p.paidAmount >= p.amount && p.billingMonth > current) return 'paid_early';
    if (p.paidAmount >= p.amount) return 'paid';
    if (p.paidAmount > 0) return 'partial';
    if (due && due < today) return 'overdue';
    return 'due';
  }
  function balance(payment) {
    const p = normalized(payment); return Math.max(p.amount - p.paidAmount, 0);
  }
  function isHistoryStatus(value) { return ['paid', 'paid_early', 'partial', 'due', 'overdue'].includes(value); }
  window.DenselPaymentRules = { normalized, status, balance, isHistoryStatus, isoMonth };
})();
