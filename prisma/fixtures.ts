/**
 * Deterministic demo data: same input, same rows. Pure (no database access) so tests can use it directly.
 * prisma/seed.ts writes it to Postgres.
 */
import { slugify } from "../lib/search/params";
import type { PropertyTypeKey } from "../lib/labels";

const img = (seed: string, w = 720, h = 684) => `https://picsum.photos/seed/${seed}/${w}/${h}`;

/** mulberry32 PRNG */
export function prng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PLACES = [
  ["paris", "Paris", "France", "Pour la tour Eiffel", 48.8566, 2.3522],
  ["marseille", "Marseille", "France", "Près de la plage", 43.2965, 5.3698],
  ["lyon", "Lyon", "France", "Bons restaurants", 45.764, 4.8357],
  ["nice", "Nice", "France", "Vie nocturne animée", 43.7102, 7.262],
  ["bordeaux", "Bordeaux", "France", "Route des vins", 44.8378, -0.5792],
  ["annecy", "Annecy", "France", "Lacs et montagnes", 45.8992, 6.1294],
  ["biarritz", "Biarritz", "France", "Spots de surf", 43.4832, -1.5586],
  ["chamonix", "Chamonix-Mont-Blanc", "France", "Sports d'hiver", 45.9237, 6.8694],
  ["arcachon", "Arcachon", "France", "Pour la dune du Pilat", 44.6586, -1.1689],
  ["strasbourg", "Strasbourg", "France", "Marchés de Noël", 48.5734, 7.7521],
  ["montpellier", "Montpellier", "France", "Centre historique", 43.6108, 3.8767],
  ["nantes", "Nantes", "France", "Week-end culturel", 47.2184, -1.5536],
  ["marrakech", "Marrakech", "Maroc", "Architecture unique", 31.6295, -7.9811],
  ["lisbonne", "Lisbonne", "Portugal", "Voyage à l'étranger", 38.7223, -9.1393],
  ["barcelone", "Barcelone", "Espagne", "Plages et tapas", 41.3874, 2.1686],
  ["rome", "Rome", "Italie", "Sites historiques", 41.9028, 12.4964],
  ["londres", "Londres", "Royaume-Uni", "Musées gratuits", 51.5072, -0.1276],
  ["new-york", "New York", "États-Unis", "Architecture unique", 40.7128, -74.006],
] as const;

export const AMENITIES = [
  ["wifi", "Wifi", "wifi", "Essentiels"],
  ["cuisine", "Cuisine", "cooking-pot", "Essentiels"],
  ["lave-linge", "Lave-linge", "washing-machine", "Essentiels"],
  ["chauffage", "Chauffage", "heater", "Essentiels"],
  ["climatisation", "Climatisation", "air-vent", "Confort"],
  ["espace-travail", "Espace de travail dédié", "laptop", "Confort"],
  ["television", "Télévision", "tv", "Confort"],
  ["lave-vaisselle", "Lave-vaisselle", "utensils", "Confort"],
  ["parking", "Parking gratuit sur place", "car", "Extérieur"],
  ["balcon", "Balcon", "fence", "Extérieur"],
  ["piscine", "Piscine", "waves", "Extérieur"],
  ["jacuzzi", "Jacuzzi", "bath", "Extérieur"],
  ["cheminee", "Cheminée", "flame", "Confort"],
  ["animaux", "Animaux acceptés", "paw-print", "Règles"],
  ["vue-mer", "Vue sur la mer", "sunset", "Vue"],
  ["vue-montagne", "Vue sur la montagne", "mountain", "Vue"],
] as const;

const FIRST_NAMES = ["Camille", "Léa", "Hugo", "Manon", "Lucas", "Chloé", "Louis", "Inès", "Gabriel", "Jade", "Arthur", "Sarah", "Jules", "Emma", "Nathan", "Lina", "Paul", "Zoé", "Adam", "Alice"];
const HOME_TYPES: PropertyTypeKey[] = ["APARTMENT", "APARTMENT", "APARTMENT", "HOUSE", "LOFT", "STUDIO", "VILLA", "ROOM", "HOTEL"];
const MOUNTAIN_TYPES: PropertyTypeKey[] = ["CHALET", "CHALET", "APARTMENT", "STUDIO"];
const ADJECTIVES = ["lumineux", "cosy", "charmant", "spacieux", "rénové", "calme", "design", "familial"];
const EXPERIENCES = ["Atelier pâtisserie", "Balade photo au lever du soleil", "Dégustation de vins", "Cours de cuisine locale", "Visite street art", "Kayak au coucher du soleil"];
const REVIEW_BODIES = [
  "Logement impeccable, exactement comme sur les photos. Hôte très réactif.",
  "Super emplacement, tout est accessible à pied. Nous reviendrons !",
  "Très bon séjour, literie confortable et quartier calme.",
  "Accueil chaleureux et nombreux conseils pour visiter la ville.",
  "Quelques petits détails à revoir mais globalement un très bon rapport qualité-prix.",
  "Magnifique vue et décoration soignée. Parfait pour un week-end.",
];

export interface FixtureUser { id: string; name: string; email: string; isProfessional: boolean }
export interface FixtureListing {
  id: string;
  category: "HOME" | "EXPERIENCE";
  propertyType: PropertyTypeKey | null;
  title: string;
  description: string;
  placeSlug: string;
  hostId: string;
  lat: number;
  lng: number;
  maxGuests: number;
  bedrooms: number;
  beds: number;
  bathrooms: number;
  priceCents: number;
  cleaningFeeCents: number;
  isGuestFavorite: boolean;
  photos: string[];
  amenities: string[];
}
export interface FixtureReview { listingId: string; authorId: string; rating: number; body: string; createdAt: Date }
export interface FixtureBooking { listingId: string; guestId: string; checkIn: Date; checkOut: Date; adults: number }

