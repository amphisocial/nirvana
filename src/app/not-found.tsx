import Link from "next/link";
export default function NotFound() {
  return (
    <div className="container-x grid min-h-[50vh] place-items-center py-20 text-center">
      <div>
        <div className="font-mono text-sm text-sage">404</div>
        <h1 className="mt-2 font-display text-4xl font-black">The desk couldn't find that.</h1>
        <Link href="/" className="btn-primary mt-6">Back to the firm</Link>
      </div>
    </div>
  );
}
