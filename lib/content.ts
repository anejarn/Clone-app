import { slugify } from "@/lib/search/params";
import type { InspirationTab, Service } from "@/lib/types";

/** Editorial content: changes with releases, not with bookings, so it lives in code rather than the database. */

export const services: Service[] = [
  ["voitures", "Location de voitures", "🚗"],
  ["photographie", "Photographie", "📷"],
  ["chefs", "Chefs privés", "👩‍🍳"],
  ["massages", "Soins bien-être", "💆"],
  ["coach", "Coach sportif", "🧘"],
  ["beaute", "Beauté", "💅"],
  ["traiteur", "Service de traiteur", "🍱"],
  ["menage", "Ménage", "🧹"],
].map(([slug, label, emoji]) => ({ slug, label, emoji }));

const tab = (label: string, rows: [string, string][]): InspirationTab => ({
  label,
  links: rows.map(([place, kind]) => ({ place, kind, slug: slugify(place) })),
});

export const inspiration: InspirationTab[] = [
  tab("Équipements recherchés", [
    ["Poitiers", "Locations de vacances"], ["Arcachon", "Locations de vacances"], ["Limoges", "Locations de vacances"],
    ["L'Île d'Oléron", "Location de chalets"], ["Rouen", "Location de maisons de vacances"], ["Montpellier", "Locations de vacances"],
    ["Saint-Étienne", "Locations de vacances"], ["Marseille", "Locations de villas"], ["Menton", "Locations de vacances"],
    ["Caen", "Locations de cottages"], ["Grenoble", "Location de chalets"], ["Île de Ré", "Locations en appart'hôtel"],
    ["Nantes", "Locations en appart'hôtel"], ["Cabourg", "Locations de cottages"], ["Orléans", "Location de chalets"],
    ["Lille", "Locations avec piscine"], ["Tours", "Locations avec jacuzzi"], ["Dijon", "Locations adaptées aux animaux"],
  ]),
  tab("Sur la côte", [
    ["Biarritz", "Maisons de plage"], ["Nice", "Appartements vue mer"], ["La Baule", "Villas en bord de mer"],
    ["Saint-Malo", "Locations de vacances"], ["Hossegor", "Spots de surf"], ["Cassis", "Locations avec piscine"],
    ["Arcachon", "Maisons de plage"], ["Étretat", "Cottages"], ["Porto-Vecchio", "Villas"],
  ]),
  tab("Montagnes", [
    ["Chamonix-Mont-Blanc", "Location de chalets"], ["Annecy", "Locations au bord du lac"], ["Megève", "Chalets de luxe"],
    ["Gérardmer", "Locations de vacances"], ["Briançon", "Locations de vacances"], ["Font-Romeu", "Location de chalets"],
  ]),
  tab("Sports d'hiver", [
    ["Val Thorens", "Appartements au pied des pistes"], ["Courchevel", "Chalets de luxe"], ["Tignes", "Locations de ski"],
    ["Les Arcs", "Locations de ski"], ["La Clusaz", "Location de chalets"], ["Morzine", "Location de chalets"],
  ]),
  tab("Activités", [
    ["Paris", "Visites guidées"], ["Lyon", "Cours de cuisine"], ["Bordeaux", "Dégustations de vin"],
    ["Marseille", "Sorties en bateau"], ["Strasbourg", "Visites à vélo"], ["Lille", "Ateliers créatifs"],
  ]),
];
