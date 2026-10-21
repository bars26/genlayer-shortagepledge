"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { formatGen, parseJson, productName, productsOf, stakeFor, todayUtc, type Claim, type Pledge, type ProductLookup } from "@/lib/contracts/types";
import { usePledgeWrite } from "@/lib/hooks/useShortagePledge";
import { useWallet } from "@/lib/genlayer/wallet";
import { Shelf } from "./Shelf";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";

/** Report a medicine that is not back: pick it, see FDA's list today, then stake and file. */
export function FileClaimModal({ pledge, claims }: { pledge: Pledge; claims: Claim[] }) {
  const { isConnected } = useWallet();
  const { writeAsync, pending } = usePledgeWrite();
  const [open, setOpen] = useState(false);
  const products = productsOf(pledge);
  const [ndc, setNdc] = useState(products[0]?.ndc ?? "");
  const stake = stakeFor(pledge);
  const { data } = useQuery<{ products: ProductLookup[] }>({
    queryKey: ["product", ndc],
    queryFn: async () => (await fetch(`/api/product?q=${ndc}`)).json(),
    enabled: open && !!ndc,
    staleTime: 10 * 60_000,
  });
  const live = data?.products?.[0];
  // The same rules the contract applies; a claim it would refund is blocked here with the reason.
  const paid = parseJson<string[]>(pledge.paid_json, []);
  const resolved = parseJson<string[]>(pledge.resolved_json, []);
  const openClaim = claims.find((c) => c.state === "pending" && c.ndc === ndc);
  const blocked =
    todayUtc() <= pledge.recover_by
      ? `The medicines were promised back by ${pledge.recover_by}; reports open the day after.`
      : todayUtc() > pledge.expires
        ? `This pledge expired on ${pledge.expires}.`
        : paid.includes(ndc)
          ? "This medicine has already been paid from this pledge."
          : resolved.includes(ndc)
            ? "This medicine has already been ruled back on the shelf."
            : openClaim
              ? `${openClaim.id} is already open for this medicine; follow it on the card.`
              : "";

  const submit = async () => {
    try {
      await writeAsync({ kind: "file", pledgeId: pledge.id, ndc });
      setOpen(false);
    } catch {
      // shown in the toast and the transactions panel
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Report a medicine still short
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="display text-2xl">Which medicine is not back?</DialogTitle>
          <DialogDescription>
            You stake <strong>{formatGen(stake)} GEN</strong>. If validators find it still short for a cause the pledge does not excuse, you get it back
            plus <strong>{formatGen(stake)} GEN</strong>; if it is back or excused, your stake goes to the bond; if openFDA cannot be read, or FDA has
            not re-verified the listing since {pledge.recover_by}, it comes back.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {products.map((p) => (
            <label key={p.ndc} className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer ${ndc === p.ndc ? "border-[#3A1F4B] bg-[#F3EADB]" : "border-border"}`}>
              <input type="radio" name="ndc" checked={ndc === p.ndc} onChange={() => setNdc(p.ndc)} />
              <span className="font-medium">{productName(p)}</span>
              <span className="mono text-xs text-muted-foreground">{p.ndc}</span>
            </label>
          ))}
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium">FDA&apos;s list today</p>
          {live ? <Shelf listings={live.listings} compact /> : <div className="h-16 rounded-xl bg-muted/50 animate-pulse" />}
          {live?.shelf === "not_listed" || live?.shelf === "listed_available" ? (
            <p className="text-xs text-[#8A5A08]">It looks back on the shelf: the ruling would likely keep the promise and your stake would go to the bond.</p>
          ) : null}
        </div>
        {blocked && <p className="text-xs text-[#8A5A08]">{blocked}</p>}
        <Button className="w-full" onClick={submit} disabled={!isConnected || !!blocked || pending === `file:${pledge.id}`}>
          {pending === `file:${pledge.id}` && <Loader2 className="w-4 h-4 animate-spin" />}
          {isConnected ? `Stake ${formatGen(stake)} GEN and report` : "Connect a wallet to report"}
        </Button>
        <p className="text-xs text-muted-foreground">Validators read FDA&apos;s drug shortage list during the transaction; it usually takes 1 to 3 minutes.</p>
      </DialogContent>
    </Dialog>
  );
}
