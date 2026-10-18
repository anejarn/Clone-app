import type { MetadataRoute } from "next";

/**
 * The web app manifest of the team's app (Sigma Équipe), served at /equipe.webmanifest (app/equipe.webmanifest/route.ts)
 * and linked from the back-office only (app/admin/layout.tsx), so that an agent can install « Ma journée » on the
 * phone's home screen. The public site has none. Icons: the Sigma mark (app/icon.svg) in PNG, public/icons/.
 */
export const MY_DAY_MANIFEST: MetadataRoute.Manifest = {
  id: "/admin/ma-journee",
  name: "Sigma Équipe · Ma journée",
  short_name: "Sigma Équipe",
  description: "Les tâches du jour de l'équipe terrain Sigma, même sans réseau.",
  lang: "fr",
  dir: "ltr",
  start_url: "/admin/ma-journee",
  scope: "/admin/",
  display: "standalone",
  orientation: "portrait",
  background_color: "#ffffff",
  theme_color: "#3550a8",
  categories: ["business", "productivity"],
  icons: [
    { src: "/icons/sigma-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/sigma-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icons/sigma-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
  ],
};
