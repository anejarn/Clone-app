/**
 * Deterministic demo data: same input, same rows. Pure (no database access) so tests can use it directly.
 * prisma/seed.ts writes it to Postgres.
 */
import { slugify } from "../lib/search/params";
import type { PropertyTypeKey } from "../lib/labels";
import { MARRAKECH_TIMEZONE, NEIGHBOURHOODS } from "../lib/neighbourhoods";

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

/** Demo price level per neighbourhood: a home's price band (TYPE_BAND_DH) is multiplied by it. */
const PRICE_LEVEL: Record<string, number> = {
  hivernage: 1.5, gueliz: 1, medina: 1.05, palmeraie: 1.6, agdal: 0.85, targa: 0.9, ourika: 1.25, agafay: 1.5, semlalia: 0.85, menara: 0.8,
};
/** Hivernage's top tier (lofts, houses, villas): a fixed band in dirhams, whatever the level. */
const HIVERNAGE_PREMIUM_DH: [number, number] = [3_000, 4_900];

/** [slug, name, country, tagline, lat, lng, timezone] for every neighbourhood of lib/neighbourhoods.ts. */
export const PLACES = NEIGHBOURHOODS.map((p) => [p.slug, p.name, "Maroc", p.tagline, p.lat, p.lng, MARRAKECH_TIMEZONE] as const);

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
  ["terrasse", "Terrasse sur le toit", "sun", "Extérieur"],
  ["vue-atlas", "Vue sur l'Atlas", "mountain", "Vue"],
] as const;

/** Guests: a mix, as at a Marrakech rental. */
const GUEST_NAMES = [
  "Camille", "Thomas", "Sofia", "Yasmine", "James", "Lucía", "Hugo", "Nora", "Marco", "Inès",
  "Olivia", "Mehdi", "Lena", "Pablo", "Chloé", "Adam", "Emma", "Karim", "Julia", "Nathan",
];
const CITY_TYPES: PropertyTypeKey[] = ["APARTMENT", "APARTMENT", "APARTMENT", "APARTMENT", "HOUSE", "LOFT", "STUDIO", "STUDIO", "VILLA", "ROOM", "HOTEL"];
/** Outside the city (Palmeraie, Ourika, Agafay): mostly villas and houses. */
const COUNTRY_TYPES: PropertyTypeKey[] = ["VILLA", "VILLA", "VILLA", "HOUSE", "HOUSE", "APARTMENT"];
const COUNTRY = new Set(["palmeraie", "ourika", "agafay"]);
/** Nightly price band before the neighbourhood's level, in dirhams. One price per home until seasons arrive (Lot 2). */
const TYPE_BAND_DH: Record<PropertyTypeKey, [number, number]> = {
  ROOM: [250, 380], STUDIO: [350, 520], APARTMENT: [480, 900], LOFT: [650, 1_000], HOTEL: [550, 900],
  HOUSE: [900, 1_500], CHALET: [900, 1_500], VILLA: [2_400, 4_000], RIAD: [1_000, 1_700],
};
/**
 * The Médina, position by position against CITY_TYPES: mostly riads. Size, rooms and amenities still follow the
 * CITY_TYPES draw (a studio's draw makes a small riad, a villa's a riad with a plunge pool), so the demo data
 * elsewhere is unchanged.
 */
