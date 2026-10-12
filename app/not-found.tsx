import Link from "next/link";
import { LogoMark } from "@/components/layout/Logo";

export default function NotFound() {
  return (
    <main className="gutter mx-auto flex min-h-dvh max-w-xl flex-col items-start justify-center gap-4">
      <LogoMark className="size-10 text-brand" />
      <h1 className="text-display font-semibold">Oups !</h1>
      <p className="text-body-l text-ink-muted">Nous ne trouvons pas la page que vous cherchez.</p>
      <Link href="/" className="font-semibold underline">
        Retour à l&apos;accueil
      </Link>
    </main>
  );
}
