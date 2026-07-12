function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNonNegative(value) {
  return Math.max(0, number(value));
}

export function monthsElapsedSince(startDate, asOf = new Date()) {
  if (!startDate) return null;
  const start = new Date(`${String(startDate).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return null;
  const end = asOf instanceof Date ? asOf : new Date(asOf);
  if (Number.isNaN(end.getTime())) return null;
  const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12
    + (end.getUTCMonth() - start.getUTCMonth());
  return Math.max(0, months);
}

export function loanTermPosition(liability, asOf = new Date()) {
  const termMonths = Math.max(0, Math.floor(number(liability.original_term_months)));
  const explicitCurrentMonth = liability.current_term_month == null
    ? null
    : Math.max(0, Math.floor(number(liability.current_term_month)));
  const elapsedFromDate = monthsElapsedSince(liability.loan_start_date, asOf);
  const elapsedMonths = explicitCurrentMonth ?? elapsedFromDate ?? 0;
  const remainingMonths = termMonths > 0 ? Math.max(0, termMonths - elapsedMonths) : null;
  return {
    originalTermMonths: termMonths || null,
    elapsedMonths,
    currentYear: Math.floor(elapsedMonths / 12) + 1,
    currentMonthInYear: (elapsedMonths % 12) + 1,
    remainingMonths
  };
}

export function mortgagePaymentBreakdown(liability) {
  const propertyTax = clampNonNegative(liability.property_tax_payment);
  const homeInsurance = clampNonNegative(liability.home_insurance_payment);
  const pmi = clampNonNegative(liability.pmi_payment);
  const hoa = clampNonNegative(liability.hoa_payment);
  const otherEscrow = clampNonNegative(liability.other_escrow_payment);
  const escrowTotal = propertyTax + homeInsurance + pmi + hoa + otherEscrow;
  const explicitPrincipalInterest = clampNonNegative(liability.principal_interest_payment);
  const total = clampNonNegative(liability.monthly_payment);
  const principalInterest = explicitPrincipalInterest > 0
    ? explicitPrincipalInterest
    : Math.max(0, total - escrowTotal);
  const computedTotal = principalInterest + escrowTotal;
  return {
    principalInterest,
    propertyTax,
    homeInsurance,
    pmi,
    hoa,
    otherEscrow,
    escrowTotal,
    total: total > 0 ? total : computedTotal
  };
}

export function estimateMonthlyPrincipalInterest(liability) {
  if (liability.liability_type === 'mortgage') {
    return mortgagePaymentBreakdown(liability).principalInterest;
  }
  return clampNonNegative(liability.monthly_payment || liability.minimum_payment);
}

export function advanceLoanBalance(liability, months = 12) {
  let balance = clampNonNegative(liability.current_balance ?? liability.balance);
  if (balance <= 0) return 0;
  const monthlyRate = clampNonNegative(liability.interest_rate) / 12;
  const payment = estimateMonthlyPrincipalInterest(liability);
  if (payment <= 0) return balance;

  for (let month = 0; month < months && balance > 0; month += 1) {
    const interest = balance * monthlyRate;
    const principal = Math.max(0, payment - interest);
    if (principal <= 0) break;
    balance = Math.max(0, balance - principal);
  }
  return balance;
}

export function estimatedPayoffDate(liability, asOf = new Date()) {
  const position = loanTermPosition(liability, asOf);
  if (position.remainingMonths == null) return null;
  const date = new Date(asOf);
  date.setUTCMonth(date.getUTCMonth() + position.remainingMonths);
  return date.toISOString().slice(0, 10);
}

export function estimatedPayoffAge(liability, currentAge, asOf = new Date()) {
  if (liability.payoff_age != null) return number(liability.payoff_age);
  const remaining = loanTermPosition(liability, asOf).remainingMonths;
  if (remaining == null || currentAge == null) return null;
  return Math.ceil(number(currentAge) + remaining / 12);
}
