import { LogoMark } from "@/components/layout/Logo";
import { GUEST_LOCALES } from "@/lib/i18n/locales";
import { messages } from "@/lib/i18n/messages";

/** An unknown, revoked, replaced or expired guide link, or a cancelled stay: in every guest language (no locale known). */
export default function GuideNotFound() {
  return (
    <main className="gutter mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 py-10" data-testid="guide-not-found">
      <LogoMark className="size-10 text-brand" />
      {GUEST_LOCALES.map((l) => {
        const m = messages(l);
        return (
          <section key={l} lang={l}>
            {l === "fr" ? <h1 className="text-title-l font-semibold">{m.notFound.title}</h1> : <h2 className="text-title-s font-semibold">{m.notFound.title}</h2>}
            <p className="mt-1 text-ink-muted">{m.notFound.body}</p>
          </section>
        );
      })}
    </main>
  );
}
