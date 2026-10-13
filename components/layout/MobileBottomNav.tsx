"use client";

import { CircleUserRound, Heart, Luggage, Search, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/cn";

export type BottomNavItem = "explore" | "wishlists" | "trips" | "login";

const ITEMS: { id: BottomNavItem; href: string; label: string; Icon: LucideIcon }[] = [
  { id: "explore", href: "/", label: "Explorer", Icon: Search },
  { id: "wishlists", href: "/wishlists", label: "Favoris", Icon: Heart },
  { id: "login", href: "/login", label: "Connexion", Icon: CircleUserRound },
];
const TRIPS = { id: "trips", href: "/trips", label: "Voyages", Icon: Luggage } as const;

/**
 * Fixed bottom tab bar under 744px; hides while scrolling down, returns on scroll up.
 * The active tab is passed in rather than read from the URL, so dynamic routes can still prerender it.
 */
export function MobileBottomNav({ active }: { active: BottomNavItem }) {
  const signedIn = !!useSession().data;
  const items = signedIn ? [...ITEMS.slice(0, 2), TRIPS] : ITEMS;
  const [hidden, setHidden] = useState(false);
  const last = useRef(0);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setHidden(y > last.current && y > 120);
      last.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      aria-label="Navigation principale"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 flex h-16 items-center justify-center gap-12 border-t border-line-soft bg-white transition-transform duration-300 ease-standard md:hidden",
        hidden && "translate-y-full",
      )}
    >
      {items.map(({ id, href, label, Icon }) => {
        const on = id === active;
        return (
          <Link key={id} href={href} aria-current={on ? "page" : undefined} className={cn("flex flex-col items-center gap-1 text-[10px] font-medium", on ? "text-brand" : "text-ink-muted")}>
            <Icon className="size-6" strokeWidth={on ? 2.4 : 1.75} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
