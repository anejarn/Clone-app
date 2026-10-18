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
/**
 * Demo sign-ins, for the dev and test databases only: prisma/seed.ts never sets them when NODE_ENV=production.
 * Same password for all; the two staff members marked `totp` have double authentification with DEMO_TOTP_SECRET
 * (base32 for an authenticator app: DEMO_TOTP_SECRET_BASE32) and DEMO_BACKUP_CODES. Felicia (ADMIN) has none,
 * so she is asked to enroll on her first visit to /admin. See README "Demo accounts".
 */
export const DEMO_PASSWORD = "sigma-demo-2026";
export const DEMO_TOTP_SECRET = "sigma-demo-totp-not-for-production";
export const DEMO_TOTP_SECRET_BASE32 = "ONUWO3LBFVSGK3LPFV2G65DQFVXG65BNMZXXELLQOJXWI5LDORUW63Q";
export const DEMO_BACKUP_CODES = Array.from({ length: 10 }, (_, i) => `demo0-${String(i + 1).padStart(5, "0")}`);
export const DEMO_LOGINS: { userId: string; totp: boolean }[] = [
  { userId: "staff_amine", totp: true }, // ADMIN
  { userId: "staff_agent_1", totp: true }, // AGENT
  { userId: "staff_felicia", totp: false }, // ADMIN, double authentification not set up yet
  { userId: "owner_benjelloun", totp: false }, // OWNER
  { userId: "guest_1", totp: false }, // GUEST
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

/** A season or event of the demo (table price_rules); listingIds null = every home. Dates are nights, both included. */
export interface FixturePriceRule {
  id: string;
  kind: "SEASON" | "EVENT";
  name: string;
  startDate: Date;
  endDate: Date;
  recurring: boolean;
  percentBps: number;
  minNights: number | null;
  priority: number;
  listingIds: string[] | null;
}

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

/**
 * Marrakech's demo seasons and events, each for a selection of homes (never every home, so a test home created on the
 * fly keeps its base price): spring and autumn high seasons and the year-end holidays (with a 3-night minimum) for
 * the villas and houses outside town and the Médina riads, the Marathon for Hivernage and Guéliz, Ramadan 2027 as a
 * low season in the Médina. The Hivernage and Guéliz homes have no yearly rule and no raised minimum stay: the
 * tests book short stays there at their base price. Ramadan's dates are approximate (it follows the moon).
 */
export function buildPriceRules(listings: FixtureListing[]): FixturePriceRule[] {
  const homes = listings.filter((l) => l.category === "HOME");
  const ids = (f: (l: FixtureListing) => boolean) => homes.filter(f).map((l) => l.id);
  const country = ids((l) => COUNTRY.has(l.placeSlug));
  const riads = ids((l) => l.propertyType === "RIAD");
  const medina = ids((l) => l.placeSlug === "medina");
  const town = ids((l) => l.placeSlug === "hivernage" || l.placeSlug === "gueliz");
  return [
    { id: "rule_printemps", kind: "SEASON", name: "Haute saison de printemps", startDate: utc("2027-03-15"), endDate: utc("2027-05-15"), recurring: true, percentBps: 1_500, minNights: null, priority: 0, listingIds: [...country, ...riads] },
    { id: "rule_automne", kind: "SEASON", name: "Haute saison d'automne", startDate: utc("2026-10-01"), endDate: utc("2026-11-15"), recurring: true, percentBps: 1_000, minNights: null, priority: 0, listingIds: [...country, ...riads] },
    { id: "rule_fetes", kind: "EVENT", name: "Fêtes de fin d'année", startDate: utc("2026-12-20"), endDate: utc("2027-01-04"), recurring: true, percentBps: 3_500, minNights: 3, priority: 0, listingIds: [...country, ...riads] },
    { id: "rule_marathon_2027", kind: "EVENT", name: "Marathon de Marrakech 2027", startDate: utc("2027-01-29"), endDate: utc("2027-01-31"), recurring: false, percentBps: 2_000, minNights: null, priority: 0, listingIds: town },
    { id: "rule_ramadan_2027", kind: "SEASON", name: "Ramadan 2027 (basse saison)", startDate: utc("2027-02-08"), endDate: utc("2027-03-09"), recurring: false, percentBps: -1_000, minNights: null, priority: 0, listingIds: medina },
  ];
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

export type FixturePlatform = "AIRBNB" | "BOOKING" | "AGODA" | "TRIPCOM";
/** A booking taken on a platform: no guest account, the guest's contact as the platform passes it on. */
export interface FixturePlatformBooking {
  listingId: string;
  source: FixturePlatform;
  externalRef: string;
  guestName: string;
  guestEmail: string | null;
  guestPhone: string | null;
  checkIn: Date;
  checkOut: Date;
  adults: number;
  children: number;
}
/** A propriétaire keeping their own dates: no guest, no amounts. */
export interface FixtureOwnerBlock { listingId: string; checkIn: Date; checkOut: Date }

/**
 * Platform guests, by the platforms they typically book through: Europeans on Airbnb and Booking.com, Asian
 * travellers on Agoda and Trip.com (Sigma's guest languages, CLAUDE.md). Made-up people.
 */
const PLATFORM_GUESTS: Record<FixturePlatform, string[]> = {
  AIRBNB: ["Emma de Jong", "Lukas Schneider", "Oliver Bennett", "Chloé Lefebvre", "Liam O'Connor", "Emily Carter", "Ana Souza", "Astrid Lindqvist"],
  BOOKING: ["Giulia Romano", "Sofía Martínez", "Pieter Janssens", "Mateusz Kowalski", "Nour Haddad", "Hannah Müller", "Javier Ruiz", "Sarah Cohen"],
  AGODA: ["Kim Min-jun", "Sato Yuki", "Nguyen Thi Lan", "Priya Sharma", "Lee Seo-yeon", "Tanaka Haruto"],
  TRIPCOM: ["Wang Fang", "Chen Jie", "Li Wei", "Zhang Min", "Liu Yang", "Huang Lei"],
};
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * The platform's own code for a booking, in each platform's usual shape: Airbnb "HM" + 8 letters and digits,
 * Booking.com 10 digits, Agoda 9 digits, Trip.com 16 digits.
 */
function externalRef(source: FixturePlatform, rand: () => number): string {
  const digits = (n: number) => Array.from({ length: n }, (_, i) => (i === 0 ? 1 + Math.floor(rand() * 9) : Math.floor(rand() * 10))).join("");
  if (source === "AIRBNB") return `HM${Array.from({ length: 8 }, () => UPPER[Math.floor(rand() * UPPER.length)]).join("")}`;
  if (source === "BOOKING") return digits(10);
  if (source === "AGODA") return digits(9);
  return digits(16);
}

/**
 * Contact details as each platform passes them on (fictitious): Airbnb and Trip.com keep the e-mail behind
 * their messaging, Booking.com and Agoda give a relay address; a few guests leave a phone number (UK and French
 * numbers from the ranges reserved for fiction).
 */
function contact(source: FixturePlatform, name: string, ref: string, i: number) {
  const handle = slugify(name).replace(/-/g, ".");
  const guestEmail =
    source === "BOOKING" ? `${handle}.${ref.slice(-4)}@guest.booking.test` : source === "AGODA" ? `${handle}.${ref.slice(-4)}@relay.agoda.test` : null;
  const guestPhone = i % 4 === 0 ? `+44 7700 900${String(100 + i).slice(-3)}` : i % 4 === 2 ? `+33 6 39 98 ${String(10 + (i % 90)).padStart(2, "0")} ${String(20 + (i % 70)).padStart(2, "0")}` : null;
  return { guestEmail, guestPhone };
}

/**
 * Platform bookings (Airbnb, Booking.com, Agoda, Trip.com) and owner blocks, around the direct stays of
 * buildBookings, relative to `today` (UTC midnight) and deterministic for a given `today`. They never overlap a
 * direct stay or each other: direct stays sit 3 to 58 days out, so platform stays take past dates (ended before
 * today), stays in progress (started up to 2 days ago, ending within 2 days) and dates 62 to 115 days out; owner
 * blocks take 120 to 175 days out. Everything ends before day 180: the tests book from day 200 on.
 */
export function buildChannelBookings(listings: FixtureListing[], today: Date): { platform: FixturePlatformBooking[]; ownerBlocks: FixtureOwnerBlock[] } {
  const rand = prng(2027);
  const at = (days: number) => new Date(today.getTime() + days * DAY);
  const homes = listings.filter((l) => l.category === "HOME");
  const platforms: FixturePlatform[] = ["AIRBNB", "AIRBNB", "AIRBNB", "BOOKING", "BOOKING", "AGODA", "TRIPCOM"];
  const platform: FixturePlatformBooking[] = [];
  const used = new Set<string>();
  let i = 0;
  const add = (l: FixtureListing, source: FixturePlatform, checkIn: number, nights: number) => {
    const guests = PLATFORM_GUESTS[source];
    const guestName = guests[Math.floor(rand() * guests.length)];
    let ref = externalRef(source, rand);
    while (used.has(`${source}:${ref}`)) ref = externalRef(source, rand);
    used.add(`${source}:${ref}`);
    const adults = Math.min(l.maxGuests, 1 + Math.floor(rand() * 4));
    const children = Math.min(l.maxGuests - adults, rand() < 0.3 ? 1 : 0);
    platform.push({
      listingId: l.id,
      source,
      externalRef: ref,
      guestName,
      ...contact(source, guestName, ref, i++),
      checkIn: at(checkIn),
      checkOut: at(checkIn + Math.max(nights, l.minNights)),
      adults,
      children,
    });
  };
  homes.forEach((l, k) => {
    // Every third home: one past stay; every fifth: a stay in progress; every fourth: a stay in two to four months.
    // Asian platforms take a larger share of stays in progress and to come, as their clientele grows.
    if (k % 3 === 0) add(l, platforms[Math.floor(rand() * platforms.length)], -40 + Math.floor(rand() * 25), 2 + Math.floor(rand() * 5));
    if (k % 5 === 1) add(l, platforms[(k + 3) % platforms.length], -Math.floor(rand() * 3), 3 + Math.floor(rand() * 2) - 1);
    if (k % 4 === 2) add(l, platforms[(k * 5) % platforms.length], 62 + Math.floor(rand() * 40), 2 + Math.floor(rand() * 7));
  });
  // A few owners keeping a week or two for themselves (often MRE back for the holidays).
  const ownerBlocks = homes
    .filter((_, k) => k % 11 === 4)
    .map((l) => {
      const start = 120 + Math.floor(rand() * 40);
      return { listingId: l.id, checkIn: at(start), checkOut: at(start + 7 + Math.floor(rand() * 8)) };
    });
  return { platform, ownerBlocks };
}

// ---------- Welcome guide (Lot 4a) ----------

/**
 * Demo guide links (dev and test databases only, never in production): fixed tokens so that the demo links are
 * known — `current` on a stay in progress (codes shown), `upcoming` on a stay to come (« disponible à partir du… »).
 * Public: never use them on a real booking. `pnpm guide:link <bookingId>` issues a fresh link for any booking.
 */
export const DEMO_GUIDE_TOKENS = {
  current: "demo-guide-current-stay-0000000000000000000",
  upcoming: "demo-guide-upcoming-stay-000000000000000000",
} as const;

/** Demo conciergerie contact (fictitious numbers). */
export const DEMO_CONCIERGE = { conciergePhone: "+212524000000", conciergeWhatsapp: "+212600000000" } as const;

/** Demo access codes of every home: values are made up per home, never real. */
export function demoAccessCodes(listingId: string) {
  const n = Number(listingId.replace(/\D/g, "").slice(-4) || "1000");
  return [
    { kind: "DOOR" as const, label: "Serrure à code", value: String(4000 + ((n * 37) % 6000)) },
    { kind: "KEYBOX" as const, label: "À droite de la porte", value: String(100 + ((n * 13) % 900)) },
  ];
}

export function demoWifi(listingId: string) {
  return { wifiName: `Sigma-${listingId}`, wifiPassword: `marrakech-${listingId}` };
}

/** The guide texts of a home in French, Spanish and English (Médina riads get the derb directions). */
export function demoGuideTexts(placeSlug: string) {
  const medina = placeSlug === "medina";
  return {
    directions: medina
      ? {
          fr: "Les voitures n'entrent pas dans la médina : le taxi vous dépose à Bab Doukkala. Un membre de l'équipe vous attend et vous accompagne (5 minutes à pied).",
          es: "Los coches no entran en la medina: el taxi le deja en Bab Doukkala. Un miembro del equipo le espera y le acompaña (5 minutos a pie).",
          en: "Cars can't enter the medina: the taxi drops you at Bab Doukkala. A team member meets you there and walks you in (5 minutes).",
        }
      : {
          fr: "Depuis l'aéroport Marrakech-Ménara, comptez 20 minutes en taxi. Montrez l'adresse au chauffeur ; un parking public est à 100 m.",
          es: "Desde el aeropuerto Marrakech-Menara, unos 20 minutos en taxi. Muestre la dirección al conductor; hay un aparcamiento público a 100 m.",
          en: "From Marrakech-Menara airport, about 20 minutes by taxi. Show the address to the driver; there is a public car park 100 m away.",
        },
    accessInstructions: {
      fr: "La boîte à clés est à droite de la porte. Composez son code, prenez les clés, puis refermez-la. La porte d'entrée s'ouvre aussi avec son propre code.",
      es: "La caja de llaves está a la derecha de la puerta. Marque el código, tome las llaves y ciérrela. La puerta de entrada también se abre con su propio código.",
      en: "The key box is to the right of the door. Enter its code, take the keys, then close it again. The front door also opens with its own code.",
    },
    houseRulesTranslations: {
      es: "Sin fiestas ni música alta después de las 22:00\nNo se fuma en el interior\nCierre la puerta con llave al salir",
      en: "No parties or loud music after 10 pm\nNo smoking inside\nLock the door when you go out",
    },
  };
}

/** The organization's default recommendations (real, well-known Marrakech places). */
export const DEMO_RECOMMENDATIONS = [
  {
    category: "CULTURE" as const,
    name: "Jardin Majorelle",
    url: "https://www.jardinmajorelle.com",
    description: {
      fr: "Le jardin au bleu Majorelle, à réserver en ligne ; allez-y tôt le matin.",
      es: "El jardín del azul Majorelle; reserve en línea y vaya temprano.",
      en: "The garden of Majorelle blue; book online and go early in the morning.",
    },
  },
  {
    category: "SOUK" as const,
    name: "Souks de la médina",
    url: null,
    description: {
      fr: "Depuis la place Jemaa el-Fna, suivez la rue Semmarine. Négociez avec le sourire.",
      es: "Desde la plaza Jemaa el-Fna, siga la calle Semmarine. Regatee con una sonrisa.",
      en: "From Jemaa el-Fna square, follow Rue Semmarine. Haggle with a smile.",
    },
  },
  {
    category: "HAMMAM" as const,
    name: "Hammam traditionnel de quartier",
    url: null,
    description: { fr: "Demandez à la conciergerie le hammam le plus proche : nous réservons pour vous." },
  },
  {
    category: "RESTAURANT" as const,
    name: "Cuisine de rue à Jemaa el-Fna",
    url: null,
    description: {
      fr: "Le soir, les stands de la place : choisissez ceux où mangent les Marrakchis.",
      en: "In the evening, the food stalls on the square: pick the ones where locals eat.",
    },
  },
];

// ---------- Travellers' declaration and taxe de séjour (Lot 5) ----------

/**
 * The demo taxe de séjour rate: a PLACEHOLDER for trying the app, NOT the rate of the commune of Marrakech (which
 * Sigma must confirm with the commune / its accountant and type in Paramètres).
 */
export const DEMO_TAX_RATE = {
  effectiveFrom: "2026-01-01",
  rateCents: 1_000,
  minorsExemptUnder: 18,
  residentsExempt: false,
  note: "TAUX FICTIF DE DÉMONSTRATION — à remplacer par le taux confirmé par la commune",
};

/** Obviously fictitious travellers for the demo stay in progress (never real people, never real document numbers). */
export const DEMO_TRAVELERS = [
  {
    lastName: "DEMO-VOYAGEUR",
    firstName: "Alpha",
    sex: "F" as const,
    birthDate: "1990-01-01",
    birthPlace: "Ville fictive",
    nationality: "FR",
    documentType: "PASSPORT" as const,
    documentNumber: "TEST000001",
    documentIssueDate: "2020-01-01",
    documentIssueCountry: "FR",
    documentExpiryDate: "2030-01-01",
    address: "1 rue de l'Exemple, Ville fictive",
    residenceCountry: "FR",
    profession: "",
    comingFrom: "Ville fictive",
    goingTo: "Ville fictive",
  },
  {
    lastName: "DEMO-VOYAGEUR",
    firstName: "Bravo",
    sex: "M" as const,
    birthDate: "1988-02-02",
    birthPlace: "Ville fictive",
    nationality: "ES",
    documentType: "PASSPORT" as const,
    documentNumber: "TEST000002",
    documentIssueDate: "2021-02-02",
    documentIssueCountry: "ES",
    documentExpiryDate: "2031-02-02",
    address: "2 calle del Ejemplo, Ciudad ficticia",
    residenceCountry: "ES",
    profession: "",
    comingFrom: "Ville fictive",
    goingTo: "Ville fictive",
  },
];
