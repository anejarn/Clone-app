import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { CookieConsent } from "@/components/layout/CookieConsent";
import { WishlistSync } from "@/components/layout/WishlistSync";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "Nidou | Locations de vacances, cabanes, maisons de plage, etc.",
    template: "%s · Nidou",
  },
  description:
    "Trouvez des locations de vacances, des expériences et des services partout en France et dans le monde.",
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
