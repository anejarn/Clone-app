"use client";

import { Compass, ConciergeBell, House, PartyPopper, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const TABS: { href: string; label: string; Icon: LucideIcon; tint: string }[] = [
  { href: "/", label: "Tout voir", Icon: Compass, tint: "text-[#c78a1e]" },
  { href: "/homes", label: "Logements", Icon: House, tint: "text-[#d1495b]" },
  { href: "/experiences", label: "Expériences", Icon: PartyPopper, tint: "text-[#e2711d]" },
  { href: "/services", label: "Services", Icon: ConciergeBell, tint: "text-[#4a5568]" },
];

export function CategoryTabs({ variant }: { variant: "bar" | "chips" }) {
  const pathname = usePathname();
  if (variant === "chips") {
    return (
      <nav aria-label="Catégories" className="no-scrollbar -mx-6 flex gap-2 overflow-x-auto px-6 pb-3">
        {TABS.map(({ href, label, Icon, tint }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-10 shrink-0 items-center gap-1.5 rounded-pill border pl-2.5 pr-3.5 font-medium",
                active ? "border-ink shadow-[inset_0_0_0_1px_var(--color-ink)]" : "border-line",
              )}
            >
              <Icon className={cn("size-5", tint)} strokeWidth={1.75} />
              {label}
            </Link>
          );
        })}
      </nav>
    );
  }
  return (
    <nav aria-label="Catégories" className="flex h-full items-stretch gap-2 lg:gap-6">
      {TABS.map(({ href, label, Icon, tint }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-2.5 px-2 font-medium transition-colors duration-200",
              active ? "text-ink" : "text-ink-muted hover:text-ink",
            )}
          >
            <Icon className={cn("size-8 transition-transform duration-300 ease-standard group-hover:scale-110", tint)} strokeWidth={1.5} />
            {label}
            <span
              aria-hidden
              className={cn(
                "absolute inset-x-0 bottom-[18px] h-[3px] rounded-full bg-ink transition-opacity",
                active ? "opacity-100" : "opacity-0",
              )}
            />
          </Link>
        );
      })}
    </nav>
  );
}
