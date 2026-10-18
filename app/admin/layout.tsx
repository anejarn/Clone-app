import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { AdminChrome } from "@/components/admin/AdminChrome";
import { SyncBanner } from "@/components/admin/channels/SyncBanner";

export const metadata: Metadata = {
  title: { default: "Espace équipe", template: "%s · Espace équipe Sigma" },
  robots: { index: false, follow: false },
  // The team's app, installable on a phone (« Ma journée », usable offline): app/equipe.webmanifest/route.ts.
  manifest: "/equipe.webmanifest",
  appleWebApp: { capable: true, title: "Sigma Équipe", statusBarStyle: "default" },
  // Setting icons here replaces the file-based favicon (app/icon.svg) on these pages: name it again.
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }], apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = { themeColor: "#ffffff" };

/**
 * The back-office. Access is checked by each page (requireAdminPage), by every action and API handler, and first by
 * proxy.ts for visitors without a session; this layout only draws the frame.
 */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="min-h-dvh bg-surface-2 lg:flex">
      <Suspense fallback={<div className="h-[104px] border-b border-line bg-white lg:h-dvh lg:w-64 lg:border-b-0 lg:border-r" />}>
        <AdminChrome />
      </Suspense>
      <div className="min-w-0 flex-1">
        {/* Double bookings and broken platform calendars (Lot 7), for the associés. */}
        <Suspense fallback={null}>
          <SyncBanner />
        </Suspense>
        {children}
      </div>
    </div>
  );
}
