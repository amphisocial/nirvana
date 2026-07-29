"use client";
import { useSession, signIn, signOut } from "next-auth/react";
import Link from "next/link";
import { useState } from "react";

export function AuthButton() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);

  if (status === "loading") {
    return <span className="h-8 w-8 animate-pulse rounded-full bg-line" />;
  }

  if (!session?.user) {
    return (
      <button onClick={() => signIn("google")} className="btn-ghost text-sm" aria-label="Sign in with Google">
        <GoogleMark /> Sign in
      </button>
    );
  }

  const initial = (session.user.name || session.user.email || "?").charAt(0).toUpperCase();
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2" aria-haspopup="menu" aria-expanded={open}>
        {session.user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={session.user.image} alt="" className="h-8 w-8 rounded-full ring-1 ring-line" />
        ) : (
          <span className="grid h-8 w-8 place-items-center rounded-full bg-brand text-sm font-semibold text-white">{initial}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 rounded-xl border border-line bg-white p-2 shadow-card" role="menu">
          <div className="px-3 py-2">
            <div className="truncate text-sm font-medium">{session.user.name}</div>
            <div className="truncate text-xs text-sage">{session.user.email}</div>
          </div>
          <div className="rule my-1" />
          <Link href="/saved" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm hover:bg-ink/5" role="menuitem">My portfolios</Link>
          <button onClick={() => signOut({ callbackUrl: "/" })} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-loss hover:bg-loss/5" role="menuitem">Sign out</button>
        </div>
      )}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.8-.4-4H24v7.3h11.9c-.2 1.9-1.5 4.9-4.4 6.9l6.7 5.2c4-3.7 6.9-9.1 6.9-15.4z"/>
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.3c-1.9 1.3-4.4 2.2-7.6 2.2-5.8 0-10.7-3.9-12.5-9.2l-7.1 5.5C7.6 40.8 15.2 46 24 46z"/>
      <path fill="#FBBC05" d="M11.5 28.4c-.5-1.4-.7-2.9-.7-4.4s.3-3 .7-4.4l-7.1-5.5C2.9 17 2 20.4 2 24s.9 7 2.4 9.9l7.1-5.5z"/>
      <path fill="#EA4335" d="M24 10.4c3.2 0 5.4 1.4 6.6 2.5l5.9-5.8C32.9 3.8 28.9 2 24 2 15.2 2 7.6 7.2 4.4 14.1l7.1 5.5C13.3 14.3 18.2 10.4 24 10.4z"/>
    </svg>
  );
}
