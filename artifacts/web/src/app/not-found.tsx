import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-6 py-24 text-center">
      <p className="text-sm uppercase tracking-[0.2em] text-marquee">
        Off the programme
      </p>
      <h1 className="mt-3 font-display text-4xl italic text-paper">
        We couldn&apos;t find that page.
      </h1>
      <p className="mt-4 text-muted">
        It may have been removed from the catalogue, or the link is wrong.
      </p>
      <Link
        href="/"
        className="mt-8 inline-block border-b border-marquee pb-1 text-sm text-marquee hover:text-paper"
      >
        Back to tonight&apos;s programme
      </Link>
    </div>
  );
}
