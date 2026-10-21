import { CAUSE_LABEL, SHORT, type Listing } from "@/lib/contracts/types";

/** One pill-bottle chip per package on FDA's list: green available, amber limited, brick unavailable, grey discontinued. */
export function Shelf({ listings, compact = false }: { listings?: Listing[]; compact?: boolean }) {
  if (!listings?.length) {
    return (
      <div className="shelf px-3 pt-4 pb-2 text-sm text-[#1F6B43]">
        <span className="font-semibold">Not on FDA&apos;s shortage list.</span> No package of this product is listed as short.
      </div>
    );
  }
  return (
    <div className="shelf px-3 pt-5 pb-2">
      <div className="flex flex-wrap gap-3">
        {listings.map((l) => {
          const tone = toneOf(l);
          return (
            <div key={l.package} className={`bottle border px-3 py-2 ${tone.cls} ${compact ? "min-w-[9rem]" : "min-w-[11rem]"}`} title={l.presentation}>
              <p className="mono text-[11px] opacity-80">{l.package}</p>
              <p className="text-sm font-semibold leading-tight">{tone.label}</p>
              <p className="text-[11px] opacity-80">FDA re-verified {l.updated || "?"}</p>
              {l.cause && <p className="text-[11px] opacity-80">cause: {CAUSE_LABEL[l.cause] ?? l.cause}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function toneOf(l: Listing) {
  if (l.status === "To Be Discontinued") return { label: `Discontinued ${l.discontinued || ""}`.trim(), cls: "bg-[#EEE9F2] text-[#4B3D57] border-[#D9CFE2]" };
  if (l.status === "Resolved") return { label: "Resolved", cls: "bg-[#DDF1E4] text-[#1F6B43] border-[#B5DFC4]" };
  if (l.availability === "Limited Availability") return { label: "Limited", cls: "bg-[#FDF0D5] text-[#8A5A08] border-[#F3DCA6]" };
  if (SHORT.includes(l.availability)) return { label: "Unavailable", cls: "bg-[#FBE3DA] text-[#A3361A] border-[#F2C2B2]" };
  return { label: l.availability || "Listed", cls: "bg-[#DDF1E4] text-[#1F6B43] border-[#B5DFC4]" };
}