const MEDINA_TYPES: PropertyTypeKey[] = ["APARTMENT", "APARTMENT", "RIAD", "APARTMENT", "RIAD", "RIAD", "STUDIO", "RIAD", "RIAD", "ROOM", "RIAD"];
const PREMIUM_TYPES = new Set<PropertyTypeKey>(["LOFT", "HOUSE", "VILLA"]);
/** Hivernage, in this order: apartments and hotels, plus a top tier of one loft, one house and one villa. */
const HIVERNAGE_TYPES: PropertyTypeKey[] = [
  "APARTMENT", "LOFT", "APARTMENT", "HOTEL", "STUDIO", "APARTMENT", "HOUSE", "APARTMENT", "ROOM", "HOTEL", "VILLA", "APARTMENT",
];
const ADJECTIVES = ["lumineux", "cosy", "charmant", "spacieux", "rénové", "calme", "design", "familial"];
/** Activities: [title, price per person in dirhams, neighbourhoods it starts from]. */
const EXPERIENCES: [string, number, string[]][] = [
  ["Journée dans la vallée de l'Ourika", 450, ["ourika", "hivernage", "gueliz", "agdal"]],
  ["Randonnée aux cascades de Setti Fatma", 550, ["ourika", "targa", "menara"]],
  ["Dîner sous les étoiles à Agafay", 650, ["agafay", "hivernage", "palmeraie"]],
  ["Quad dans le désert d'Agafay", 700, ["agafay", "semlalia", "targa"]],
  ["Cours de cuisine marocaine", 500, ["medina", "gueliz", "semlalia", "agdal", "menara"]],
  ["Balade guidée dans la médina et les souks", 300, ["medina", "gueliz", "hivernage", "agdal"]],
  ["Vol en montgolfière au lever du soleil", 2_200, ["palmeraie", "agafay", "hivernage", "targa", "semlalia", "menara"]],
  ["Hammam traditionnel et gommage", 350, ["medina", "hivernage", "palmeraie", "gueliz", "semlalia", "targa", "menara", "agdal", "ourika"]],
  ["Balade à dromadaire dans la Palmeraie", 400, ["palmeraie", "ourika", "agafay"]],
];
const REVIEW_BODIES = [
  "Logement impeccable, exactement comme sur les photos. Équipe très réactive.",
  "Emplacement idéal pour découvrir Marrakech. Nous reviendrons !",
  "Très bon séjour, literie confortable et quartier calme.",
  "Accueil chaleureux et de bons conseils pour les souks et les restaurants.",
  "Quelques petits détails à revoir mais globalement un très bon rapport qualité-prix.",
  "Superbe terrasse et décoration soignée. Parfait pour un long week-end.",
];

export type FixtureRole = "ADMIN" | "AGENT" | "OWNER" | "GUEST";
export interface FixtureUser { id: string; name: string; email: string; role: FixtureRole }

/**
 * Propriétaires (OWNER) of SIGMA_ORG: Moroccans living in Morocco, MRE (Marocains résidant à l'étranger) and
 * foreign owners of a second home in Marrakech. Each owns several listings.
 */
export const OWNERS: FixtureUser[] = [
  { id: "owner_benjelloun", name: "Hassan Benjelloun", email: "hassan.benjelloun@demo.sigma.test", role: "OWNER" },
  { id: "owner_elfassi", name: "Nadia El Fassi", email: "nadia.elfassi@demo.sigma.test", role: "OWNER" },
  { id: "owner_alaoui", name: "Karim Alaoui", email: "karim.alaoui@demo.sigma.test", role: "OWNER" }, // MRE, Paris
  { id: "owner_ouazzani", name: "Samira Ouazzani", email: "samira.ouazzani@demo.sigma.test", role: "OWNER" }, // MRE, Bruxelles
  { id: "owner_tazi", name: "Rachid Tazi", email: "rachid.tazi@demo.sigma.test", role: "OWNER" }, // MRE, Montréal
  { id: "owner_moreau", name: "Isabelle Moreau", email: "isabelle.moreau@demo.sigma.test", role: "OWNER" }, // Lyon
  { id: "owner_vandamme", name: "Pieter Van Damme", email: "pieter.vandamme@demo.sigma.test", role: "OWNER" }, // Gand
  { id: "owner_ortega", name: "Carmen Ortega", email: "carmen.ortega@demo.sigma.test", role: "OWNER" }, // Madrid
];

/** The first organization: every demo listing and booking belongs to it. Same id as the migration that created it. */
export const SIGMA_ORG = { id: "org_sigma", slug: "sigma", name: "Sigma" } as const;

