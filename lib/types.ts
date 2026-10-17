export interface Place {
  slug: string;
  name: string;
  country: string;
  /** Short description shown under the name ("Villas au milieu des palmiers"). */
  tagline: string;
  image: string;
}

export interface Service {
  slug: string;
  label: string;
  emoji: string;
}

export interface InspirationTab {
  label: string;
  /** `query` is the search string the link carries ("adults=4"), empty for none. */
  links: { place: string; slug: string; kind: string; query: string }[];
}
