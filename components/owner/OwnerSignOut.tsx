"use client";

import { LogOut } from "lucide-react";
import { signOut } from "@/lib/sign-out";

/** The portal's sign-out button (label in the owner's language, passed by the server). */
export function OwnerSignOut({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={async () => {
        // A full page load: nothing of the portal stays in memory.
        if (await signOut()) window.location.assign(new URL("/login", window.location.origin));
      }}
      className="inline-flex h-10 items-center gap-1.5 rounded-sm px-2 text-caption font-medium text-ink-muted hover:bg-surface-2 hover:text-ink"
    >
      <LogOut className="size-4 rtl:-scale-x-100" aria-hidden="true" />
      {label}
    </button>
  );
}
