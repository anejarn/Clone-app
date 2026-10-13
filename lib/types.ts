export interface Place {
  slug: string;
  name: string;
  country: string;
  /** Short reason shown under the name ("Station familiale du Champsaur"). */
  tagline: string;
  image: string;
  /** Resort altitude in metres, when known. */
  altitudeM?: number | null;
  /** Commune INSEE code: decides the taxe de séjour grid and the registration-number prefix. */
  inseeCode?: string;
}

/** A resort's group in the "browse by resort" grid: links to searches. */
export interface InspirationGroup {
  label: string;
  links: { label: string; href: string }[];
}
