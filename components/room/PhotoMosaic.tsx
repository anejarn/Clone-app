import Image from "next/image";
import { cn } from "@/lib/cn";

/**
 * Five photos (alt text falls back to the listing title and position): one large and four small on tablets and up; a swipeable strip on phones. The strip is a
 * focusable region so keyboard users can scroll it too.
 */
export function PhotoMosaic({ photos, title }: { photos: { url: string; alt: string }[]; title: string }) {
  const five = photos.slice(0, 5);
  return (
    <div
      role="region"
      aria-label="Photos du logement"
      tabIndex={0}
      className={cn(
        "no-scrollbar relative flex snap-x snap-mandatory overflow-x-auto max-md:-mx-6",
        "md:grid md:aspect-[2/1] md:grid-cols-4 md:grid-rows-2 md:gap-2 md:overflow-hidden md:rounded-lg",
      )}
    >
      {five.map((p, i) => (
        <div
          key={p.url}
          className={cn("relative aspect-[4/3] w-full shrink-0 snap-start bg-line-soft md:aspect-auto", i === 0 && "md:col-span-2 md:row-span-2")}
        >
          <Image
            src={p.url}
            alt={p.alt || `${title}, photo ${i + 1} sur ${five.length}`}
            fill
            sizes={i === 0 ? "(max-width: 743px) 100vw, 560px" : "(max-width: 743px) 100vw, 280px"}
            priority={i === 0}
            className="object-cover"
          />
        </div>
      ))}
      <span aria-hidden className="pointer-events-none absolute bottom-3 right-3 rounded-sm bg-black/60 px-2 py-0.5 text-micro font-semibold text-white md:hidden">
        {five.length}&nbsp;photos
      </span>
    </div>
  );
}
