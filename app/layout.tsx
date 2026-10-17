import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { CookieConsent } from "@/components/layout/CookieConsent";
import { WishlistSync } from "@/components/layout/WishlistSync";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "Sigma · Locations et conciergerie à Marrakech",
    template: "%s · Sigma",
  },
  description: "Logements à Marrakech, quartier par quartier, avec les activités et les services de conciergerie de Sigma.",
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
