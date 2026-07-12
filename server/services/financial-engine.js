function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 2) {
  const multiplier = 10 ** digits;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}

export function simulateTrade(input) {
  const action = String(input.action || '').toUpperCase();
  if (!['BUY', 'SELL'].includes(action)) throw new Error('Action must be BUY or SELL');

  const symbol = String(input.symbol || '').trim().toUpperCase();
  if (!symbol) throw new Error('A ticker symbol is required');

  const holdings = (input.holdings || []).map((holding) => ({
    symbol: String(holding.symbol).toUpperCase(),
    quantity: asNumber(holding.quantity),
    currentPrice: asNumber(holding.currentPrice ?? holding.current_price)
  }));

  const selected = holdings.find((holding) => holding.symbol === symbol) || {
    symbol,
    quantity: 0,
    currentPrice: asNumber(input.currentPrice)
  };

  const executionPrice = asNumber(input.executionPrice, selected.currentPrice);
  const targetPrice = asNumber(input.targetPrice, executionPrice);
  if (executionPrice <= 0 || targetPrice <= 0) throw new Error('Execution and target prices must be greater than zero');

  let quantity = asNumber(input.quantity);
  const amount = asNumber(input.amount);
  if (quantity <= 0 && amount > 0) quantity = amount / executionPrice;
  if (quantity <= 0) throw new Error('Enter a quantity or dollar amount greater than zero');

  if (action === 'SELL' && quantity > selected.quantity) {
    throw new Error(`Cannot sell ${round(quantity, 6)} shares; only ${round(selected.quantity, 6)} are available`);
  }

  const cashBefore = asNumber(input.cashBalance);
  const tradeValue = quantity * executionPrice;
  if (action === 'BUY' && tradeValue > cashBefore && input.allowNegativeCash !== true) {
    throw new Error(`Trade requires $${round(tradeValue).toLocaleString()} but only $${round(cashBefore).toLocaleString()} cash is available`);
  }

  const selectedCurrentValue = selected.quantity * selected.currentPrice;
  const otherHoldingsCurrentValue = holdings
    .filter((holding) => holding.symbol !== symbol)
    .reduce((sum, holding) => sum + holding.quantity * holding.currentPrice, 0);
  const portfolioBefore = cashBefore + selectedCurrentValue + otherHoldingsCurrentValue;

  const quantityAfter = action === 'BUY' ? selected.quantity + quantity : selected.quantity - quantity;
  const cashAfter = action === 'BUY' ? cashBefore - tradeValue : cashBefore + tradeValue;
  const selectedValueAtExecution = quantityAfter * executionPrice;
  const portfolioAfterExecution = cashAfter + selectedValueAtExecution + otherHoldingsCurrentValue;
  const selectedValueAtTarget = quantityAfter * targetPrice;
  const portfolioAtTarget = cashAfter + selectedValueAtTarget + otherHoldingsCurrentValue;

  const allocationBefore = portfolioBefore > 0 ? selectedCurrentValue / portfolioBefore : 0;
  const allocationAfter = portfolioAfterExecution > 0 ? selectedValueAtExecution / portfolioAfterExecution : 0;
  const allocationAtTarget = portfolioAtTarget > 0 ? selectedValueAtTarget / portfolioAtTarget : 0;

  return {
    symbol,
    action,
    quantity: round(quantity, 6),
    executionPrice: round(executionPrice, 4),
    targetPrice: round(targetPrice, 4),
    tradeValue: round(tradeValue),
    cashBefore: round(cashBefore),
    cashAfter: round(cashAfter),
    quantityBefore: round(selected.quantity, 6),
    quantityAfter: round(quantityAfter, 6),
    portfolioBefore: round(portfolioBefore),
    portfolioAfterExecution: round(portfolioAfterExecution),
    portfolioAtTarget: round(portfolioAtTarget),
    targetScenarioDelta: round(portfolioAtTarget - portfolioBefore),
    selectedHoldingValueBefore: round(selectedCurrentValue),
    selectedHoldingValueAfter: round(selectedValueAtExecution),
    selectedHoldingValueAtTarget: round(selectedValueAtTarget),
    allocationBeforePct: round(allocationBefore * 100, 2),
    allocationAfterPct: round(allocationAfter * 100, 2),
    allocationAtTargetPct: round(allocationAtTarget * 100, 2),
    concentrationFlag: allocationAtTarget >= 0.25,
    assumptions: [
      'Other holdings remain at their current values.',
      'Taxes, spreads, commissions, and slippage are excluded.',
      'The target price is a user-defined scenario, not a forecast.'
    ]
  };
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function normalRandom(random) {
  let u = 0;
  let v = 0;
  while (u === 0) u = random();
  while (v === 0) v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return 0;
  const index = (sortedValues.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (index - lower);
}

export function projectRetirement(input) {
  const currentAge = Math.max(18, Math.floor(asNumber(input.currentAge, 45)));
  const retirementAge = Math.max(currentAge + 1, Math.floor(asNumber(input.retirementAge, 65)));
  const endAge = Math.max(retirementAge + 1, Math.floor(asNumber(input.endAge ?? input.planEndAge, 95)));
  const startingPortfolio = Math.max(0, asNumber(input.startingPortfolio));
  const annualContribution = Math.max(0, asNumber(input.annualContribution));
  const annualSpending = Math.max(0, asNumber(input.annualRetirementSpending));
  const expectedReturn = asNumber(input.expectedReturn, 0.065);
  const volatility = Math.max(0, asNumber(input.volatility, 0.14));
  const inflation = Math.max(-0.02, asNumber(input.inflation, 0.025));
  const simulationCount = Math.min(10000, Math.max(250, Math.floor(asNumber(input.simulationCount, 1000))));
  const random = seededRandom(Math.floor(asNumber(input.seed, 20260711)));

  const ages = [];
  for (let age = currentAge; age <= endAge; age += 1) ages.push(age);

  const deterministic = [];
  let deterministicBalance = startingPortfolio;
  for (const age of ages) {
    deterministic.push(round(Math.max(0, deterministicBalance)));
    if (age < retirementAge) {
      deterministicBalance = deterministicBalance * (1 + expectedReturn) + annualContribution;
    } else {
      const spending = annualSpending * ((1 + inflation) ** (age - retirementAge));
      deterministicBalance = deterministicBalance * (1 + expectedReturn) - spending;
    }
  }

  const balancesByYear = ages.map(() => []);
  let successes = 0;
  for (let run = 0; run < simulationCount; run += 1) {
    let balance = startingPortfolio;
    let depleted = false;
    for (let index = 0; index < ages.length; index += 1) {
      const age = ages[index];
      balancesByYear[index].push(Math.max(0, balance));
      const annualReturn = Math.max(-0.95, expectedReturn + volatility * normalRandom(random));
      if (age < retirementAge) {
        balance = balance * (1 + annualReturn) + annualContribution;
      } else {
        const spending = annualSpending * ((1 + inflation) ** (age - retirementAge));
        balance = balance * (1 + annualReturn) - spending;
        if (balance <= 0) {
          balance = 0;
          depleted = true;
        }
      }
    }
    if (!depleted && balance > 0) successes += 1;
  }

  const p10 = [];
  const p50 = [];
  const p90 = [];
  for (const values of balancesByYear) {
    values.sort((a, b) => a - b);
    p10.push(round(percentile(values, 0.10)));
    p50.push(round(percentile(values, 0.50)));
    p90.push(round(percentile(values, 0.90)));
  }

  const successRate = successes / simulationCount;
  let readiness = 'Needs attention';
  if (successRate >= 0.85) readiness = 'On track';
  else if (successRate >= 0.65) readiness = 'Watch closely';

  return {
    inputs: {
      currentAge,
      retirementAge,
      endAge,
      startingPortfolio: round(startingPortfolio),
      annualContribution: round(annualContribution),
      annualRetirementSpending: round(annualSpending),
      expectedReturn,
      volatility,
      inflation,
      simulationCount
    },
    successRatePct: round(successRate * 100, 1),
    readiness,
    ages,
    deterministic,
    p10,
    p50,
    p90,
    assumptions: [
      'Returns are sampled from a normal distribution using the configured mean and volatility.',
      'Taxes, Social Security, pensions, required minimum distributions, and healthcare shocks are not modeled in Phase 1.',
      'Monte Carlo results are hypothetical and are not guarantees.'
    ]
  };
}
