import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateHouseholdWhatIf } from '../server/services/what-if-engine.js';
import { parseWhatIfPrompt } from '../server/services/what-if-parser.js';

function basePlan() {
  return {
    plan: {
      current_age: 55,
      retirement_age: 65,
      plan_end_age: 61,
      effective_tax_rate: 0.15
    },
    accounts: [
      {
        id: 'cash',
        name: 'Checking',
        account_type: 'cash',
        current_balance: 100000,
        expected_return: 0
      },
      {
        id: 'stocks',
        name: 'Brokerage',
        account_type: 'brokerage',
        current_balance: 100000,
        expected_return: 0
      },
      {
        id: 'home',
        name: 'Home',
        account_type: 'property',
        current_balance: 700000,
        property_growth_rate: 0
      }
    ],
    incomes: [],
    expenses: [],
    contributions: [],
    liabilities: []
  };
}

test('mortgage principal falls each year using total payment minus escrow when P&I is blank', () => {
  const data = basePlan();
  data.liabilities.push({
    id: 'mortgage',
    name: 'Home mortgage',
    liability_type: 'mortgage',
    current_balance: 300000,
    interest_rate: 0.04,
    monthly_payment: 2600,
    principal_interest_payment: null,
    property_tax_payment: 500,
    home_insurance_payment: 200,
    pmi_payment: 0,
    hoa_payment: 0,
    other_escrow_payment: 0,
    original_term_months: 360,
    current_term_month: 120
  });

  const result = simulateHouseholdWhatIf(data, {});
  const age55 = result.baseline.timeline.find((row) => row.age === 55);
  const age56 = result.baseline.timeline.find((row) => row.age === 56);
  const age57 = result.baseline.timeline.find((row) => row.age === 57);

  assert.equal(age55.debt, 300000);
  assert.ok(age56.debt < age55.debt, `${age56.debt} should be below ${age55.debt}`);
  assert.ok(age57.debt < age56.debt, `${age57.debt} should be below ${age56.debt}`);
});

test('full payoff makes an insufficient brokerage account negative instead of silently partial-paying', () => {
  const data = basePlan();
  data.accounts.find((row) => row.id === 'stocks').current_balance = 50000;
  data.liabilities.push({
    id: 'mortgage',
    name: 'Home mortgage',
    liability_type: 'mortgage',
    current_balance: 250000,
    interest_rate: 0.04,
    principal_interest_payment: 1800,
    monthly_payment: 2500,
    property_tax_payment: 500,
    home_insurance_payment: 200
  });

  const result = simulateHouseholdWhatIf(data, {
    payoffActions: [{
      sourceAccountId: 'stocks',
      sourceAccountName: 'Brokerage',
      liabilityIds: ['mortgage'],
      liabilityNames: ['Home mortgage'],
      age: 56
    }]
  });

  const age56 = result.alternative.timeline.find((row) => row.age === 56);

  assert.equal(age56.debt, 0);
  assert.ok(age56.fundingAccountBalance < 0);
  assert.ok(result.metrics.scenarioFundingShortfall > 0);
  assert.equal(
    Math.round(Math.abs(age56.fundingAccountBalance)),
    Math.round(result.metrics.scenarioFundingShortfall)
  );
});

test('paying off mortgage and HELOC removes P&I, PMI, and HELOC payments but keeps escrow expenses', () => {
  const data = basePlan();
  data.accounts.find((row) => row.id === 'stocks').current_balance = 600000;
  data.liabilities.push(
    {
      id: 'mortgage',
      name: 'Primary mortgage',
      liability_type: 'mortgage',
      current_balance: 250000,
      interest_rate: 0.04,
      principal_interest_payment: 1800,
      monthly_payment: 2600,
      property_tax_payment: 500,
      home_insurance_payment: 200,
      pmi_payment: 100,
      hoa_payment: 0,
      other_escrow_payment: 0
    },
    {
      id: 'heloc',
      name: 'Home equity HELOC',
      liability_type: 'other',
      current_balance: 50000,
      interest_rate: 0.08,
      monthly_payment: 600
    }
  );

  data.expenses.push(
    {
      id: 'mortgage-total',
      name: 'Monthly home mortgage payment',
      category: 'mortgage',
      annual_amount: 2600 * 12,
      inflation_rate: 0,
      retirement_behavior: 'same',
      payment_account_id: 'cash'
    },
    {
      id: 'heloc-payment',
      name: 'HELOC payment',
      category: 'debt_payment',
      annual_amount: 600 * 12,
      inflation_rate: 0,
      retirement_behavior: 'same',
      payment_account_id: 'cash'
    }
  );

  const result = simulateHouseholdWhatIf(data, {
    payoffActions: [{
      sourceAccountId: 'stocks',
      sourceAccountName: 'Brokerage',
      liabilityIds: ['mortgage', 'heloc'],
      liabilityNames: ['Primary mortgage', 'Home equity HELOC'],
      age: 58
    }]
  });

  const baseline58 = result.baseline.timeline.find((row) => row.age === 58);
  const scenario58 = result.alternative.timeline.find((row) => row.age === 58);

  assert.equal(scenario58.debt, 0);
  assert.equal(scenario58.monthlyExpenses, 700);
  assert.equal(
    baseline58.monthlyExpenses - scenario58.monthlyExpenses,
    2500
  );
  assert.equal(result.metrics.monthlyExpenseReduction, 2500);
});

test('payoff prompt without a named funding account defaults to the largest brokerage account', async () => {
  const scenario = await parseWhatIfPrompt(
    'At 58 pay off heloc and mortgage',
    {
      currentAge: 55,
      accounts: [
        { id: 'cash', name: 'Checking', account_type: 'cash', current_balance: 25000 },
        { id: 'stocks', name: 'Brokerage', account_type: 'brokerage', current_balance: 400000 }
      ],
      liabilities: [
        { id: 'mortgage', name: 'Primary mortgage', liability_type: 'mortgage', current_balance: 250000 },
        { id: 'heloc', name: 'Home equity HELOC', liability_type: 'other', current_balance: 50000 }
      ],
      holdings: []
    },
    'household'
  );

  assert.equal(scenario.payoffActions.length, 1);
  assert.equal(scenario.payoffActions[0].sourceAccountId, 'stocks');
  assert.deepEqual(
    new Set(scenario.payoffActions[0].liabilityIds),
    new Set(['mortgage', 'heloc'])
  );
  assert.match(scenario.notes.join(' '), /Brokerage was used/i);
});
