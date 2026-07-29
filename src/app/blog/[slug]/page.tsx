import Link from "next/link";
import { notFound } from "next/navigation";
import { getBlog } from "@/lib/store";
import { PERSONAS } from "@/lib/agents/personas";
import { Avatar } from "@/components/Avatar";
export const dynamic = "force-dynamic";
export default async function BlogPost({ params }: { params: { slug: string } }) {
  const post = await getBlog(params.slug);
  if (!post) notFound();
  const author = PERSONAS[post.author];
  return (
    <article className="container-x max-w-3xl py-14">
      <Link href="/" className="font-mono text-xs text-sage hover:text-ink">← Back to the desk</Link>
      <div className="mt-6 flex items-center gap-2">
        <span className="chip border border-brass/30 text-brass">{post.pick.symbol}</span>
        <span className="chip">{post.pick.growthTier} growth</span>
        <span className="font-mono text-xs text-sage">{new Date(post.date).toLocaleDateString()}</span>
      </div>
      <h1 className="mt-4 font-display text-4xl font-black leading-tight sm:text-5xl">{post.title}</h1>
      <p className="mt-3 text-lg text-ink/70">{post.dek}</p>
      <div className="mt-6 flex items-center gap-3 border-y border-line py-4">
        <Avatar id={author.id} accent={author.accent} size={44} />
        <div>
          <div className="font-display font-bold">{author.name}</div>
          <div className="font-mono text-[11px] uppercase tracking-wider text-sage">{author.title} · {post.engine === "claude" ? "written by Claude" : "simulation"}</div>
        </div>
      </div>
      <div className="prose mt-8 space-y-5 text-[17px] leading-relaxed text-ink/85">
        {post.body.map((p, i) => <p key={i}>{p}</p>)}
      </div>
      <div className="mt-10 rounded-xl2 border border-line bg-ivory2/50 p-5 text-sm text-ink/70">
        This is an automated research note for education only — not personal investment advice.
        Want a portfolio built around your goals? <Link href="/build" className="font-medium text-brass underline">Start the intake →</Link>
      </div>
    </article>
  );
}
