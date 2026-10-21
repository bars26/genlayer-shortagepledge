/** Types and display helpers for the ShortagePledge contract. */

export type Verdict = "BREACHED" | "KEPT" | "NOT_COVERED" | "UNCLEAR";
type Num = string | number | bigint;

/** A pledged product as frozen when the pledge was made (FDA NDC directory + its shortage listing). */
export interface Product {
  ndc: string;
  brand: string;
  generic: string;
  labeler: string;
  form: string;
  strength: string;
  listed_at_pledge: { package: string; status: string; availability: string; updated: string }[];
}

export interface Pledge {
  id: string;
  pledger: string;
  products_json: string;
  recover_by: string;
  excused_json: string;
  payout: Num;
  beneficiary: string;
  expires: string;
  state: "active" | "closed";
  bond: Num;
  total_bonded: Num;
  total_paid: Num;
  stakes_kept: Num;
  pending: Num;
  paid_json: string;
  resolved_json: string;
  claim_ids_json: string;
  n_breached: Num;
  n_kept: Num;
  n_other: Num;
  history_json: string;
}

export interface Claim {
  id: string;
  pledge_id: string;
  ndc: string;
  claimant: string;
  stake: Num;
  filed_at: string;
  window_from: string;
  state: "pending" | "settled";
  verdict: Verdict;
  code: string;
  facts_json: string;
  evidence_json: string;
  why: string;
  pledger_contested: boolean;
  claimant_contested: boolean;
  outcome: "" | "paid" | "stake_returned" | "stake_to_bond";
  timeline_json: string;
}

/** What every validator read and agreed on for a ruling. */
export interface ClaimFacts {
  ndc?: string;
  name?: string;
  recover_by?: string;
  availability?: string;
  updated?: string;
  discontinued?: string;
  cause?: string;
  cause_by?: "fda" | "validators" | "";
  availability_seen?: string;
}

export interface Listing {
  package: string;
  status: string;
  availability: string;
  updated: string;
  reason?: string;
  info?: string;
  discontinued?: string;
  company?: string;
  presentation?: string;
  cause?: string;
  cause_by?: string;
}

/** One reading's evidence packet: the exact openFDA records validators read, with hashes. */
export interface EvidencePacket {
  source?: string;
  record?: string;
  state?: string;
  data_version?: string;
  listings?: Listing[];
  listings_sha256?: string;
  read_at?: string;
  packet_sha256?: string;
}

/** A product as /api/product reports it: NDC directory facts plus every package on FDA's shortage list. */
export interface ProductLookup {
  ndc: string;
  found: boolean;
  error?: string;
  brand?: string;
  generic?: string;
  labeler?: string;
  form?: string;
  strength?: string;
  listings?: Listing[];
  shelf?: "short" | "listed_available" | "discontinued" | "not_listed";
}

export interface TimelineStep {
  at: string;
  event: "filed" | "contested" | "settled";
  by?: string;
  before?: string;
  verdict?: string;
  code?: string;
  outcome?: string;
  amount?: string;
  beneficiary?: string;
  reporter?: string;
  evidence?: string;
}

export const RESPONSE_WINDOW_SECONDS = 600;
export const MIN_PAYOUT_WEI = 10n ** 18n;
export const REPORT_DAYS = 30;
export const MAX_PRODUCTS = 5;
export const NDC_RE = /^\d{4,5}-\d{3,4}$/;
export const SHORT = ["Unavailable", "Unvailable", "Limited Availability"];

export const EXCUSABLE = ["DEMAND_INCREASE", "INGREDIENT_SHORTAGE", "SHIPPING_DELAY", "REGULATORY_DELAY"] as const;
export const CAUSE_LABEL: Record<string, string> = {
  DEMAND_INCREASE: "demand increase",
  INGREDIENT_SHORTAGE: "ingredient shortage",
  SHIPPING_DELAY: "shipping delay",
  REGULATORY_DELAY: "regulatory delay",
  MANUFACTURING: "manufacturing problem",
  DISCONTINUATION: "discontinued",
  UNSTATED: "no cause stated",
};

