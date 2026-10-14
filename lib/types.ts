export interface Place {
  slug: string;
  name: string;
  country: string;
  /** Short reason shown under the name ("Pour la tour Eiffel"). */
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
  links: { place: string; slug: string; kind: string }[];
}
