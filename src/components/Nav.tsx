import Link from "next/link";
import { AuthButton } from "./AuthButton";

export function Nav() {
  const links = [
    { href: "/build", label: "Build a portfolio" },
    { href: "/saved", label: "My Portfolios" },
    { href: "/agents", label: "The agents" },
    { href: "/about", label: "About us" },
    { href: "/admin", label: "Admin" },
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/90 backdrop-blur">
      <div className="container-x flex h-16 items-center justify-between">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-display text-2xl font-extrabold tracking-tight text-brand">NIRVANA</span>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.25em] text-sage sm:inline">AI Capital</span>
        </Link>
        <nav className="hidden items-center gap-7 md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="text-sm text-ink/70 transition-colors hover:text-brand">{l.label}</Link>
          ))}
          <Link href="/build" className="btn-brass text-sm">Start</Link>
          <AuthButton />
        </nav>
        <div className="flex items-center gap-3 md:hidden">
          <Link href="/build" className="btn-brass text-sm">Start</Link>
          <AuthButton />
        </div>
      </div>
    </header>
  );
}
