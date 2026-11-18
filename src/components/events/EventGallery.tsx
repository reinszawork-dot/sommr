'use client';

import { useState } from 'react';

/** The event's own photos: one large, the rest as thumbnails that swap into the large spot. */
export function EventGallery({ photos, title }: { photos: string[]; title: string }) {
  const [active, setActive] = useState(0);
  const [broken, setBroken] = useState<string[]>([]);
  const shown = photos.filter((p) => !broken.includes(p));
  if (shown.length === 0) return null;
  const current = shown[Math.min(active, shown.length - 1)];
  const drop = (src: string) => setBroken((b) => (b.includes(src) ? b : [...b, src]));
  return (
    <div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={current} alt={`${title}: photo ${shown.indexOf(current) + 1} of ${shown.length}`} onError={() => drop(current)} className="aspect-[16/9] w-full object-cover" />
      {shown.length > 1 ? (
        <div className="grid grid-cols-4 gap-2 p-2" role="group" aria-label="More photos">
          {shown.map((src, i) => (
            <button
              key={src}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`Show photo ${i + 1}`}
              aria-pressed={src === current}
              className={`overflow-hidden rounded-xl border-2 transition-[border-color,opacity] ${src === current ? 'border-sun' : 'border-transparent opacity-75 hover:opacity-100'}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" loading="lazy" onError={() => drop(src)} className="aspect-[4/3] w-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
