import {
  Bath,
  CableCar,
  Car,
  Check,
  CookingPot,
  Fence,
  Flame,
  Heater,
  LockKeyhole,
  Mountain,
  PawPrint,
  Tv,
  Utensils,
  WashingMachine,
  Wifi,
  type LucideIcon,
} from "lucide-react";

/**
 * Amenity rows store a lucide icon name (kebab-case, see prisma/fixtures.ts). Only the names in use are
 * imported, so the page doesn't ship the whole icon set; an unknown name falls back to a check mark.
 */
const ICONS: Record<string, LucideIcon> = {
  wifi: Wifi,
  "cooking-pot": CookingPot,
  "washing-machine": WashingMachine,
  heater: Heater,
  tv: Tv,
  utensils: Utensils,
  flame: Flame,
  "lock-keyhole": LockKeyhole,
  "cable-car": CableCar,
  car: Car,
  fence: Fence,
  bath: Bath,
  "paw-print": PawPrint,
  mountain: Mountain,
};

export function amenityIcon(name: string): LucideIcon {
  return ICONS[name] ?? Check;
}

export function Amenities({ amenities }: { amenities: { id: string; label: string; icon: string }[] }) {
  return (
    <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
      {amenities.map((a) => {
        const Icon = amenityIcon(a.icon);
        return (
          <li key={a.id} className="flex items-center gap-4 text-body-l">
            <Icon aria-hidden className="size-6 shrink-0" strokeWidth={1.5} />
            {a.label}
          </li>
        );
      })}
    </ul>
  );
}
