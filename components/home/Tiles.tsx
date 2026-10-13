import Image from "next/image";
import Link from "next/link";
import type { Place } from "@/lib/types";

const altitudeFmt = new Intl.NumberFormat("fr-FR");

/** One of the launch resorts: a large photo tile linking to its search. */
export function ResortTile({ place, priority }: { place: Place; priority?: boolean }) {
  return (
    <Link href={`/s/${place.slug}/homes`} className="group block min-w-0">
      <div className="relative aspect-square overflow-hidden rounded-lg bg-line-soft md:aspect-[2/1]">
        <Image
          src={place.image}
          alt=""
          fill
          sizes="(max-width: 743px) 46vw, 50vw"
          priority={priority}
          className="object-cover transition-transform duration-500 ease-standard group-hover:scale-105"
        />
      </div>
      <p className="mt-2 truncate text-body-l font-semibold max-md:text-body">{place.name}</p>
      <p className="truncate text-ink-muted max-md:text-micro">
        {place.tagline}
        {place.altitudeM ? <span className="max-md:hidden"> · {altitudeFmt.format(place.altitudeM)}&nbsp;m</span> : null}
      </p>
    </Link>
  );
}
