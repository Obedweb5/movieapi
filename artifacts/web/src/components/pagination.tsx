import Link from "next/link";

export function Pagination({
  page,
  totalPages,
  buildHref,
}: {
  page: number;
  totalPages: number;
  buildHref: (page: number) => string;
}) {
  if (totalPages <= 1) return null;

  return (
    <nav className="mt-12 flex items-center justify-between text-sm text-muted">
      {page > 1 ? (
        <Link href={buildHref(page - 1)} className="hover:text-marquee">
          ← Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-muted-dim">
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={buildHref(page + 1)} className="hover:text-marquee">
          Next →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
