"use client";

import { useState } from "react";
import { ExternalLink, Loader2, Search } from "lucide-react";
import { dsdUrl, type ProductLookup as Product } from "@/lib/contracts/types";
import { Shelf } from "./Shelf";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const EXAMPLES = [
  { q: "0641-6000", label: "Ativan injection (unavailable)" },
  { q: "0264-9872", label: "heparin (limited)" },
  { q: "lorazepam", label: "search a drug name" },
];

const SHELF_TEXT: Record<NonNullable<Product["shelf"]>, string> = {
  short: "Short right now on FDA's list.",
  listed_available: "On FDA's list, but available.",
  discontinued: "Discontinued by its maker.",
  not_listed: "Not on FDA's shortage list.",
};

/** No wallet needed: look a medicine up by product NDC or drug name and see its packages on FDA's shortage list. */
export function ProductLookup({ onPledge }: { onPledge: (ndc: string) => void }) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ products: Product[]; error?: string } | null>(null);

  const run = async (query: string) => {
    const v = query.trim();
    if (!v) return;
    setQ(v);
    setLoading(true);
    setResult(null);
    try {
      setResult(await (await fetch(`/api/product?q=${encodeURIComponent(v)}`)).json());
    } catch {
      setResult({ products: [], error: "openFDA could not be reached; try again in a minute." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="brand-card p-5 md:p-6 space-y-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(q);
        }}
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Product NDC (0641-6000) or drug name" className="pl-9 h-11" />
        </div>
        <Button type="submit" className="h-11" disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Check the shelf"}
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">
        Try:{" "}
        {EXAMPLES.map((x, i) => (
          <span key={x.q}>
            <button type="button" className="mono text-[#3A1F4B] underline-offset-2 hover:underline" onClick={() => run(x.q)}>
              {x.q}
            </button>{" "}
            ({x.label}){i < EXAMPLES.length - 1 ? " · " : ""}
          </span>
        ))}
      </p>

      {result?.error && <p className="text-sm text-[#A3361A]">{result.error}</p>}
      {result && !result.error && result.products.length === 0 && (
        <p className="text-sm text-muted-foreground">No product of that drug is on FDA&apos;s shortage list right now.</p>
      )}
      <div className="space-y-4 max-h-[34rem] overflow-y-auto pr-1">
        {result?.products.map((p) =>
          p.found ? (
            <div key={p.ndc} className="space-y-2">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="display text-xl font-semibold">{p.brand}</h3>
                <span className="text-sm text-muted-foreground">
                  {p.generic} · {p.strength} · {p.form?.toLowerCase()}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                <span className="mono">{p.ndc}</span> · {p.labeler} ·{" "}
                <a href={dsdUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
                  FDA drug shortages <ExternalLink className="w-3 h-3" />
                </a>
              </p>
              <Shelf listings={p.listings} />
              {p.listings?.[0]?.info && <p className="text-xs text-muted-foreground">FDA notes: {p.listings[0].info}</p>}
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium">{p.shelf ? SHELF_TEXT[p.shelf] : ""}</span>
                <Button size="sm" variant="outline" onClick={() => onPledge(p.ndc)}>
                  Back this medicine with a pledge
                </Button>
              </div>
            </div>
          ) : (
            <p key={p.ndc} className="text-sm text-[#A3361A]">{p.error}</p>
          )
        )}
      </div>
    </div>
  );
}
