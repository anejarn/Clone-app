"use client";

import { CalendarDays, CalendarRange, Home, LayoutDashboard, LogOut, ShieldCheck, Tags, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogoMark } from "@/components/layout/Logo";
import type { AdminPath } from "@/lib/admin/sections";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/cn";

const ICONS: Record<AdminPath, typeof Home> = {
  "/admin": LayoutDashboard,
  "/admin/biens": Home,
  "/admin/reservations": CalendarRange,
  "/admin/reservations/nouvelle": CalendarRange,
  "/admin/calendrier": CalendarDays,
  "/admin/prix": Tags,
  "/admin/utilisateurs": Users,
  "/admin/securite": ShieldCheck,
};

export interface NavItem {
  href: AdminPath;
  label: string;
  ready: boolean;
}

const ROLE_LABEL = { ADMIN: "Associé", AGENT: "Agent terrain" } as const;

/**
 * Back-office navigation: a sidebar from lg up, a top bar with a scrollable row of sections on phones. The items
 * are those the server allowed for the user's role (navFor); hiding the others is cosmetic, each page checks
 * access again.
 */
export function AdminNav({ items, user }: { items: NavItem[]; user: { name: string; role: "ADMIN" | "AGENT" } }) {
  const pathname = usePathname();
  const router = useRouter();
  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`));

  async function signOut() {
    await authClient.signOut();
    router.replace("/login");
    router.refresh();
  }

  const links = items.map((it) => {
    const Icon = ICONS[it.href];
    const active = isActive(it.href);
    return (
      <li key={it.href} className="shrink-0">
        <Link
          href={it.href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex items-center gap-3 whitespace-nowrap rounded-sm px-3 py-2.5 font-medium transition-colors",
            active ? "bg-brand text-white" : "text-ink hover:bg-brand-tint",
          )}
        >
          <Icon className="size-[18px] shrink-0" strokeWidth={2} aria-hidden="true" />
          <span>{it.label}</span>
          {!it.ready && (
            <span className={cn("ml-auto rounded-pill px-2 py-0.5 text-micro font-semibold", active ? "bg-white/20" : "bg-surface-3 text-ink-muted")}>
              Bientôt
            </span>
          )}
        </Link>
      </li>
    );
  });

  return (
    <aside className="border-b border-line bg-white lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-64 lg:shrink-0 lg:flex-col lg:border-b-0 lg:border-r">
      <div className="flex items-center justify-between gap-3 px-4 py-3 lg:px-5 lg:py-5">
        <Link href="/admin" className="flex items-center gap-2 text-brand" aria-label="Sigma, espace équipe">
          <LogoMark className="size-7" />
          <span className="text-title-s font-bold tracking-[-0.3px]">sigma</span>
          <span className="rounded-pill bg-brand-tint px-2 py-0.5 text-micro font-semibold text-brand-strong">Équipe</span>
        </Link>
        <button type="button" onClick={signOut} className="flex items-center gap-1.5 rounded-sm px-2 py-2 text-body font-medium hover:bg-surface-3 lg:hidden">
          <LogOut className="size-4" aria-hidden="true" />
          Déconnexion
        </button>
      </div>
      <nav aria-label="Espace équipe" className="lg:flex-1 lg:overflow-y-auto">
        <ul className="no-scrollbar flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:px-3 lg:pb-0">{links}</ul>
      </nav>
      <div className="hidden border-t border-line p-4 lg:block">
        <p className="truncate font-semibold">{user.name}</p>
        <p className="text-micro text-ink-muted">{ROLE_LABEL[user.role]}</p>
        <div className="mt-3 flex flex-col gap-1">
          <Link
            href="/admin/securite"
            aria-current={isActive("/admin/securite") ? "page" : undefined}
            className="flex items-center gap-2 rounded-sm px-2 py-2 text-body hover:bg-surface-3 aria-[current=page]:font-semibold"
          >
            <ShieldCheck className="size-4" aria-hidden="true" />
            Sécurité du compte
          </Link>
          <button type="button" onClick={signOut} className="flex items-center gap-2 rounded-sm px-2 py-2 text-left text-body hover:bg-surface-3">
            <LogOut className="size-4" aria-hidden="true" />
            Déconnexion
          </button>
        </div>
      </div>
    </aside>
  );
}
