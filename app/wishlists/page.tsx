import type { Metadata } from "next";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { getPlaces } from "@/lib/data/repo";
import { SavedGrid } from "./SavedGrid";

export const metadata: Metadata = { title: "Favoris" };

export default function Page() {
  return (
    <>
      <Header variant="compact" places={getPlaces()} />
      <main className="gutter mx-auto min-h-[60vh] max-w-[1760px] pb-16 pt-8">
        <h1 className="mb-8 text-display font-semibold">Favoris</h1>
        <SavedGrid />
      </main>
      <Footer />
      <MobileBottomNav active="wishlists" />
    </>
  );
}
