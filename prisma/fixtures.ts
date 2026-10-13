/**
 * Deterministic demo data: same input, same rows. Pure (no database access) so tests can use it directly.
 * prisma/seed.ts writes it to Postgres.
 *
 * The catalogue is the launch product: ski apartments, studios and chalets in Orcières-Merlette 1850 and
 * Les Orres. Titles and descriptions are built from each listing's own data (size, lift distance,
 * classification, amenities), so they never claim anything the data doesn't say.
 */
import { slugify } from "../lib/search/params";
import { PROPERTY_TYPE_LABEL, SKI_IN_MAX_M, type PropertyTypeKey } from "../lib/labels";

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

// slug, name, country, tagline, lat, lng, timezone, commune INSEE code, altitude (m)
export const PLACES = [
  ["orcieres-merlette", "Orcières-Merlette 1850", "France", "Station familiale du Champsaur", 44.6955, 6.327, "Europe/Paris", "05096", 1850],
  ["les-orres", "Les Orres", "France", "Face au lac de Serre-Ponçon", 44.495, 6.556, "Europe/Paris", "05098", 1650],
] as const;

export const LISTINGS_PER_PLACE = 40;

// id, label, lucide icon name (kebab-case, as in lucide-react's dynamic icon names), group
export const AMENITIES = [
  ["wifi", "Wifi", "wifi", "Essentiels"],
  ["cuisine", "Cuisine", "cooking-pot", "Essentiels"],
  ["lave-linge", "Lave-linge", "washing-machine", "Essentiels"],
  ["chauffage", "Chauffage", "heater", "Essentiels"],
  ["television", "Télévision", "tv", "Confort"],
  ["lave-vaisselle", "Lave-vaisselle", "utensils", "Confort"],
  ["cheminee", "Cheminée", "flame", "Confort"],
  ["casier-a-skis", "Casier à skis", "lock-keyhole", "Ski"],
  ["ski-aux-pieds", "Ski aux pieds", "cable-car", "Ski"],
  ["parking", "Parking gratuit sur place", "car", "Extérieur"],
  ["balcon", "Balcon", "fence", "Extérieur"],
  ["jacuzzi", "Jacuzzi", "bath", "Extérieur"],
  ["animaux", "Animaux acceptés", "paw-print", "Règles"],
  ["vue-montagne", "Vue sur la montagne", "mountain", "Vue"],
] as const;

export type AmenityId = (typeof AMENITIES)[number][0];

const FIRST_NAMES = ["Camille", "Léa", "Hugo", "Manon", "Lucas", "Chloé", "Louis", "Inès", "Gabriel", "Jade", "Arthur", "Sarah", "Jules", "Emma", "Nathan", "Lina", "Paul", "Zoé", "Adam", "Alice"];
const ADJECTIVES = ["lumineux", "cosy", "chaleureux", "rénové", "douillet", "spacieux", "familial", "calme"];
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const REVIEW_BODIES = [
  "Parfait pour notre semaine de ski en famille : logement propre, bien chauffé et bien équipé.",
  "Très bon séjour à la neige, literie confortable et hôte très réactif.",
  "On rentre des pistes et on s'y sent tout de suite bien. Nous reviendrons l'hiver prochain !",
  "Remise des clés simple et logement conforme aux photos. Idéal pour un court séjour au ski.",
  "Quelques petits détails à revoir mais très bon rapport qualité-prix pour des vacances au ski.",
  "Cuisine bien équipée, pratique pour les repas après une journée de ski.",
];

export interface FixtureUser { id: string; name: string; email: string; isProfessional: boolean; isFoundingHost: boolean }
export interface FixturePlace {
  slug: string;
  name: string;
  country: string;
  tagline: string;
  lat: number;
  lng: number;
  timezone: string;
  inseeCode: string;
  altitudeM: number;
  searchName: string;
  imageUrl: string;
}
export interface FixtureListing {
  id: string;
  category: "HOME";
  propertyType: PropertyTypeKey;
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
  stars: number | null;
  registrationNumber: string;
  liftDistanceM: number;
  minNights: number;
  dpeClass: string | null;
  isGuestFavorite: boolean;
  photos: string[];
  amenities: AmenityId[];
}
export interface FixtureReview { listingId: string; authorId: string; rating: number; body: string; createdAt: Date }
export interface FixtureBooking { listingId: string; guestId: string; checkIn: Date; checkOut: Date; adults: number }