export function wei(v: Num | undefined): bigint {
  try {
    return BigInt(String(v ?? "0").split(".")[0]);
  } catch {
    return 0n;
  }
}

export function formatGen(v: Num | undefined, digits = 2): string {
  const n = Number(wei(v)) / 1e18;
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function parseGen(input: string): bigint | null {
  const t = input.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  return BigInt(whole) * 10n ** 18n + BigInt((frac + "0".repeat(18)).slice(0, 18));
}

export function parseJson<T>(json: string | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export const sameAddress = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export function utcMs(iso: string): number {
  if (!iso) return NaN;
  const t = iso.trim();
  return Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(t) ? t : `${t}Z`);
}

export function windowLeftSeconds(claim: Claim, now = Date.now()): number {
  return Math.max(0, Math.ceil(RESPONSE_WINDOW_SECONDS - (now - utcMs(claim.window_from)) / 1000));
}

export const todayUtc = () => new Date().toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const factsOf = (c: Claim) => parseJson<ClaimFacts>(c.facts_json, {});
export const timelineOf = (c: Claim) => parseJson<TimelineStep[]>(c.timeline_json, []);
export const productsOf = (p: Pledge) => parseJson<Product[]>(p.products_json, []);
export const evidenceOf = (c: Claim) => parseJson<EvidencePacket[]>(c.evidence_json, []);
export const stakeFor = (p: Pledge) => wei(p.payout) / 10n;
export const productName = (p?: Pick<Product, "brand" | "generic" | "strength">) =>
  p ? `${p.brand || p.generic} ${p.strength}`.trim() : "";
export const dsdUrl = "https://dps.fda.gov/drugshortages";

/** Products that can still pay (neither paid nor ruled back) and the liability they carry; same rule as the contract. */
export function coverageOf(p: Pledge) {
  const done = new Set([...parseJson<string[]>(p.paid_json, []), ...parseJson<string[]>(p.resolved_json, [])]);
  const open = p.state === "active" ? productsOf(p).map((x) => x.ndc).filter((n) => !done.has(n)) : [];
  const liability = wei(p.payout) * BigInt(open.length);
  return { open, liability, covered: wei(p.bond) >= liability };
}

/** How a product stands on FDA's list, from its listings (same order of checks as the contract). */
export function shelfOf(listings: Listing[] | undefined, today = todayUtc()): ProductLookup["shelf"] {
  if (!listings?.length) return "not_listed";
  if (listings.some((x) => x.status === "To Be Discontinued" && x.discontinued && x.discontinued <= today)) return "discontinued";
  if (listings.some((x) => x.status === "Current" && SHORT.includes(x.availability))) return "short";
  return "listed_available";
}

export const VERDICT_STYLE: Record<Verdict, { label: string; cls: string; help: string }> = {
  BREACHED: {
    label: "Not back",
    cls: "bg-[#FBE3DA] text-[#A3361A] border-[#F2C2B2]",
    help: "The bond pays the beneficiary, and the reporter gets 10%.",
  },
  KEPT: {
    label: "Back on the shelf",
    cls: "bg-[#DDF1E4] text-[#1F6B43] border-[#B5DFC4]",
    help: "The reporter's stake goes to the bond.",
  },
  NOT_COVERED: {
    label: "Excused",
    cls: "bg-[#EFE8F7] text-[#4B2E6B] border-[#DCCFEC]",
    help: "Still short, but for a cause this pledge excuses. The stake goes to the bond.",
  },
  UNCLEAR: {
    label: "Undecided",
    cls: "bg-[#FDF0D5] text-[#8A5A08] border-[#F3DCA6]",
    help: "openFDA could not be read, or FDA has not re-verified the listing since the promised date. The stake comes back.",
  },
};

export const OUTCOME_TEXT: Record<string, string> = {
  paid: "Paid from the bond",
  stake_returned: "Stake returned to the reporter",
  stake_to_bond: "Stake added to the bond",
};

export const CODE_LABEL: Record<string, string> = {
  not_listed: "not on FDA's list",
  available: "listed, but available",
  stale: "listing not re-verified",
  discontinued: "discontinued",
  not_recovered: "still short",
  excused: "excused cause",
  unreachable: "openFDA unreachable",
};