/** Sigma's team: the three associés (ADMIN) and two field agents (AGENT), all members of SIGMA_ORG. */
export const STAFF: FixtureUser[] = [
  { id: "staff_amine", name: "Amine", email: "amine@demo.sigma.test", role: "ADMIN" },
  { id: "staff_felicia", name: "Felicia", email: "felicia@demo.sigma.test", role: "ADMIN" },
  { id: "staff_othman", name: "Othman", email: "othman@demo.sigma.test", role: "ADMIN" },
  { id: "staff_agent_1", name: "Youssef", email: "agent1@demo.sigma.test", role: "AGENT" },
  { id: "staff_agent_2", name: "Khadija", email: "agent2@demo.sigma.test", role: "AGENT" },
];
export interface FixtureListing {
  id: string;
  category: "HOME" | "EXPERIENCE";
  propertyType: PropertyTypeKey | null;
  title: string;
  description: string;
  placeSlug: string;
  ownerId: string;
  managementType: "MANAGED" | "SUBLEASE";
  /** Internal street address; the public site shows the neighbourhood only. */
  address: string;
  minNights: number;
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
/** Loi 80-14 authorisation of a home; experiences have none. */
export interface FixtureLicense { listingId: string; licenseNumber: string | null; licenseExpiresAt: Date | null }
export interface FixtureReview { listingId: string; authorId: string; rating: number; body: string; createdAt: Date }
export interface FixtureBooking { listingId: string; guestId: string; checkIn: Date; checkOut: Date; adults: number }

const DAY = 86_400_000;
/** Reviews are dated before this fixed point so the dataset doesn't drift. */
const REVIEW_EPOCH = Date.UTC(2026, 8, 1);

export function buildFixtures() {
  const rand = prng(42);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

  const places = PLACES.map(([slug, name, country, tagline, lat, lng, timezone]) => ({
    slug, name, country, tagline, lat, lng, timezone, searchName: slugify(name), imageUrl: img(`place-${slug}`, 480, 480),
  }));

  // Draws once made for the 30 marketplace hosts' "professional" flag: still made so the rest of the data is unchanged.
  for (let i = 0; i < 30; i++) rand();
  const pickOwner = () => pick(OWNERS).id;
  // Sigma's terms (management type, address, minimum stay) come from their own generator, so adding them left
  // the catalogue (types, prices, amenities, reviews) as it was.
  const terms = prng(8014);
  const termsPick = <T,>(xs: readonly T[]) => xs[Math.floor(terms() * xs.length)];
  const guests: FixtureUser[] = Array.from({ length: 40 }, (_, i) => ({
    id: `guest_${i + 1}`,
    name: GUEST_NAMES[(i * 7) % GUEST_NAMES.length],
    email: `voyageur${i + 1}@demo.sigma.test`,
    role: "GUEST",
  }));

  const listings: FixtureListing[] = [];
  let n = 1000;
  for (const place of places) {
    const types = COUNTRY.has(place.slug) ? COUNTRY_TYPES : CITY_TYPES;
    for (let i = 0; i < 12; i++) {
      const k = place.slug === "hivernage" ? i : Math.floor(rand() * types.length);
      const drawn = place.slug === "hivernage" ? HIVERNAGE_TYPES[i] : types[k];
      const type = place.slug === "medina" ? MEDINA_TYPES[k] : drawn;
      const small = drawn === "ROOM" || drawn === "STUDIO";
      const maxGuests = small ? 2 : drawn === "VILLA" ? int(6, 12) : int(2, 8);
      const bedrooms = small ? 1 : Math.max(1, Math.ceil(maxGuests / 2));
      // Whole dirhams, rounded to 10 DH, stored in centimes.
      const premium = place.slug === "hivernage" && PREMIUM_TYPES.has(type);
      const [low, high] = premium ? HIVERNAGE_PREMIUM_DH : TYPE_BAND_DH[type].map((dh) => dh * PRICE_LEVEL[place.slug]);
      const nightlyDh = Math.round((low + rand() * (high - low)) / 10) * 10;
      const amenities = AMENITIES.filter(([id]) => (id === "piscine" && drawn === "VILLA") || rand() > 0.45).map(([id]) => id);
      const noun = pick(["Appartement", "Logement", "Séjour", "Pied-à-terre"]);
      listings.push({
        id: String(n++),
        category: "HOME",
        propertyType: type,
        title: `${type === "RIAD" ? "Riad" : noun} ${pick(ADJECTIVES)} · ${place.name}`,
        description: `Séjour ${pick(ADJECTIVES)} à ${place.name}, Marrakech. Pour ${maxGuests} voyageurs au maximum.`,
        placeSlug: place.slug,
        ownerId: pickOwner(),
        // A few town apartments are sub-let: Sigma rents them from the owner.
        managementType: SUBLEASE_TYPES.has(type) && !COUNTRY.has(place.slug) && terms() < 0.12 ? "SUBLEASE" : "MANAGED",
        address: address(place, termsPick, terms),
        minNights: minNightsFor(place.slug, type, terms),
        lat: place.lat + (rand() - 0.5) * 0.02,
        lng: place.lng + (rand() - 0.5) * 0.024,
        maxGuests,
        bedrooms,
        beds: bedrooms + int(0, 1),
        bathrooms: small ? 1 : int(1, type === "VILLA" ? 5 : 3),
        priceCents: nightlyDh * 100,
        cleaningFeeCents: (type === "VILLA" ? int(30, 60) : int(12, 30)) * 1_000,
        isGuestFavorite: rand() > 0.65,
        photos: Array.from({ length: 5 }, (_, k) => img(`home-${n - 1}-${k}`)),
        amenities,
      });
    }
    // Three different activities per neighbourhood, from those that start there.
    const pool = EXPERIENCES.filter(([, , from]) => from.includes(place.slug));
    const offset = Math.floor(rand() * pool.length);
    for (let i = 0; i < 3; i++) {
      const id = String(n++);
      const [title, priceDh] = pool[(offset + i) % pool.length];
      listings.push({
        id,
        category: "EXPERIENCE",
        propertyType: null,
        title,
        description: `${title}, au départ de ${place.name}.`,
        placeSlug: place.slug,
        ownerId: pickOwner(),
        managementType: "MANAGED",
        address: `Départ : ${place.name}, Marrakech`,
        minNights: 1,
        lat: place.lat,
        lng: place.lng,
        maxGuests: 8,
        bedrooms: 0,
        beds: 0,
        bathrooms: 0,
        priceCents: Math.round((priceDh * (0.9 + rand() * 0.3)) / 10) * 10 * 100,
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

  return { places, staff: STAFF, owners: OWNERS, guests, listings, reviews };
}

const SUBLEASE_TYPES = new Set<PropertyTypeKey>(["APARTMENT", "STUDIO", "LOFT"]);
/** Street names per neighbourhood, for internal addresses (numbers are made up). */
const STREETS: Record<string, string[]> = {
  hivernage: ["Avenue Echouhada", "Rue du Temple", "Avenue Mohammed VI", "Rue Ibn Aïcha"],
  gueliz: ["Rue de la Liberté", "Boulevard Mohammed Zerktouni", "Rue Tarik Ibn Ziad", "Rue Mohammed El Beqal"],
  medina: ["Derb Sidi Bouloukat", "Derb Dabachi", "Derb Chorfa Lakbir, Mouassine", "Derb Jdid, Riad Zitoun el Kedim"],
  palmeraie: ["Circuit de la Palmeraie", "Route de Fès, Palmeraie", "Douar Abiad"],
  agdal: ["Avenue Allal El Fassi", "Rue Abou Bakr Seddik", "Résidence Agdal"],
  targa: ["Route de Targa", "Rue Al Massira, Targa", "Lotissement Targa"],
  ourika: ["Route de l'Ourika, km 12", "Route de l'Ourika, km 18", "Douar Tnine Ourika"],
  agafay: ["Piste d'Agafay", "Route d'Amizmiz, Agafay", "Douar Lalla Takerkoust"],
  semlalia: ["Avenue Abdelkrim El Khattabi", "Rue Ibn Toumert, Semlalia", "Résidence Semlalia"],
  menara: ["Avenue de la Ménara", "Rue des Jardins de la Ménara", "Lotissement Ménara"],
};

function address(place: { slug: string; name: string }, pick: <T>(xs: readonly T[]) => T, rand: () => number): string {
  const street = pick(STREETS[place.slug] ?? [place.name]);
  return `${1 + Math.floor(rand() * 120)} ${street}, ${place.name}, Marrakech`;
}

/**
 * 1 to 3 nights. Riads take 2, villas outside town 3; a few other homes outside Hivernage and Guéliz take 2.
 * Hivernage and Guéliz stay at 1 night: the end-to-end tests book short stays there.
 */
function minNightsFor(placeSlug: string, type: PropertyTypeKey, rand: () => number): number {
  if (type === "RIAD") return 2;
  if (type === "VILLA" && COUNTRY.has(placeSlug)) return 3;
  const draw = rand();
  return placeSlug !== "hivernage" && placeSlug !== "gueliz" && draw < 0.15 ? 2 : 1;
}

/**
 * Loi 80-14 authorisations of the homes, relative to `today` (UTC midnight) so the demo always shows the alerts:
 * one expired, a few expiring within 60 days, a couple still pending (no number), the rest valid for up to 5 years.
 * Numbers look like "MKH-80.14-2024-0417". Deterministic for a given `today`.
 */
export function buildLicenses(listings: FixtureListing[], today: Date): FixtureLicense[] {
  const rand = prng(1480);
  const homes = listings.filter((l) => l.category === "HOME");
  return homes.map((l, i) => {
    // Fixed positions for the cases the back-office must flag.
    const days =
      i === 7 ? -12 : // expired
      i % 23 === 3 ? 10 + Math.floor(rand() * 50) : // expires within 60 days
      i % 37 === 5 ? null : // application pending
      90 + Math.floor(rand() * 1_700);
    if (days === null) return { listingId: l.id, licenseNumber: null, licenseExpiresAt: null };
    const expires = new Date(today.getTime() + days * DAY);
    // Authorisations last five years: issued five years before they expire.
    const year = expires.getUTCFullYear() - 5;
    return { listingId: l.id, licenseNumber: `MKH-80.14-${year}-${String(100 + i * 7).padStart(4, "0")}`, licenseExpiresAt: expires };
  });
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
