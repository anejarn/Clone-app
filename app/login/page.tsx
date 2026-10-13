import type { Metadata } from "next";
import { Suspense } from "react";
import { Header } from "@/components/layout/Header";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Connexion" };

export default function Page() {
  return (
    <>
      <Header variant="compact" />
      <main className="gutter mx-auto max-w-[480px] py-12">
        <Suspense>
          <LoginForm />
        </Suspense>
      </main>
      <MobileBottomNav active="login" />
    </>
  );
}
