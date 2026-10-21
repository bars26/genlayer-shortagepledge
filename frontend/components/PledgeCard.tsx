"use client";

import { useQuery } from "@tanstack/react-query";
import { CAUSE_LABEL, coverageOf, formatGen, parseJson, productName, productsOf, sameAddress, todayUtc, type Claim, type Pledge, type ProductLookup } from "@/lib/contracts/types";
import { formatAddress, useWallet } from "@/lib/genlayer/wallet";
import { usePledgeWrite } from "@/lib/hooks/useShortagePledge";
import { ClaimCard } from "./ClaimCard";
import { FileClaimModal } from "./FileClaimModal";
import { Shelf } from "./Shelf";
import { Button } from "./ui/button";

/** One pledge: the medicines, where they stand on FDA's list today, what can still pay, and the claims. */
export function PledgeCard({ pledge, claims }: { pledge: Pledge; claims: Claim[] }) {
  const { address } = useWallet();
  const { write, pending } = usePledgeWrite();
  const products = productsOf(pledge);
  const excused = parseJson<string[]>(pledge.excused_json, []);
  const paid = parseJson<string[]>(pledge.paid_json, []);
  const resolved = parseJson<string[]>(pledge.resolved_json, []);
  const cov = coverageOf(pledge);
  const isPledger = sameAddress(pledge.pledger, address);
  const active = pledge.state === "active";
  const due = todayUtc() > pledge.recover_by;
  const open = claims.filter((c) => c.state === "pending");
  const done = claims.filter((c) => c.state !== "pending").reverse();

  return (
    <article className="brand-card overflow-hidden">
      <div className="h-1.5 bg-gradient-to-r from-[#2F8F5B] via-[#E8A33D] to-[#C4472A]" />
      <div className="p-5 md:p-6 space-y-4">
        <header className="flex flex-wrap items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="mono text-muted-foreground">{pledge.id}</span>
              {!active && <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">closed</span>}
            </div>
            <h3 className="display text-xl font-semibold leading-snug mt-1">
              {[...new Set(products.map((p) => p.brand || p.generic))].join(", ")}{" "}
              <span className="text-base font-normal text-muted-foreground">{products[0]?.labeler}</span>
            </h3>
          </div>
          <div className="text-right">
            <p className="display text-3xl font-semibold">
              {formatGen(pledge.bond)}
              <span className="text-sm font-sans font-medium text-muted-foreground"> GEN bonded</span>
            </p>
            <p className="text-xs text-muted-foreground">pays {formatGen(pledge.payout)} GEN per medicine not back</p>
          </div>
        </header>

        <div className="rounded-xl bg-[#F3EADB] px-4 py-3 text-sm">
          <p className="font-medium">The promise</p>
          <p className="text-muted-foreground">
            Every medicine below is off FDA&apos;s drug shortage list, or listed as available, by <strong className="text-foreground">{pledge.recover_by}</strong>.{" "}
            {excused.length ? `Excused causes: ${excused.map((c) => CAUSE_LABEL[c] ?? c).join(", ")}.` : "No cause is excused."} Manufacturing problems,
            discontinuation and unexplained shortages never are.
          </p>
        </div>

        <div className="space-y-3">
          {products.map((p) => (
            <ProductRow key={p.ndc} ndc={p.ndc} name={productName(p)} state={paid.includes(p.ndc) ? "paid" : resolved.includes(p.ndc) ? "back" : "open"} />
          ))}
        </div>

        {active && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <div className="rounded-lg border border-border px-3 py-2">
              <p className="text-muted-foreground">Still payable</p>
              <p className="font-medium">{cov.open.length ? `${cov.open.length} of ${products.length} medicine${products.length === 1 ? "" : "s"}` : "nothing: every medicine is settled"}</p>
              <p className={cov.covered ? "text-[#1F6B43]" : "text-[#A3361A]"}>
                liability {formatGen(cov.liability)} GEN, bond {formatGen(pledge.bond)} GEN: {cov.covered ? "every confirmed breach is paid in full" : "under-covered"}
              </p>
            </div>
            <div className="rounded-lg border border-border px-3 py-2">
              <p className="text-muted-foreground">Reports</p>
              <p className="font-medium">{due ? `open until ${pledge.expires}` : `open from the day after ${pledge.recover_by}`}</p>
              <p className="text-muted-foreground">anyone can report, staking 10% of the payout</p>
            </div>
            <div className="rounded-lg border border-border px-3 py-2">
              <p className="text-muted-foreground">Bond locked</p>
              <p className="font-medium">until {pledge.expires}</p>
              <p className="text-muted-foreground">at least {30} days after the recovery date, and every claim settled</p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span>
            record: <strong className="text-[#1F6B43]">{String(pledge.n_kept)} back</strong> · <strong className="text-[#A3361A]">{String(pledge.n_breached)} not back</strong> ·{" "}
            {String(pledge.n_other)} other
          </span>
          <span>paid out <strong className="text-foreground">{formatGen(pledge.total_paid)} GEN</strong></span>
          <span>pledger <span className="mono">{formatAddress(pledge.pledger)}</span>{isPledger && " (you)"}</span>
          <span>beneficiary <span className="mono">{formatAddress(pledge.beneficiary)}</span></span>
        </div>

        <div className="flex flex-wrap gap-2">
          {active && cov.open.length > 0 && <FileClaimModal pledge={pledge} claims={claims} />}
          {isPledger && active && (
            <Button
              size="sm"
              variant="ghost"
              disabled={todayUtc() <= pledge.expires || open.length > 0 || pending === `withdraw:${pledge.id}`}
              title={todayUtc() <= pledge.expires ? `Locked until the pledge expires on ${pledge.expires}.` : open.length ? "Settle the open claims first." : ""}
              onClick={() => write({ kind: "withdraw", pledgeId: pledge.id })}
            >
              Withdraw bond
            </Button>
          )}
        </div>

        {claims.length > 0 && (
          <div className="space-y-2">
            {[...open, ...done].map((c) => (
              <ClaimCard key={c.id} claim={c} pledge={pledge} />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

/** A pledged medicine with its live shelf (openFDA today) and whether it can still pay. */
function ProductRow({ ndc, name, state }: { ndc: string; name: string; state: "open" | "paid" | "back" }) {
  const { data } = useQuery<{ products: ProductLookup[] }>({
    queryKey: ["product", ndc],
    queryFn: async () => (await fetch(`/api/product?q=${ndc}`)).json(),
    staleTime: 10 * 60_000,
  });
  const p = data?.products?.[0];
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="font-semibold">{name}</span>
        <span className="mono text-xs text-muted-foreground">{ndc}</span>
        <span className="text-xs text-muted-foreground">{state === "paid" ? "paid out" : state === "back" ? "ruled back on the shelf" : "can still pay"}</span>
      </div>
      {p ? <Shelf listings={p.listings} compact /> : <div className="h-16 rounded-xl bg-muted/50 animate-pulse" />}
    </div>
  );
}