const DAY = 86_400_000;

/** "à Orcières-Merlette 1850", "aux Orres" */
export function atPlace(name: string): string {
  return name.startsWith("Les ") ? `aux ${name.slice(4)}` : `à ${name}`;
}

export function buildFixtures() {
  const rand = prng(42);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
  const chance = (p: number) => rand() < p;
  /** Picks a key by weight. */
  const weighted = <T,>(rows: readonly (readonly [T, number])[]): T => {
    let r = rand() * rows.reduce((s, [, w]) => s + w, 0);
    for (const [v, w] of rows) if ((r -= w) < 0) return v;
    return rows[rows.length - 1][0];
  };

  const places: FixturePlace[] = PLACES.map(([slug, name, country, tagline, lat, lng, timezone, inseeCode, altitudeM]) => ({
    slug, name, country, tagline, lat, lng, timezone, inseeCode, altitudeM, searchName: slugify(name), imageUrl: img(`place-${slug}`, 1200, 800),
  }));

  // A third of the hosts joined as founding hosts (reduced commission until the end of April 2027).
  const hosts: FixtureUser[] = Array.from({ length: 30 }, (_, i) => ({
    id: `host_${i + 1}`,
    name: FIRST_NAMES[i % FIRST_NAMES.length],
    email: `hote${i + 1}@demo.nidou.fr`,
    isProfessional: rand() > 0.75,
    isFoundingHost: i % 3 === 0,
  }));
  const guests: FixtureUser[] = Array.from({ length: 40 }, (_, i) => ({
    id: `guest_${i + 1}`,
    name: FIRST_NAMES[(i * 7) % FIRST_NAMES.length],
    email: `voyageur${i + 1}@demo.nidou.fr`,
    isProfessional: false,
    isFoundingHost: false,
  }));

  const registrationNumbers = new Set<string>();
  const registrationNumber = (inseeCode: string) => {
    for (;;) {
      const n = `${inseeCode}${String(int(0, 999_999)).padStart(6, "0")}${pick([...LETTERS])}${pick([...LETTERS])}`;
      if (!registrationNumbers.has(n)) {
        registrationNumbers.add(n);
        return n;
      }
    }
  };

  const listings: FixtureListing[] = [];
  let n = 1000;
  for (const place of places) {
    for (let i = 0; i < LISTINGS_PER_PLACE; i++) {
      const id = String(n++);
      const type = weighted<PropertyTypeKey>([["APARTMENT", 62], ["STUDIO", 23], ["CHALET", 15]]);
      const maxGuests = type === "STUDIO" ? int(2, 4) : type === "APARTMENT" ? int(4, 8) : int(6, 10);
      const bedrooms = type === "STUDIO" ? 1 : type === "APARTMENT" ? Math.max(1, Math.ceil((maxGuests - 2) / 2)) : Math.ceil(maxGuests / 2);
      // Nightly €70–260 and cleaning €30–90, both growing with the number of guests.
      const nightlyEuros = Math.min(260, Math.max(70, 70 + (maxGuests - 2) * 17 + (type === "CHALET" ? 40 : 0) + int(-8, 25)));
      const cleaningEuros = Math.min(90, Math.max(30, 30 + (maxGuests - 2) * 6 + int(0, 12)));
      const liftDistanceM = chance(0.22) ? int(0, SKI_IN_MAX_M) : Math.round(int(60, 1200) / 10) * 10;
      const skiIn = liftDistanceM <= SKI_IN_MAX_M;
      // ~60 % classified, mostly 2★–3★.
      const stars = chance(0.4) ? null : weighted([[1, 8], [2, 42], [3, 35], [4, 12], [5, 3]]);
      const dpeClass = chance(0.1) ? null : weighted([["A", 2], ["B", 5], ["C", 20], ["D", 32], ["E", 25], ["F", 12], ["G", 4]]);

      const amenities: AmenityId[] = [];
      const add = (amenity: AmenityId, p: number) => chance(p) && amenities.push(amenity);
      add("wifi", 0.85);
      add("cuisine", 0.95);
      add("lave-linge", type === "STUDIO" ? 0.3 : 0.6);
      amenities.push("chauffage");
      add("television", 0.75);
      add("lave-vaisselle", type === "STUDIO" ? 0.3 : 0.65);
      add("cheminee", type === "CHALET" ? 0.7 : 0.08);
      add("casier-a-skis", 0.75);
      if (skiIn) amenities.push("ski-aux-pieds");
      add("parking", type === "CHALET" ? 0.85 : 0.4);
      add("balcon", type === "STUDIO" ? 0.45 : 0.7);
      add("jacuzzi", type === "CHALET" ? 0.25 : 0.03);
      add("animaux", 0.25);
      add("vue-montagne", 0.6);

      const typeLabel = PROPERTY_TYPE_LABEL[type];
      const suffix = skiIn
        ? "au pied des pistes"
        : liftDistanceM <= 300
          ? "proche des remontées"
          : amenities.includes("vue-montagne")
            ? "avec vue sur les sommets"
            : pick(["pour vos vacances au ski", "pour une semaine à la neige"]);
      const lift = skiIn ? "au pied des pistes" : `à ${liftDistanceM} m des remontées mécaniques`;
      const classification = stars ? ` Meublé de tourisme classé ${stars} étoile${stars > 1 ? "s" : ""}.` : "";
      const lockers = amenities.includes("casier-a-skis") ? " Casier à skis." : "";

      listings.push({
        id,
        category: "HOME",
        propertyType: type,
        title: `${typeLabel} ${pick(ADJECTIVES)} ${suffix}`,
        description:
          `${typeLabel} pour ${maxGuests} voyageurs ${atPlace(place.name)}, ${lift}. ` +
          `${bedrooms} chambre${bedrooms > 1 ? "s" : ""}.${lockers}${classification} ` +
          `Idéal pour une semaine de ski ou un court séjour à la neige.`,
        placeSlug: place.slug,
        hostId: pick(hosts).id,
        lat: place.lat + (rand() - 0.5) * 0.016,
        lng: place.lng + (rand() - 0.5) * 0.016,
        maxGuests,
        bedrooms,
        beds: Math.min(maxGuests, Math.ceil(maxGuests / 2) + int(0, 1)),
        bathrooms: type === "STUDIO" ? 1 : type === "CHALET" ? int(2, 3) : maxGuests >= 6 ? int(1, 2) : 1,
        priceCents: nightlyEuros * 100,
        cleaningFeeCents: cleaningEuros * 100,
        stars,
        registrationNumber: registrationNumber(place.inseeCode),
        liftDistanceM,
        minNights: chance(0.2) ? 3 : 2,
        dpeClass,
        isGuestFavorite: rand() > 0.7,
        photos: Array.from({ length: 5 }, (_, k) => img(`home-${id}-${k}`)),
        amenities,
      });
    }
  }

  const reviews: FixtureReview[] = [];
  for (const l of listings) {
    // ~1 in 8 listings is new: fewer than 3 reviews, so no average is shown.
    const count = rand() < 0.12 ? int(0, 2) : int(3, 24);
    for (let i = 0; i < count; i++) {
      // Dated in the 2024–25 and 2025–26 winters (mid-December + up to 120 days), so the dataset doesn't drift.
      const winter = Date.UTC(pick([2024, 2025]), 11, 15);
      reviews.push({
        listingId: l.id,
        authorId: pick(guests).id,
        rating: rand() < 0.8 ? 5 : rand() < 0.85 ? 4 : 3,
        body: pick(REVIEW_BODIES),
        createdAt: new Date(winter + int(0, 120) * DAY),
      });
    }
  }

  return { places, hosts, guests, listings, reviews };
}

/**
 * A few upcoming stays so availability filtering has something to filter.
 * Relative to `today` (UTC midnight), at most one per listing so they never overlap, never shorter than
 * the listing's minimum stay.
 */
export function buildBookings(listings: FixtureListing[], guests: FixtureUser[], today: Date): FixtureBooking[] {
  const rand = prng(7);
  const out: FixtureBooking[] = [];
  for (const l of listings) {
    if (rand() > 0.35) continue;
    const start = new Date(today.getTime() + (3 + Math.floor(rand() * 50)) * DAY);
    const nights = Math.max(l.minNights, 2 + Math.floor(rand() * 4));
    out.push({
      listingId: l.id,
      guestId: guests[Math.floor(rand() * guests.length)].id,
      checkIn: start,
      checkOut: new Date(start.getTime() + nights * DAY),
      adults: Math.min(2, l.maxGuests),
    });
  }
  return out;
}
