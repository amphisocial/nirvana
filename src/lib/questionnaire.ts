import type { Answers } from "@/lib/types";
import { SECTORS } from "@/lib/market/universe";

export interface Question {
  id: keyof Answers;
  kind: "number" | "single" | "multi";
  prompt: string;
  help?: string;
  by: string; // which agent is "asking"
  options?: { value: string; label: string; note?: string }[];
}

// The intake interview. Questions are asked one at a time; the next set is
// computed from prior answers so the conversation adapts — the way an
// analyst would probe before committing capital. Phase 1 branching is
// deterministic; phase 2 can let an agent generate a bespoke follow-up.
export function nextQuestions(a: Partial<Answers>): Question[] {
  const q: Question[] = [];

  if (a.amount == null) {
    q.push({
      id: "amount",
      kind: "number",
      by: "Priya Nair",
      prompt: "How much are you looking to put to work?",
      help: "This is the amount the desk will build a portfolio around. You can start small.",
    });
    return q;
  }

  if (!a.horizon) {
    q.push({
      id: "horizon",
      kind: "single",
      by: "Dr. Maya Chen",
      prompt: "When do you expect to need this money?",
      options: [
        { value: "short", label: "Within ~2 years", note: "Short horizon" },
        { value: "medium", label: "2–7 years", note: "Medium horizon" },
        { value: "long", label: "7+ years", note: "Long horizon" },
      ],
    });
    return q;
  }

  if (!a.goal) {
    q.push({
      id: "goal",
      kind: "single",
      by: "Dr. Maya Chen",
      prompt: "What's the job of this money?",
      options: [
        { value: "growth", label: "Grow it as much as possible" },
        { value: "balanced", label: "Grow steadily, don't swing wildly" },
        { value: "income", label: "Produce income / dividends" },
        { value: "preserve", label: "Protect it, modest growth is fine" },
      ],
    });
    return q;
  }

  if (!a.riskComfort) {
    q.push({
      id: "riskComfort",
      kind: "single",
      by: "Marcus Reed",
      prompt: "If this portfolio dropped 20% in a month, what would you do?",
      help: "Be honest — this sets your risk budget more than anything else.",
      options: [
        { value: "low", label: "Sell — I couldn't stomach it", note: "Low" },
        { value: "medium", label: "Hold and wait it out", note: "Medium" },
        { value: "high", label: "Buy more — it's on sale", note: "High" },
      ],
    });
    return q;
  }

  // --- adaptive follow-ups -------------------------------------------------

  // High risk comfort + long horizon → probe how much drawdown is truly ok.
  if (
    (a.riskComfort === "high" || a.goal === "growth") &&
    a.drawdownTolerance == null
  ) {
    q.push({
      id: "drawdownTolerance",
      kind: "single",
      by: "Marcus Reed",
      prompt: "What's the deepest paper loss you could hold through?",
      help: "Growth portfolios can fall hard before they recover. Marcus needs a real number.",
      options: [
        { value: "5", label: "~5% — keep me steady" },
        { value: "15", label: "~15% — normal ups and downs" },
        { value: "30", label: "~30% — I'm in it for the long game" },
      ],
    });
    return q;
  }

  // Income goal → ask if they need to draw income now.
  if (a.goal === "income" && a.incomeNeed == null) {
    q.push({
      id: "incomeNeed",
      kind: "single",
      by: "Priya Nair",
      prompt: "Do you need to draw this income now, or reinvest it?",
      options: [
        { value: "yes", label: "I need the income now" },
        { value: "no", label: "Reinvest it for me" },
      ],
    });
    return q;
  }

  // Larger amounts → ask about existing concentration (tax/overlap matters).
  if ((a.amount ?? 0) >= 25000 && a.existingConcentration == null) {
    q.push({
      id: "existingConcentration",
      kind: "single",
      by: "Marcus Reed",
      prompt: "Do you already hold a lot of any one thing?",
      help: "So the desk doesn't double you up on risk you already carry.",
      options: [
        { value: "none", label: "No, starting fresh" },
        { value: "tech", label: "Heavy in tech / my employer" },
        { value: "diversified", label: "Already fairly diversified" },
      ],
    });
    return q;
  }

  // Everyone gets a sector-preference pass and an experience read.
  if (a.experience == null) {
    q.push({
      id: "experience",
      kind: "single",
      by: "Sofia Alvarez",
      prompt: "How would you describe your investing experience?",
      help: "It changes how much the desk explains, not what it recommends.",
      options: [
        { value: "new", label: "New to this" },
        { value: "some", label: "I've invested before" },
        { value: "seasoned", label: "Seasoned" },
      ],
    });
    return q;
  }

  if (a.sectors == null) {
    q.push({
      id: "sectors",
      kind: "multi",
      by: "Dr. Maya Chen",
      prompt: "Any sectors you especially want — or want to avoid?",
      help: "Optional. Pick any you're drawn to; leave blank to let Research decide.",
      options: SECTORS.map((s) => ({ value: s, label: s })),
    });
    return q;
  }

  if (a.esg == null) {
    q.push({
      id: "esg",
      kind: "single",
      by: "Sofia Alvarez",
      prompt: "Should the desk lean toward sustainable / ESG-friendly names?",
      options: [
        { value: "yes", label: "Yes, tilt sustainable" },
        { value: "no", label: "No preference" },
      ],
    });
    return q;
  }

  return []; // interview complete
}

export function interviewComplete(a: Partial<Answers>): a is Answers {
  return nextQuestions(a).length === 0;
}

export function totalSteps(): number {
  return 9; // upper bound used for the progress bar
}
