import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { CookieConsent } from "@/components/layout/CookieConsent";
import { WishlistSync } from "@/components/layout/WishlistSync";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "Nidou | Appartements de ski à Orcières-Merlette 1850 et aux Orres",
    template: "%s · Nidou",
  },
  description:
    "Les appartements de ski d'Orcières-Merlette 1850 et des Orres\u00a0: arrivée n'importe quel jour, à partir de 2\u00a0nuits, prix tout compris avec vos dates, taxe de séjour incluse.",
};

export const viewport: Viewport = { themeColor: "#ffffff" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={inter.variable}>
      <body className="min-h-dvh">
        {children}
        <CookieConsent />
        <WishlistSync />
      </body>
    </html>
  );
}
