import { generateAiResponse } from './ai/index.js';

function finite(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max, fallback = min) {
  const parsed = finite(value, fallback);
  return Math.min(max, Math.max(min, parsed));
}

function money(value, fallback = 0) {
  return Math.max(0, finite(value, fallback));
}

function extractJson(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); }
  catch { return null; }
}

export function normalizePropertyEstimate(raw = {}, input = {}, metadata = {}) {
  const propertyValue = money(input.propertyValue);
  const fallbackMonthlyRent = money(input.monthlyRent, propertyValue > 0 ? propertyValue * 0.006 : 0);
  const fallbackTax = money(input.annualPropertyTax, propertyValue * 0.011);
  const fallbackInsurance = money(input.annualInsurance, propertyValue * 0.0045);
  const fallbackMaintenance = money(input.monthlyMaintenance, propertyValue > 0 ? propertyValue * 0.01 / 12 : 0);

  const appreciation = clamp(
    raw.annualAppreciationRate ?? raw.annual_appreciation_rate ?? raw.annualAppreciationPct / 100,
    -0.15,
    0.20,
    finite(input.annualAppreciationRate, 0.03)
  );
  const rentGrowth = clamp(
    raw.rentGrowthRate ?? raw.rent_growth_rate ?? raw.rentGrowthPct / 100,
    -0.10,
    0.20,
    finite(input.rentGrowthRate, 0.03)
  );

  return {
    zipCode: String(input.zipCode || raw.resolvedZipCode || raw.zipCode || '').trim(),
    annualAppreciationRate: appreciation,
    estimatedMonthlyRent: money(raw.estimatedMonthlyRent ?? raw.monthlyRent, fallbackMonthlyRent),
    rentGrowthRate: rentGrowth,
    vacancyRate: clamp(raw.vacancyRate ?? raw.vacancy_rate ?? raw.vacancyPct / 100, 0, 0.5, finite(input.vacancyRate, 0.05)),
    managementRate: clamp(raw.managementRate ?? raw.management_rate ?? raw.managementPct / 100, 0, 0.5, finite(input.managementRate, 0.08)),
    annualPropertyTax: money(raw.annualPropertyTax ?? raw.propertyTax, fallbackTax),
    annualInsurance: money(raw.annualInsurance ?? raw.insurance, fallbackInsurance),
    monthlyHoa: money(raw.monthlyHoa ?? raw.hoa, money(input.monthlyHoa)),
    monthlyMaintenance: money(raw.monthlyMaintenance ?? raw.maintenanceReserve, fallbackMaintenance),
    confidence: clamp(raw.confidence, 0, 1, metadata.source === 'ai_web_research' ? 0.65 : 0.25),
    summary: String(raw.summary || metadata.summary || 'Planning estimate based on entered property details.').slice(0, 1500),
    methodology: String(raw.methodology || metadata.methodology || '').slice(0, 1200),
    source: metadata.source || raw.source || 'planning_fallback',
    asOf: metadata.asOf || new Date().toISOString(),
    sources: Array.isArray(metadata.sources) ? metadata.sources.slice(0, 12) : [],
    dataGaps: Array.isArray(raw.dataGaps) ? raw.dataGaps.map(String).slice(0, 10) : (metadata.dataGaps || [])
  };
}

