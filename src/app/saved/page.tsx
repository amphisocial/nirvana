import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listPortfoliosByUser } from "@/lib/store";
import { SectionLabel } from "@/components/ui";
import { SignInPrompt } from "@/components/SignInPrompt";

export const dynamic = "force-dynamic";
const money = (n: number) => "$" + Math.round(n).toLocaleString();

export default async function SavedPage() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;

  if (!email) {
    return (
      <div className="container-x max-w-lg py-20 text-center">
        <h1 className="font-display text-3xl font-bold">Your saved portfolios</h1>
        <p className="mt-2 text-ink/70">Sign in with Google to see the portfolios you've saved and track their gains.</p>
        <div className="mt-6 flex justify-center"><SignInPrompt /></div>
      </div>
    );
  }

  const items = await listPortfoliosByUser(email);
  return (
    <div className="container-x py-12">
      <SectionLabel n="—">Your saved portfolios</SectionLabel>
      <p className="mt-3 text-sm text-sage">Signed in as {email}</p>
      {items.length === 0 ? (
        <div className="mt-8 rounded-xl2 border border-dashed border-line bg-white p-10 text-center">
          <p className="font-display text-lg">Nothing saved yet.</p>
          <p className="mt-1 text-sm text-sage">Build a portfolio and hit “Save & follow” to track it here.</p>
          <Link href="/build" className="btn-brass mt-5">Build a portfolio</Link>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => (
            <Link key={p.id} href={`/portfolio/${p.id}`} className="card group p-5 transition-shadow hover:shadow-badge">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm text-sage">{new Date(p.createdAt).toLocaleDateString()}</span>
                <span className="chip">{p.answers.goal}</span>
              </div>
              <div className="mt-3 font-display text-2xl font-bold tabular">{money(p.answers.amount)}</div>
              <div className="mt-1 text-sm text-sage">{p.allocation.holdings.length} holdings · {p.answers.horizon}-term · {p.answers.riskComfort} risk</div>
              <div className="mt-4 font-mono text-xs text-brand group-hover:underline">Open tracker →</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
