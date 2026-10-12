import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { getPlaces } from "@/lib/data/repo";

export const metadata: Metadata = { title: "Connexion" };

export default function Page() {
  return (
    <>
      <Header variant="compact" places={getPlaces()} />
      <main className="gutter mx-auto max-w-[568px] py-16 text-center">
        <h1 className="text-title-l font-semibold">Connexion ou inscription</h1>
        <p className="mt-3 text-ink-muted">Les comptes arrivent bientôt. En attendant, vos favoris sont enregistrés sur cet appareil.</p>
        <Link href="/" className="mt-8 inline-flex h-12 items-center rounded-sm bg-brand-gradient px-6 font-semibold text-white">
          Continuer à explorer
        </Link>
      </main>
      <MobileBottomNav active="login" />
    </>
  );
}