const DAY = 86_400_000;
/** Reviews are dated before this fixed point so the dataset doesn't drift. */
const REVIEW_EPOCH = Date.UTC(2026, 8, 1);

export function buildFixtures() {
  const rand = prng(42);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

  const places = PLACES.map(([slug, name, country, tagline, lat, lng]) => ({
    slug, name, country, tagline, lat, lng, searchName: slugify(name), imageUrl: img(`place-${slug}`, 480, 480),
  }));

  const hosts: FixtureUser[] = Array.from({ length: 30 }, (_, i) => ({
    id: `host_${i + 1}`,
    name: FIRST_NAMES[i % FIRST_NAMES.length],
    email: `hote${i + 1}@demo.nidou.fr`,
    isProfessional: rand() > 0.75,
  }));
  const guests: FixtureUser[] = Array.from({ length: 40 }, (_, i) => ({
    id: `guest_${i + 1}`,
    name: FIRST_NAMES[(i * 7) % FIRST_NAMES.length],
    email: `voyageur${i + 1}@demo.nidou.fr`,
    isProfessional: false,
  }));

  const listings: FixtureListing[] = [];
  let n = 1000;
  for (const place of places) {
    const types = place.slug === "chamonix" || place.slug === "annecy" ? MOUNTAIN_TYPES : HOME_TYPES;
    for (let i = 0; i < 12; i++) {
      const type = pick(types);
      const base = type === "VILLA" ? 260 : type === "ROOM" ? 55 : type === "STUDIO" ? 75 : 95;
      const small = type === "ROOM" || type === "STUDIO";
      const maxGuests = small ? 2 : int(2, 8);
      const bedrooms = small ? 1 : Math.max(1, Math.ceil(maxGuests / 2));
      listings.push({
        id: String(n++),
        category: "HOME",
        propertyType: type,
        title: `${pick(["Appartement", "Logement", "Séjour", "Nid"])} ${pick(ADJECTIVES)} à ${place.name}`,
        description: `Profitez d'un séjour ${pick(ADJECTIVES)} à ${place.name}. Idéal pour ${maxGuests} voyageurs, proche des commerces et des transports.`,
        placeSlug: place.slug,
        hostId: pick(hosts).id,
        lat: place.lat + (rand() - 0.5) * 0.06,
        lng: place.lng + (rand() - 0.5) * 0.08,
        maxGuests,
        bedrooms,
        beds: bedrooms + int(0, 1),
        bathrooms: small ? 1 : int(1, 3),
        priceCents: Math.round(base + rand() * base * 1.4) * 100,
        cleaningFeeCents: int(20, 80) * 100,
        isGuestFavorite: rand() > 0.65,
        photos: Array.from({ length: 5 }, (_, k) => img(`home-${n - 1}-${k}`)),
        amenities: AMENITIES.filter(() => rand() > 0.45).map(([id]) => id),
      });
    }
    for (let i = 0; i < 3; i++) {
      const id = String(n++);
      listings.push({
        id,
        category: "EXPERIENCE",
        propertyType: null,
        title: pick(EXPERIENCES),
        description: `Une expérience animée par un habitant de ${place.name}.`,
        placeSlug: place.slug,
        hostId: pick(hosts).id,
        lat: place.lat,
        lng: place.lng,
        maxGuests: 8,
        bedrooms: 0,
        beds: 0,
        bathrooms: 0,
        priceCents: int(25, 115) * 100,
        cleaningFeeCents: 0,
        isGuestFavorite: rand() > 0.7,
        photos: Array.from({ length: 3 }, (_, k) => img(`exp-${id}-${k}`)),
        amenities: [],
      });
    }
  }

  const reviews: FixtureReview[] = [];
  for (const l of listings) {
    // ~1 in 8 listings is new: fewer than 3 reviews, so no average is shown.
    const count = rand() < 0.12 ? int(0, 2) : int(3, 24);
    for (let i = 0; i < count; i++) {
      reviews.push({
        listingId: l.id,
        authorId: pick(guests).id,
        rating: rand() < 0.8 ? 5 : rand() < 0.85 ? 4 : 3,
        body: pick(REVIEW_BODIES),
        createdAt: new Date(REVIEW_EPOCH - int(1, 700) * DAY),
      });
    }
  }

  return { places, hosts, guests, listings, reviews };
}

/**
 * A few upcoming stays so availability filtering has something to filter.
 * Relative to `today` (UTC midnight), at most one per listing so they never overlap.
 */
export function buildBookings(listings: FixtureListing[], guests: FixtureUser[], today: Date): FixtureBooking[] {
  const rand = prng(7);
  const out: FixtureBooking[] = [];
  for (const l of listings) {
    if (l.category !== "HOME" || rand() > 0.35) continue;
    const start = new Date(today.getTime() + (3 + Math.floor(rand() * 50)) * DAY);
    out.push({
      listingId: l.id,
      guestId: guests[Math.floor(rand() * guests.length)].id,
      checkIn: start,
      checkOut: new Date(start.getTime() + (2 + Math.floor(rand() * 4)) * DAY),
      adults: Math.min(2, l.maxGuests),
    });
  }
  return out;
}
