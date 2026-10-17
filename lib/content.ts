import { NEIGHBOURHOODS } from "@/lib/neighbourhoods";
import type { InspirationTab, Service } from "@/lib/types";

/** Editorial content: changes with releases, not with bookings, so it lives in code rather than the database. */

/** Sigma's concierge services, as tiles on the home page. Labels only: none can be ordered online yet. */
export const services: Service[] = [
  ["voitures", "Location de voitures", "🚗"],
  ["transferts", "Transferts aéroport", "✈️"],
  ["excursions", "Excursions", "🏜️"],
  ["chef", "Chef à domicile", "👩‍🍳"],
  ["hammam", "Hammam et soins", "🧖"],
  ["menage", "Ménage", "🧹"],
  ["courses", "Courses livrées", "🛒"],
  ["photographe", "Photographe", "📷"],
].map(([slug, label, emoji]) => ({ slug, label, emoji }));

/** Each neighbourhood with the same search, so every link leads to real results. */
const byPlace = (kind: string, query = ""): InspirationTab["links"] =>
  NEIGHBOURHOODS.map(({ slug, name }) => ({ place: name, slug, kind, query }));

export const inspiration: InspirationTab[] = [
  {
    label: "Par quartier",
    links: NEIGHBOURHOODS.flatMap(({ slug, name }) => [
      { place: name, slug, kind: "Pour 2 voyageurs", query: "adults=2" },
      { place: name, slug, kind: "Pour 4 voyageurs ou plus", query: "adults=4" },
    ]),
  },
  { label: "En groupe", links: byPlace("6 voyageurs ou plus", "adults=6") },
  { label: "Avec un animal", links: byPlace("Animaux acceptés", "adults=1&pets=1") },
  { label: "Tous les logements", links: byPlace("Logements du quartier") },
];
