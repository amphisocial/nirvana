import { PERSONA_LIST } from "@/lib/agents/personas";
import { AgentsExplorer } from "@/components/AgentsExplorer";
export const dynamic = "force-dynamic";
export default function AgentsPage() {
  return (
    <div className="container-x py-12">
      <span className="eyebrow">The desk</span>
      <h1 className="mt-3 font-display text-4xl font-black sm:text-5xl">Talk to one analyst at a time.</h1>
      <p className="mt-3 max-w-2xl text-ink/70">
        Pick an employee, drop in a ticker, and run their analysis on that single name — or just chat.
        Each one stays in their lane: research, risk, debate, testing, construction.
      </p>
      <div className="mt-10"><AgentsExplorer personas={PERSONA_LIST} /></div>
    </div>
  );
}
