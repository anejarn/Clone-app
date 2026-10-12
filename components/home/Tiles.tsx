import Image from "next/image";
import Link from "next/link";
import type { Place, Service } from "@/lib/types";

export function DestinationTile({ place }: { place: Place }) {
  return (
    <Link href={`/s/${place.slug}/homes`} className="group block">
      <div className="relative aspect-square overflow-hidden rounded-md bg-line-soft">
        <Image src={place.image} alt="" fill sizes="(max-width: 743px) 42vw, 200px" className="object-cover transition-transform duration-500 ease-standard group-hover:scale-105" />
      </div>
      <p className="mt-2 truncate text-caption font-medium">{place.name}</p>
      <p className="truncate text-micro text-ink-muted">{place.tagline}</p>
    </Link>
  );
}

export function ServiceTile({ service }: { service: Service }) {
  return (
    <Link href="/services" className="group block">
      <div className="grid aspect-square place-items-center rounded-md bg-surface-2 text-[52px] transition-colors group-hover:bg-line-soft">
        <span aria-hidden className="transition-transform duration-300 ease-standard group-hover:scale-110">
          {service.emoji}
        </span>
      </div>
      <p className="mt-2.5 truncate font-medium">{service.label}</p>
    </Link>
  );
}
