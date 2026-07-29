import { notFound } from "next/navigation";
import { getPortfolio } from "@/lib/store";
import { PortfolioView } from "@/components/PortfolioView";
export const dynamic = "force-dynamic";
export default async function PortfolioPage({ params }: { params: { id: string } }) {
  const rec = await getPortfolio(params.id);
  if (!rec) notFound();
  return <PortfolioView initial={rec} />;
}
