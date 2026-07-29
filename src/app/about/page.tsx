import Link from "next/link";
import { PERSONA_LIST, UPDATER } from "@/lib/agents/personas";
import { Avatar } from "@/components/Avatar";
import { SectionLabel } from "@/components/ui";

export const metadata = { title: "About — NIRVANA leadership" };

export default function AboutPage() {
  return (
    <div>
      <section className="border-b border-line bg-forest2 text-ivory">
        <div className="container-x py-20">
          <span className="eyebrow text-brass2">About the firm</span>
          <h1 className="mt-4 max-w-3xl font-display text-4xl font-black leading-tight sm:text-6xl">
            We built a wealth-management firm, then hired only AI to run it.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-ivory/80">
            NIRVANA is an experiment in what a modern investment desk looks like when every seat is
            filled by an agent. Five specialists handle research, risk, debate, testing and construction.
            They never sleep, never chase a hot tip, and never let a story override the numbers. The only
            human in the building is the administrator who keeps the lights on.
          </p>
          <div className="mt-8 grid max-w-2xl grid-cols-3 gap-4 font-mono text-sm text-ivory/70">
            <div><div className="font-display text-3xl font-black text-ivory">5</div>AI analysts</div>
            <div><div className="font-display text-3xl font-black text-ivory">2</div>listings covered</div>
            <div><div className="font-display text-3xl font-black text-ivory">24/7</div>research cycle</div>
          </div>
        </div>
      </section>

      <section className="container-x py-16">
        <SectionLabel n="—">The leadership team</SectionLabel>
        <div className="mt-8 space-y-6">
          {PERSONA_LIST.map((p, i) => (
            <div key={p.id} className="grid items-center gap-6 rounded-xl2 border border-line bg-white/50 p-6 md:grid-cols-[auto_1fr] md:p-8">
              <div className={`flex items-center gap-4 ${i % 2 ? "md:order-2" : ""}`}>
                <Avatar id={p.id} accent={p.accent} size={112} />
                <div className="md:hidden">
                  <h3 className="font-display text-xl font-black">{p.name}</h3>
                  <div className="font-mono text-[11px] uppercase tracking-wider text-sage">{p.title}</div>
                </div>
              </div>
              <div className={i % 2 ? "md:order-1" : ""}>
                <div className="hidden md:block">
                  <div className="flex items-center gap-3">
                    <h3 className="font-display text-2xl font-black">{p.name}</h3>
                    <span className="chip" style={{ borderColor: p.accent, color: p.accent }}>{p.desk}</span>
                  </div>
                  <div className="font-mono text-[11px] uppercase tracking-wider text-sage">{p.title}</div>
                </div>
                <p className="mt-3 text-[15px] leading-relaxed text-ink/80">{p.bio}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {p.focus.map((f) => <span key={f} className="chip">{f}</span>)}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 flex items-center gap-4 rounded-xl2 border border-dashed border-line bg-ivory2/40 p-6">
          <Avatar id="risk" accent={UPDATER.accent} size={72} />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-display text-xl font-black">{UPDATER.name}</h3>
              <span className="chip">Operations</span>
            </div>
            <div className="font-mono text-[11px] uppercase tracking-wider text-sage">{UPDATER.title}</div>
            <p className="mt-2 max-w-2xl text-sm text-ink/70">
              Leo isn't on the investment committee — he runs the back office. When you save a
              recommendation, he re-prices it on demand and reports exactly how much it's up or down
              from the day you locked it in.
            </p>
          </div>
        </div>
      </section>

      <section className="border-t border-line bg-ivory2/50">
        <div className="container-x flex flex-col items-center gap-4 py-14 text-center">
          <h2 className="font-display text-3xl font-black">Ready to put the team to work?</h2>
          <p className="max-w-xl text-ink/70">Give the desk a number and watch all five build a portfolio around it — or start by talking to just one.</p>
          <div className="flex gap-3">
            <Link href="/build" className="btn-brass">Build a portfolio</Link>
            <Link href="/agents" className="btn-ghost">Talk to an analyst</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
