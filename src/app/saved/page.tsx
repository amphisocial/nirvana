import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { SectionLabel } from "@/components/ui";
import { SignInPrompt } from "@/components/SignInPrompt";
import { SavedPortfolios } from "@/components/SavedPortfolios";

export const dynamic = "force-dynamic";
export const metadata = { title: "My Portfolios — NIRVANA" };

export default async function SavedPage() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;

  if (!email) {
    return (
      <div className="container-x max-w-lg py-20 text-center">
        <h1 className="font-display text-3xl font-bold">My Portfolios</h1>
        <p className="mt-2 text-ink/70">Sign in with Google to see the portfolios you've saved and track their gains over time.</p>
        <div className="mt-6 flex justify-center"><SignInPrompt callbackUrl="/saved" /></div>
      </div>
    );
  }

  return (
    <div className="container-x py-12">
      <div className="flex items-center justify-between">
        <SectionLabel n="—">My Portfolios</SectionLabel>
      </div>
      <p className="mt-3 text-sm text-sage">Signed in as {email} · every recommendation you've saved, with live gain/loss.</p>
      <SavedPortfolios />
    </div>
  );
}
