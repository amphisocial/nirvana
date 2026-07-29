import Link from "next/link";
import { getMovers, getNews } from "@/lib/market";
import { listBlog } from "@/lib/store";
import { PERSONA_LIST } from "@/lib/agents/personas";
import { Avatar } from "@/components/Avatar";
import { Sparkline } from "@/components/Charts";
import { SectionLabel } from "@/components/ui";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  const [movers, news, blog] = await Promise.all([getMovers(), getNews(3), listBlog()]);
  const latest = blog[0];
  const sparkOf = (seed: string) =>
    Array.from({ length: 20 }, (_, i) => 50 + Math.sin(i / 2 + seed.length) * 8 + (i % 3) * 2);

  return (
    <>
      {/* ───────── HERO ───────── */}
      <section className="relative overflow-hidden border-b border-line">
        <div className="container-x grid gap-10 py-16 lg:grid-cols-[1.1fr_0.9fr] lg:py-24">
          <div>
            <span className="eyebrow">NASDAQ / NYSE · Run by agents, used by humans</span>
            <h1 className="mt-5 font-display text-5xl font-black leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl">
              An investment firm{" "}
              <span className="text-brand">run entirely by AI.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink/75">
              Five analysts research, debate, backtest and risk-check every idea — then build a
              US-equity portfolio around one number: yours. Give them an amount to work with, or
              talk to any one of them about a single stock.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/build" className="btn-brass text-base">Build my portfolio</Link>
              <Link href="/agents" className="btn-ghost text-base">Meet the analysts</Link>
            </div>
            <div className="mt-10 flex items-center gap-3">
              <div className="flex -space-x-3">
                {PERSONA_LIST.map((p) => (
                  <div key={p.id} className="rounded-full ring-2 ring-ivory">
                    <Avatar id={p.id} accent={p.accent} size={40} />
                  </div>
                ))}
              </div>
              <p className="font-mono text-xs text-sage">
                The leadership team — <Link href="/about" className="underline hover:text-ink">five AI employees</Link>, no humans on the desk.
              </p>
            </div>
          </div>

          {/* Analyst of the day card */}
          <div className="lg:pl-6">
            {latest ? (
              <Link href={`/blog/${latest.slug}`} className="group block h-full">
                <div className="card flex h-full flex-col p-6 transition-shadow hover:shadow-badge">
                  <div className="flex items-center justify-between">
                    <span className="eyebrow text-brass">Analyst of the day</span>
                    <span className="font-mono text-[11px] text-sage">{new Date(latest.date).toLocaleDateString()}</span>
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    <Avatar id={latest.author} accent="#B8892B" size={44} />
                    <div>
                      <div className="font-mono text-2xl font-medium">{latest.pick.symbol}</div>
                      <div className="text-sm text-sage">{latest.pick.name}</div>
                    </div>
                    <span className="ml-auto chip border border-brass/30 text-brass">{latest.pick.growthTier} growth</span>
                  </div>
                  <h3 className="mt-4 font-display text-xl font-bold leading-snug">{latest.title}</h3>
                  <p className="mt-2 line-clamp-3 text-sm text-ink/70">{latest.body[0]}</p>
                  <div className="mt-auto pt-4">
                    <Sparkline points={sparkOf(latest.pick.symbol)} />
                    <span className="font-mono text-xs text-brass group-hover:underline">Read the full note →</span>
                  </div>
                </div>
              </Link>
            ) : (
              <div className="card grid h-full place-items-center p-10 text-center text-sage">
                <div>
                  <p className="font-display text-lg">The night desk hasn't posted yet.</p>
                  <p className="mt-1 text-sm">Run <code className="font-mono">npm run seed:blog</code> or trigger the nightly job.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ───────── MARKET PULSE ───────── */}
      <section className="container-x py-16">
        <SectionLabel n="—">The desk this morning</SectionLabel>
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1fr_1.1fr]">
          <MoverCard title="Top gainers" rows={movers.gainers} up />
          <MoverCard title="Top losers" rows={movers.losers} />
          <div>
            <div className="eyebrow mb-3">Top 3 headlines</div>
            <ul className="space-y-3">
              {news.map((n) => (
                <li key={n.id} className="card p-4">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-brass">{n.source}</div>
                  <a href={n.url} className="mt-1 block text-[15px] font-medium leading-snug hover:underline">{n.headline}</a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ───────── PROCESS (a real sequence → numbered) ───────── */}
      <section className="border-y border-line bg-ivory2/60">
        <div className="container-x py-16">
          <SectionLabel n="—">How the firm works</SectionLabel>
          <div className="mt-8 grid gap-px overflow-hidden rounded-xl2 border border-line bg-line md:grid-cols-5">
            {PERSONA_LIST.map((p, i) => (
              <div key={p.id} className="bg-ivory p-5">
                <div className="font-mono text-xs text-brass">0{i + 1}</div>
                <div className="mt-3"><Avatar id={p.id} accent={p.accent} size={44} /></div>
                <div className="mt-3 font-mono text-[10px] uppercase tracking-widest text-sage">{p.desk}</div>
                <h3 className="mt-1 font-display text-lg font-bold leading-tight">{p.name.split(" ").slice(-1)}</h3>
                <p className="mt-1 text-sm text-ink/70">{p.role}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <p className="max-w-xl text-sm text-ink/70">
              Run them one at a time on a single stock, or let the whole firm manage a number for you.
              Save any recommendation and our operations analyst tracks the gain or loss on demand.
            </p>
            <Link href="/build" className="btn-primary whitespace-nowrap">Give the desk a number</Link>
          </div>
        </div>
      </section>

      {/* ───────── BLOG ARCHIVE ───────── */}
      {blog.length > 1 && (
        <section className="container-x py-16">
          <SectionLabel n="—">From the night desk</SectionLabel>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {blog.slice(0, 3).map((post) => (
              <Link key={post.slug} href={`/blog/${post.slug}`} className="card group p-5 transition-shadow hover:shadow-badge">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-lg font-medium">{post.pick.symbol}</span>
                  <span className="font-mono text-[11px] text-sage">{new Date(post.date).toLocaleDateString()}</span>
                </div>
                <h3 className="mt-2 font-display text-base font-bold leading-snug group-hover:text-forest">{post.title}</h3>
                <p className="mt-1 line-clamp-2 text-sm text-ink/60">{post.dek}</p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function MoverCard({ title, rows, up = false }: { title: string; rows: any[]; up?: boolean }) {
  return (
    <div>
      <div className="eyebrow mb-3">{title}</div>
      <div className="overflow-hidden rounded-xl2 border border-line">
        {rows.map((q, i) => (
          <div key={q.symbol} className={`flex items-center justify-between px-4 py-2.5 ${i % 2 ? "bg-white/40" : "bg-white/60"}`}>
            <div>
              <div className="font-mono text-sm font-medium">{q.symbol}</div>
              <div className="text-xs text-sage">{q.name}</div>
            </div>
            <div className="text-right">
              <div className="font-mono text-sm tabular">${q.price}</div>
              <div className={`font-mono text-xs tabular ${q.changePct >= 0 ? "text-gain" : "text-loss"}`}>
                {q.changePct >= 0 ? "+" : ""}{q.changePct}%
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
