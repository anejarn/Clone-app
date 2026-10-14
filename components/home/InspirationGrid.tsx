"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/cn";
import type { InspirationTab } from "@/lib/types";

const COLLAPSED = 17;

export function InspirationGrid({ tabs }: { tabs: InspirationTab[] }) {
  const [tab, setTab] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const links = tabs[tab].links;
  const visible = expanded ? links : links.slice(0, COLLAPSED);

  return (
    <section className="bg-surface-2 pb-6 pt-12">
      <div className="gutter mx-auto max-w-[1760px]">
        <h2 className="mb-3 text-title font-semibold tracking-[-0.2px]">Des idées pour vos prochaines escapades</h2>
        <div role="tablist" className="no-scrollbar mb-7 flex gap-8 overflow-x-auto whitespace-nowrap border-b border-line">
          {tabs.map((t, i) => (
            <button
              key={t.label}
              role="tab"
              type="button"
              aria-selected={i === tab}
              onClick={() => {
                setTab(i);
                setExpanded(false);
              }}
              className={cn(
                "relative py-2.5 font-medium",
                i === tab ? "text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-ink" : "text-ink-muted hover:text-ink",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-4 lg:grid-cols-6">
          {visible.map((l) => (
            <Link key={`${l.slug}-${l.kind}`} href={`/s/${l.slug}/homes`} className="min-w-0">
              <span className="block truncate font-medium">{l.place}</span>
              <span className="block truncate text-ink-muted">{l.kind}</span>
            </Link>
          ))}
          {!expanded && links.length > COLLAPSED && (
            <button type="button" onClick={() => setExpanded(true)} className="flex items-center gap-1 self-start font-medium">
              Afficher plus <ChevronDown className="size-4" />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
