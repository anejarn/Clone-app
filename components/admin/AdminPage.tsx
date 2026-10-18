import { Construction } from "lucide-react";
import type { ReactNode } from "react";

/** Title row and body of a back-office page. */
export function AdminPage({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-6 md:px-8 md:py-10">
      <h1 className="text-title-l font-semibold md:text-display">{title}</h1>
      {intro && <p className="mt-2 max-w-2xl text-ink-muted">{intro}</p>}
      <div className="mt-6 md:mt-8">{children}</div>
    </main>
  );
}

/** Body of a section that comes in a later lot. */
export function ComingSoon({ children }: { children: ReactNode }) {
  return (
    <div className="flex max-w-2xl items-start gap-4 rounded-lg border border-dashed border-sep bg-white p-5 md:p-6">
      <Construction className="mt-0.5 size-6 shrink-0 text-brand" aria-hidden="true" />
      <div>
        <p className="font-semibold">Bientôt disponible</p>
        <p className="mt-1 text-ink-muted">{children}</p>
      </div>
    </div>
  );
}

export function AdminPageFallback() {
  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-6 md:px-8 md:py-10" aria-busy="true">
      <p className="text-ink-muted">Chargement…</p>
    </main>
  );
}