export function calculateRentalEconomics(input = {}) {
  const monthlyRent = money(input.monthlyRent ?? input.estimatedMonthlyRent);
  const vacancy = monthlyRent * clamp(input.vacancyRate, 0, 0.5, 0.05);
  const management = monthlyRent * clamp(input.managementRate, 0, 0.5, 0.08);
  const propertyTax = money(input.annualPropertyTax) / 12;
  const insurance = money(input.annualInsurance) / 12;
  const hoa = money(input.monthlyHoa);
  const maintenance = money(input.monthlyMaintenance);
  const mortgage = money(input.monthlyMortgagePayment);
  const operatingExpenses = vacancy + management + propertyTax + insurance + hoa + maintenance;
  const netOperatingIncome = monthlyRent - operatingExpenses;
  const monthlyCashFlow = monthlyRent - operatingExpenses - mortgage;
  const propertyValue = money(input.propertyValue);
  const cashInvested = money(input.cashInvested);
  return {
    monthlyRent,
    monthlyVacancy: vacancy,
    monthlyManagement: management,
    monthlyPropertyTax: propertyTax,
    monthlyInsurance: insurance,
    monthlyHoa: hoa,
    monthlyMaintenance: maintenance,
    monthlyOperatingExpenses: operatingExpenses,
    monthlyMortgagePayment: mortgage,
    monthlyNetOperatingIncome: netOperatingIncome,
    monthlyCashFlow,
    annualNetOperatingIncome: netOperatingIncome * 12,
    capRate: propertyValue > 0 ? netOperatingIncome * 12 / propertyValue : null,
    cashOnCashReturn: cashInvested > 0 ? monthlyCashFlow * 12 / cashInvested : null
  };
}

export async function estimatePropertyMarket(input = {}) {
  const fallback = normalizePropertyEstimate({}, input, {
    source: 'planning_fallback',
    summary: 'Local web research was unavailable, so Nirvana used conservative planning defaults. Replace them with verified local estimates before making a decision.',
    methodology: 'Fallback appreciation is 3%; rent defaults to 0.6% of property value per month when a property value is supplied; taxes, insurance and maintenance use broad planning ratios.',
    dataGaps: ['No verified ZIP-level market research was available for this run.']
  });

  const systemPrompt = `You are a real-estate market research agent inside a personal-finance planning application. Research the supplied US property address or ZIP code using current, reputable web sources. Return JSON only. Do not give a buy recommendation. Do not invent precision when local data is unavailable.

Required JSON schema:
{
  "resolvedZipCode": "01845",
  "annualAppreciationRate": 0.032,
  "estimatedMonthlyRent": 2800,
  "rentGrowthRate": 0.03,
  "vacancyRate": 0.05,
  "managementRate": 0.08,
  "annualPropertyTax": 7200,
  "annualInsurance": 2400,
  "monthlyHoa": 0,
  "monthlyMaintenance": 350,
  "confidence": 0.65,
  "summary": "short explanation of local market evidence",
  "methodology": "how the estimate was bounded",
  "dataGaps": ["missing information"]
}

Rules:
- Annual rates are decimals, not percentages.
- Appreciation must be a defensible medium-term planning assumption, not the latest one-year spike.
- Rent should reflect the supplied home type, bedrooms, bathrooms and square footage when available.
- Property tax and insurance may be estimated from local rates when an exact address is not available.
- Management, vacancy and maintenance are planning assumptions and should be clearly described.
- Use null-like omissions only when a field truly cannot be estimated; do not fabricate source names inside JSON.`;

  const userMessage = `Estimate a planning range for this property:
Address: ${input.address || 'not provided'}
ZIP code: ${input.zipCode || 'not provided'}
Home type: ${input.homeType || 'not provided'}
Bedrooms: ${input.bedrooms ?? 'not provided'}
Bathrooms: ${input.bathrooms ?? 'not provided'}
Square feet: ${input.squareFeet ?? 'not provided'}
Current or purchase value: ${input.propertyValue ?? 'not provided'}
User-entered monthly rent, if any: ${input.monthlyRent ?? 'not provided'}
Return one bounded planning estimate, not a range, and explain uncertainty in summary and dataGaps.`;

  try {
    const result = await generateAiResponse({
      systemPrompt,
      userMessage,
      context: { property: input },
      enableWebSearch: true
    });
    const parsed = extractJson(result.text);
    if (!parsed) throw new Error('AI response did not contain valid JSON');
    return normalizePropertyEstimate(parsed, input, {
      source: 'ai_web_research',
      sources: result.sources || [],
      asOf: new Date().toISOString()
    });
  } catch (error) {
    return {
      ...fallback,
      dataGaps: [...fallback.dataGaps, `AI research fallback: ${error.message}`].slice(0, 10)
    };
  }
}
