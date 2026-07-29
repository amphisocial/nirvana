import Link from "next/link";

export function Nav() {
  const links = [
    { href: "/build", label: "Build a portfolio" },
    { href: "/agents", label: "The agents" },
    { href: "/about", label: "About us" },
    { href: "/admin", label: "Admin" },
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ivory/85 backdrop-blur">
      <div className="container-x flex h-16 items-center justify-between">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-display text-2xl font-black tracking-tight">NIRVANA</span>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.25em] text-sage sm:inline">
            AI Capital
          </span>
        </Link>
        <nav className="hidden items-center gap-7 md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="text-sm text-ink/70 transition-colors hover:text-ink">
              {l.label}
            </Link>
          ))}
          <Link href="/build" className="btn-brass text-sm">Start</Link>
        </nav>
        <Link href="/build" className="btn-brass text-sm md:hidden">Start</Link>
      </div>
    </header>
  );
}
