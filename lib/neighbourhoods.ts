/** The Marrakech neighbourhoods Sigma's site covers: search destinations, home-page tiles and inspiration links. */
export const MARRAKECH_TIMEZONE = "Africa/Casablanca";

export interface Neighbourhood {
  slug: string;
  name: string;
  /** Shown under the name on tiles and suggestions. */
  tagline: string;
  lat: number;
  lng: number;
}

export const NEIGHBOURHOODS: Neighbourhood[] = [
  { slug: "hivernage", name: "Hivernage", tagline: "Hôtels, jardins et vie nocturne", lat: 31.6225, lng: -8.0128 },
  { slug: "gueliz", name: "Guéliz", tagline: "Cafés, galeries et boutiques", lat: 31.6363, lng: -8.0104 },
  { slug: "medina", name: "Médina", tagline: "Riads, souks et place Jemaa el-Fna", lat: 31.6295, lng: -7.989 },
  { slug: "palmeraie", name: "Palmeraie", tagline: "Villas au milieu des palmiers", lat: 31.6695, lng: -7.9705 },
  { slug: "agdal", name: "Agdal", tagline: "Calme, près des jardins de l'Agdal", lat: 31.601, lng: -7.9935 },
  { slug: "targa", name: "Targa", tagline: "Résidentiel et verdoyant", lat: 31.6545, lng: -8.048 },
  { slug: "ourika", name: "Route de l'Ourika", tagline: "Villas sur la route de l'Atlas", lat: 31.556, lng: -7.948 },
  { slug: "agafay", name: "Agafay", tagline: "Désert de pierres et camps", lat: 31.443, lng: -8.19 },
  { slug: "semlalia", name: "Semlalia", tagline: "Quartier calme, près de l'université", lat: 31.6465, lng: -8.0215 },
  { slug: "menara", name: "Ménara", tagline: "Près des jardins de la Ménara", lat: 31.6135, lng: -8.033 },
];
