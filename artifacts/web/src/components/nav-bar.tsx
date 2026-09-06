"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import {
  SignedIn,
  SignedOut,
  SignInButton,
  UserButton,
} from "@clerk/nextjs";
import clsx from "clsx";

const links = [
  { href: "/browse", label: "Browse" },
  { href: "/browse?type=movie", label: "Films" },
  { href: "/browse?type=series", label: "Series" },
  { href: "/my", label: "My list" },
];

export function NavBar() {
  const pathname = usePathname();

  return (
    <header className="rule-b sticky top-0 z-30 bg-ink/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-3 px-6 py-4">
        <Link
          href="/"
          className="font-display text-2xl italic tracking-tight text-paper"
        >
          Late Edition
        </Link>

        <nav className="flex flex-wrap items-center gap-6 text-sm">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={clsx(
                "border-b border-transparent pb-0.5 text-muted transition-colors hover:border-marquee hover:text-text",
                pathname === link.href.split("?")[0] && "text-text",
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <form
          action="/browse"
          method="get"
          className="ml-auto flex min-w-[14rem] flex-1 items-center gap-2 border-b border-line pb-1 sm:flex-none sm:basis-64"
        >
          <Search className="h-4 w-4 shrink-0 text-muted-dim" aria-hidden />
          <input
            type="search"
            name="query"
            placeholder="Search the programme"
            className="w-full bg-transparent text-sm text-text placeholder:text-muted-dim focus:outline-none"
          />
        </form>

        <div className="flex items-center gap-4">
          <SignedOut>
            <SignInButton mode="modal">
              <button className="text-sm text-muted transition-colors hover:text-marquee">
                Sign in
              </button>
            </SignInButton>
          </SignedOut>
          <SignedIn>
            <UserButton afterSignOutUrl="/" />
          </SignedIn>
        </div>
      </div>
    </header>
  );
}
