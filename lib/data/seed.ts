import { slugify } from "@/lib/search/params";
import type { InspirationTab, Listing, Place, Service } from "@/lib/types";

/**
 * Deterministic seed data. Stands in for the Prisma/Postgres layer described in
 * docs/architecture.md §5 until P2; only lib/data/repo.ts should import it.
 */

const img = (seed: string, w = 720, h = 684) => `https://picsum.photos/seed/${seed}/${w}/${h}`;

export const places: Place[] = [
  ["paris", "Paris", "France", "Pour la tour Eiffel"],
  ["marseille", "Marseille", "France", "Près de la plage"],
  ["lyon", "Lyon", "France", "Bons restaurants"],
  ["nice", "Nice", "France", "Vie nocturne animée"],
  ["bordeaux", "Bordeaux", "France", "Route des vins"],
  ["annecy", "Annecy", "France", "Lacs et montagnes"],
  ["biarritz", "Biarritz", "France", "Spots de surf"],
  ["chamonix", "Chamonix-Mont-Blanc", "France", "Sports d'hiver"],
  ["arcachon", "Arcachon", "France", "Pour la dune du Pilat"],
  ["strasbourg", "Strasbourg", "France", "Marchés de Noël"],
  ["montpellier", "Montpellier", "France", "Centre historique"],
  ["nantes", "Nantes", "France", "Week-end culturel"],
  ["marrakech", "Marrakech", "Maroc", "Architecture unique"],
  ["lisbonne", "Lisbonne", "Portugal", "Voyage à l'étranger"],
  ["barcelone", "Barcelone", "Espagne", "Plages et tapas"],
  ["rome", "Rome", "Italie", "Sites historiques"],
  ["londres", "Londres", "Royaume-Uni", "Musées gratuits"],
  ["new-york", "New York", "États-Unis", "Architecture unique"],
].map(([slug, name, country, tagline]) => ({ slug, name, country, tagline, image: img(`place-${slug}`, 480, 480) }));

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

/** mulberry32: tiny deterministic PRNG so the seed is stable across builds. */
function prng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOME_TYPES = ["Appartement", "Appartement", "Appartement", "Maison", "Loft", "Studio", "Villa", "Chambre", "Hôtel"];
const MOUNTAIN_TYPES = ["Chalet", "Chalet", "Appartement", "Studio"];
const EXPERIENCES = [
  "Atelier pâtisserie",
  "Balade photo au lever du soleil",
  "Dégustation de vins",
  "Cours de cuisine locale",
  "Visite street art",
  "Kayak au coucher du soleil",
];

function buildListings(): Listing[] {
  const rand = prng(42);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const out: Listing[] = [];
  let n = 1000;
  for (const place of places) {
    const types = place.slug === "chamonix" || place.slug === "annecy" ? MOUNTAIN_TYPES : HOME_TYPES;
    for (let i = 0; i < 12; i++) {
      const id = String(n++);
      const type = pick(types);
      const base = type === "Villa" ? 260 : type === "Chambre" ? 55 : type === "Studio" ? 75 : 95;
      const rated = rand() > 0.12;
      out.push({
        id,
        category: "home",
        type,
        placeSlug: place.slug,
        placeName: place.name,
        photos: Array.from({ length: 5 }, (_, k) => img(`home-${id}-${k}`)),
        price: Math.round((base + rand() * base * 1.4) / 1) * 100,
        cleaningFee: Math.round(20 + rand() * 60) * 100,
        maxGuests: type === "Chambre" || type === "Studio" ? 2 : 2 + Math.floor(rand() * 7),
        rating: rated ? Math.round((4.55 + rand() * 0.45) * 100) / 100 : null,
        reviewCount: rated ? 3 + Math.floor(rand() * 420) : 0,
        isGuestFavorite: rated && rand() > 0.6,
        isProfessionalHost: rand() > 0.75,
      });
    }
    for (let i = 0; i < 3; i++) {
      const id = String(n++);
      out.push({
        id,
        category: "experience",
        type: pick(EXPERIENCES),
        placeSlug: place.slug,
        placeName: place.name,
        photos: Array.from({ length: 3 }, (_, k) => img(`exp-${id}-${k}`)),
        price: (25 + Math.floor(rand() * 90)) * 100,
        cleaningFee: 0,
        maxGuests: 8,
        rating: Math.round((4.7 + rand() * 0.3) * 100) / 100,
        reviewCount: 10 + Math.floor(rand() * 300),
        isGuestFavorite: rand() > 0.7,
        isProfessionalHost: false,
      });
    }
  }
  return out;
}

export const listings: Listing[] = buildListings();

const tab = (label: string, rows: [string, string][]): InspirationTab => ({
  label,
  links: rows.map(([place, kind]) => ({
    place,
    kind,
    slug: slugify(place),
  })),
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
