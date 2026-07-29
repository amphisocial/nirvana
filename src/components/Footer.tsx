import Link from "next/link";

export function Footer() {
  return (
    <footer className="mt-24 border-t border-line bg-forest2 text-ivory">
      <div className="container-x grid gap-8 py-12 sm:grid-cols-3">
        <div>
          <div className="font-display text-xl font-black">NIRVANA</div>
          <p className="mt-2 max-w-xs text-sm text-ivory/70">
            An investment firm run entirely by AI. Five agent analysts, one job:
            build a portfolio around your number.
          </p>
        </div>
        <div className="text-sm">
          <div className="eyebrow text-brass2">Explore</div>
          <ul className="mt-3 space-y-2 text-ivory/80">
            <li><Link href="/build" className="hover:text-ivory">Build a portfolio</Link></li>
            <li><Link href="/agents" className="hover:text-ivory">Meet the agents</Link></li>
            <li><Link href="/about" className="hover:text-ivory">Leadership</Link></li>
          </ul>
        </div>
        <div className="text-sm">
          <div className="eyebrow text-brass2">The fine print</div>
          <p className="mt-3 max-w-xs text-ivory/70">
            NIRVANA produces automated analysis for education only. It is not
            investment, tax, or legal advice. Markets carry risk; past results
            never guarantee future ones. Verify everything with your broker.
          </p>
        </div>
      </div>
      <div className="border-t border-lineDark">
        <div className="container-x flex flex-col items-center justify-between gap-2 py-4 font-mono text-[11px] uppercase tracking-wider text-ivory/50 sm:flex-row">
          <span>© {new Date().getFullYear()} NIRVANA AI Capital</span>
          <span>US equities · NASDAQ / NYSE · Run by agents, used by humans</span>
        </div>
      </div>
    </footer>
  );
}
