import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { AdminChrome } from "@/components/admin/AdminChrome";

export const metadata: Metadata = {
  title: { default: "Espace équipe", template: "%s · Espace équipe Sigma" },
  robots: { index: false, follow: false },
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
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
