"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  CAUSE_LABEL,
  EXCUSABLE,
  MAX_PRODUCTS,
  MIN_PAYOUT_WEI,
  NDC_RE,
  REPORT_DAYS,
  addDays,
  formatGen,
  parseGen,
  todayUtc,
  type ProductLookup,
} from "@/lib/contracts/types";
import { usePledgeWrite } from "@/lib/hooks/useShortagePledge";
import { useWallet } from "@/lib/genlayer/wallet";
import { Shelf } from "./Shelf";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const inSixtyDays = () => addDays(todayUtc(), 60);

/** Back medicines with GEN: plain-language terms, checked here with the contract's rules. */
export function CreatePledgeModal({ open, onOpenChange, ndc: initialNdc }: { open: boolean; onOpenChange: (o: boolean) => void; ndc: string }) {
  const { address, isConnected } = useWallet();
  const { writeAsync, pending } = usePledgeWrite();
  const [f, setF] = useState({ ndcs: initialNdc, recoverBy: inSixtyDays(), excused: [] as string[], payout: "2", bond: "", beneficiary: "", expires: "" });
  const [found, setFound] = useState<Record<string, ProductLookup>>({});

  useEffect(() => {
    if (open && initialNdc) setF((x) => ({ ...x, ndcs: initialNdc }));
  }, [open, initialNdc]);

  const ndcs = [...new Set(f.ndcs.split(/[,\s]+/).map((n) => n.trim()).filter(Boolean))];
  const key = ndcs.join(",");
  useEffect(() => {
    let cancelled = false;
    ndcs.filter((n) => NDC_RE.test(n) && !found[n]).forEach((n) =>
      fetch(`/api/product?q=${n}`)
        .then((r) => r.json())
        .then((d) => !cancelled && d.products?.[0] && setFound((m) => ({ ...m, [n]: d.products[0] })))
        .catch(() => {})
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const payout = parseGen(f.payout);
  const minBond = payout ? payout * BigInt(Math.max(ndcs.length, 1)) : null;
  const bond = f.bond ? parseGen(f.bond) : minBond;
  const minExpires = /^\d{4}-\d{2}-\d{2}$/.test(f.recoverBy) ? addDays(f.recoverBy, REPORT_DAYS) : "";
  const expires = f.expires || (minExpires ? addDays(minExpires, 60) : "");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const toggle = (c: string) => setF({ ...f, excused: f.excused.includes(c) ? f.excused.filter((x) => x !== c) : [...f.excused, c] });

  const problems = [
    (ndcs.length === 0 || ndcs.length > MAX_PRODUCTS || ndcs.some((n) => !NDC_RE.test(n))) && `Enter 1 to ${MAX_PRODUCTS} product NDCs like 0641-6000.`,
    ...ndcs.filter((n) => found[n] && !found[n].found).map((n) => `${n} is not in FDA's NDC directory.`),
    !/^\d{4}-\d{2}-\d{2}$/.test(f.recoverBy) && "Pick the date the medicines will be back.",
    !(payout && payout >= MIN_PAYOUT_WEI) && "The payout must be at least 1 GEN.",
    !(bond && minBond && bond >= minBond) && `The bond must cover every medicine: at least ${ndcs.length || 1} × the payout.`,
    !/^0x[0-9a-fA-F]{40}$/.test(f.beneficiary.trim()) && "Enter the beneficiary's wallet address.",
    (!expires || expires < todayUtc() || (minExpires && expires < minExpires)) && `The pledge must run until ${minExpires || "30 days after the recovery date"} or later.`,
  ].filter(Boolean) as string[];

  const submit = async () => {
    if (problems.length || !payout || !bond) return;
    try {
      await writeAsync({
        kind: "create",
        bond,
        input: { ndcs, recoverBy: f.recoverBy, excused: f.excused, payout, beneficiary: f.beneficiary.trim(), expires },
      });
      onOpenChange(false);
    } catch {
      // shown in the toast and the transactions panel
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="display text-2xl">Back a medicine with a pledge</DialogTitle>
          <DialogDescription>
            Your GEN stands behind one promise: these medicines are off FDA&apos;s shortage list, or listed as available, by the date you choose.
            Validators freeze each product and its listing today.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="space-y-1">
            <Label>Product NDCs (up to {MAX_PRODUCTS}, comma-separated)</Label>
            <Input value={f.ndcs} onChange={set("ndcs")} placeholder="0641-6000, 0641-6001" className="mono" />
            {ndcs.map((n) =>
              found[n]?.found ? (
                <div key={n} className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    <span className="mono">{n}</span> · {found[n].brand} {found[n].strength} · {found[n].labeler}
                  </p>
                  <Shelf listings={found[n].listings} compact />
                </div>
              ) : null
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Back on the shelf by</Label>
              <Input type="date" value={f.recoverBy} onChange={set("recoverBy")} />
            </div>
            <div className="space-y-1">
              <Label>Pledge open until</Label>
              <Input type="date" value={expires} onChange={set("expires")} />
              {minExpires && <p className="text-[11px] text-muted-foreground">Earliest: {minExpires} (recovery date + {REPORT_DAYS} days to report).</p>}
            </div>
            <div className="space-y-1">
              <Label>Payout per medicine not back (GEN)</Label>
              <Input value={f.payout} onChange={set("payout")} inputMode="decimal" />
            </div>
            <div className="space-y-1">
              <Label>Bond (GEN)</Label>
              <Input value={f.bond} onChange={set("bond")} inputMode="decimal" placeholder={minBond ? formatGen(minBond) : ""} />
              <p className="text-[11px] text-muted-foreground">At least medicines × payout, so every breach is paid in full.</p>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Causes you excuse (optional)</Label>
            <div className="flex flex-wrap gap-2">
              {EXCUSABLE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggle(c)}
                  className={`rounded-full border px-3 py-1 text-xs ${f.excused.includes(c) ? "border-[#3A1F4B] bg-[#3A1F4B] text-white" : "border-border hover:bg-muted"}`}
                >
                  {CAUSE_LABEL[c]}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">Manufacturing problems, discontinuation and unexplained shortages are never excused.</p>
          </div>
          <div className="space-y-1">
            <Label>Beneficiary wallet</Label>
            <div className="flex gap-2">
              <Input value={f.beneficiary} onChange={set("beneficiary")} placeholder="0x… e.g. a hospital pharmacy fund" className="mono" />
              {address && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setF({ ...f, beneficiary: address })}>
                  Use mine
                </Button>
              )}
            </div>
          </div>
        </div>
        {problems.length > 0 && f.ndcs && (
          <ul className="text-xs text-[#A3361A] list-disc pl-4">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <Button onClick={submit} className="w-full" disabled={!isConnected || problems.length > 0 || pending === "create"}>
          {pending === "create" && <Loader2 className="w-4 h-4 animate-spin" />}
          {isConnected ? `Bond ${bond ? formatGen(bond) : "?"} GEN and pledge` : "Connect a wallet to pledge"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
