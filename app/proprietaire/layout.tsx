import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Espace propriétaire", template: "%s · Espace propriétaire Sigma" },
  robots: { index: false, follow: false },
};

/**
 * The owner portal (Lot 6b). Access is checked by every page (requireOwnerPage, through ownerContext) and first by
 * proxy.ts for visitors without a session; each page draws its frame (OwnerFrame) in the owner's language.
 */
export default function OwnerLayout({ children }: LayoutProps<"/proprietaire">) {
  return children;
}
