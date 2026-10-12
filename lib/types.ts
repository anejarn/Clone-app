export type Category = "home" | "experience";
export type PropertyType = "Appartement" | "Maison" | "Loft" | "Studio" | "Villa" | "Chalet" | "Chambre" | "Hôtel";

export interface Place {
  slug: string;
  name: string;
  country: string;
  /** Short reason shown under the name ("Pour la tour Eiffel"). */
  tagline: string;
  image: string;
}

export interface Listing {
  id: string;
  category: Category;
  /** Property type for homes, activity title for experiences. */
  type: string;
  placeSlug: string;
  placeName: string;
  photos: string[];
  /** Cents EUR: per night for homes, per person for experiences. */
  price: number;
  cleaningFee: number;
  maxGuests: number;
  rating: number | null;
  reviewCount: number;
  isGuestFavorite: boolean;
  isProfessionalHost: boolean;
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
