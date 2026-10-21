/**
 * Wallet-free lookups against openFDA, read the same way the contract reads them:
 *
 *   /api/product?q=0641-6000    one product: FDA NDC directory facts + every package on the drug shortage list
 *   /api/product?q=lorazepam    products of that drug on the shortage list (up to 6)
 *
 * The rulings themselves (is the medicine back by the promised date, and is the cause excused?) are
 * made on-chain by the validators.
 */

import { NDC_RE, shelfOf, type Listing, type ProductLookup } from "@/lib/contracts/types";

export const dynamic = "force-dynamic";

const FDA = "https://api.fda.gov/drug";

async function fda(url: string): Promise<{ state: "ok" | "none" | "error"; results: any[] }> {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" }, next: { revalidate: 600 } });
    const body = await res.json().catch(() => null);
    if (res.status === 404 && body?.error?.code === "NOT_FOUND") return { state: "none", results: [] };
    if (!res.ok || !body) return { state: "error", results: [] };
    return { state: "ok", results: body.results ?? [] };
  } catch {
    return { state: "error", results: [] };
  }
}

const iso = (d?: string) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((d || "").trim());
  return m ? `${m[3]}-${m[1]}-${m[2]}` : "";
};

function toListing(r: any): Listing {
  return {
    package: String(r.package_ndc || ""),
    status: String(r.status || ""),
    availability: String(r.availability || ""),
    updated: iso(r.update_date),
    reason: String(r.shortage_reason || ""),
    info: String(r.related_info || "").replace(/\s+/g, " ").trim(),
    discontinued: iso(r.discontinued_date),
    company: String(r.company_name || ""),
    presentation: String(r.presentation || ""),
  };
}

const cache = { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } };

async function product(ndc: string): Promise<ProductLookup> {
  const [dir, short] = await Promise.all([
    fda(`${FDA}/ndc.json?search=product_ndc:%22${ndc}%22&limit=1`),
    fda(`${FDA}/shortages.json?search=package_ndc:${ndc}-*&limit=100`),
  ]);
  if (dir.state === "error" || short.state === "error") return { ndc, found: false, error: "openFDA could not be reached; try again in a minute." };
  if (dir.state === "none" || !dir.results[0]) return { ndc, found: false, error: `${ndc} is not in FDA's NDC directory.` };
  const r = dir.results[0];
  const listings = short.results.map(toListing).filter((l) => l.package.startsWith(`${ndc}-`)).sort((a, b) => a.package.localeCompare(b.package));
  return {
    ndc,
    found: true,
    brand: r.brand_name,
    generic: r.generic_name,
    labeler: r.labeler_name,
    form: r.dosage_form,
    strength: (r.active_ingredients || []).map((a: any) => a.strength).join("; "),
    listings,
    shelf: shelfOf(listings),
  };
}

export async function GET(req: Request) {
  const raw = (new URL(req.url).searchParams.get("q") || "").trim();
  const ndcMatch = /^(\d{4,5}-\d{3,4})(-\d{1,2})?$/.exec(raw);
  if (ndcMatch && NDC_RE.test(ndcMatch[1])) return Response.json({ products: [await product(ndcMatch[1])] }, cache);
  const name = raw.toLowerCase().replace(/[^a-z0-9 -]/g, "").trim();
  if (name.length < 3) return Response.json({ products: [], error: "Type a product NDC like 0641-6000, or a drug name." }, { status: 400 });
  const found = await fda(`${FDA}/shortages.json?search=generic_name:%22${encodeURIComponent(name)}%22&limit=100`);
  if (found.state === "error") return Response.json({ products: [], error: "openFDA could not be reached; try again in a minute." }, cache);
  const ndcs = [...new Set(found.results.map((r) => String(r.package_ndc || "").split("-").slice(0, 2).join("-")).filter((n) => NDC_RE.test(n)))].slice(0, 6);
  const products = (await Promise.all(ndcs.map(product))).filter((p) => p.found);
  products.sort((a, b) => Number(b.shelf === "short") - Number(a.shelf === "short"));
  return Response.json({ products }, cache);
}
