import { Wizard } from "@/components/Wizard";
export const dynamic = "force-dynamic";
export default function BuildPage() {
  return (
    <div>
      <div className="border-b border-line bg-ivory2/50">
        <div className="container-x py-10">
          <span className="eyebrow">The intake</span>
          <h1 className="mt-3 max-w-2xl font-display text-4xl font-black leading-tight sm:text-5xl">
            Before we invest a dollar, the desk asks a few questions.
          </h1>
          <p className="mt-3 max-w-xl text-ink/70">
            Just like any wealth manager would. Your answers set the risk budget and shape every
            recommendation. It adapts as you go — there are no wrong answers, only honest ones.
          </p>
        </div>
      </div>
      <Wizard />
    </div>
  );
}
