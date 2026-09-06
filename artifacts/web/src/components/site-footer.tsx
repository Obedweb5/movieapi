import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="rule px-6 py-10 text-sm text-muted-dim">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
        <p className="font-display italic text-muted">
          Late Edition — tonight&apos;s programme.
        </p>
        <div className="flex gap-6">
          <Link href="/browse" className="hover:text-marquee">
            Browse
          </Link>
          <Link href="/my" className="hover:text-marquee">
            My list
          </Link>
          <Link href="/admin" className="hover:text-marquee">
            Admin
          </Link>
        </div>
      </div>
    </footer>
  );
}
