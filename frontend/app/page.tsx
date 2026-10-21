"use client";

import { useState } from "react";
import { HandCoins, Loader2, PackageSearch, RefreshCw, Scale, Wallet } from "lucide-react";
import { CreatePledgeModal } from "@/components/CreatePledgeModal";
import { Navbar } from "@/components/Navbar";
import { PledgeCard } from "@/components/PledgeCard";
import { ProductLookup } from "@/components/ProductLookup";
import { TransactionPanel } from "@/components/TransactionPanel";
import { Button } from "@/components/ui/button";
import { formatGen, productsOf, wei } from "@/lib/contracts/types";
import { useRegistry } from "@/lib/hooks/useShortagePledge";

const STEPS = [
  { icon: HandCoins, title: "A maker pledges", body: "GEN is locked behind a promise: these medicines are back on the shelf by a date the maker picks." },
  { icon: PackageSearch, title: "Anyone checks", body: "Look a medicine up on FDA's shortage list. Still short after the date? Report it by staking 10% of the payout." },
  { icon: Scale, title: "Validators decide", body: "Each GenLayer validator reads FDA's list itself, and the cause when FDA only says \"Other\". Every ruling comes with its reason." },
  { icon: Wallet, title: "Money follows", body: "A medicine not back pays the beneficiary (say, a hospital pharmacy) in full and rewards the reporter." },
];

export default function HomePage() {
  const { pledges, claims, isLoading, isError, error, isFetching, refetch, fetchedAt } = useRegistry();
  const [modal, setModal] = useState<{ open: boolean; ndc: string }>({ open: false, ndc: "" });
  const ordered = [...pledges].sort((a, b) => Number(b.id.split("_")[1]) - Number(a.id.split("_")[1]));
  const bonded = pledges.filter((p) => p.state === "active").reduce((t, p) => t + wei(p.bond), 0n);
  const medicines = new Set(pledges.flatMap((p) => productsOf(p).map((x) => x.ndc))).size;
  const paidOut = claims.filter((c) => c.outcome === "paid").length;

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar onPledge={() => setModal({ open: true, ndc: "" })} />
      <main className="flex-grow pt-24 pb-12 px-4 md:px-6">
        <div className="max-w-6xl mx-auto space-y-10">
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            <div className="lg:col-span-5 space-y-4 lg:pt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#7A4E9C]">Drug shortages, with money on the recovery date</p>
              <h1 className="display text-4xl md:text-5xl font-semibold leading-[1.05]">Is the medicine back on the shelf?</h1>
              <p className="text-lg text-muted-foreground">
                Hundreds of medicines sit on FDA&apos;s shortage list, often with a recovery date that keeps slipping. On ShortagePledge a maker puts GEN
                behind its date, and GenLayer validators check FDA&apos;s list themselves when the date comes.
              </p>
              <dl className="flex gap-6 pt-1">
                <div>
                  <dt className="text-xs text-muted-foreground">GEN bonded</dt>
                  <dd className="display text-2xl font-semibold">{formatGen(bonded, 1)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">medicines backed</dt>
                  <dd className="display text-2xl font-semibold">{medicines}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">shortages paid</dt>
                  <dd className="display text-2xl font-semibold">{paidOut}</dd>
                </div>
              </dl>
            </div>
            <div className="lg:col-span-7">
              <ProductLookup onPledge={(ndc) => setModal({ open: true, ndc })} />
            </div>
          </section>

          <section>
            <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {STEPS.map(({ icon: Icon, title, body }, i) => (
                <li key={title} className="rounded-2xl border border-border bg-white/70 p-4">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#3A1F4B] text-xs font-semibold text-white">{i + 1}</span>
                    <Icon className="w-4 h-4 text-[#2F8F5B]" />
                    <span className="font-semibold">{title}</span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{body}</p>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-muted-foreground">
              Browsing and checking need no wallet. To pledge or report, connect MetaMask and press Test GEN for free GenLayer Studio tokens. The pledges
              below are demo pledges made by test wallets, not by the manufacturers.
            </p>
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-8 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="display text-2xl font-semibold">Backed medicines</h2>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {fetchedAt && <span>updated {new Date(fetchedAt).toLocaleTimeString()}</span>}
                  <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh">
                    {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
              {isLoading && <p className="text-sm text-muted-foreground">Reading the pledges from GenLayer Studio…</p>}
              {isError && <p className="rounded-xl border border-[#F2C2B2] bg-[#FBE3DA] p-3 text-sm">Could not read the pledges: {error?.message}. Try Refresh in a minute.</p>}
              {!isLoading && !isError && ordered.length === 0 && <p className="text-sm text-muted-foreground">No medicine is backed yet. Check one above and be the first.</p>}
              {ordered.map((p) => (
                <div id={p.id} key={p.id}>
                  <PledgeCard pledge={p} claims={claims.filter((c) => c.pledge_id === p.id)} />
                </div>
              ))}
            </div>
            <aside className="lg:col-span-4 space-y-6">
              <div className="brand-card p-5 space-y-3 text-sm">
                <h3 className="display text-lg font-semibold">How a ruling is made</h3>
                <p>
                  <strong>Read in code.</strong> Validators read every package of the product on FDA&apos;s shortage list (openFDA). Not listed, or listed as
                  available: back. Listed as discontinued: not back. Unavailable or limited: still short, if FDA re-verified it after the promised date;
                  otherwise nothing is decided yet.
                </p>
                <p>
                  <strong>The cause.</strong> FDA&apos;s own category decides it in code. When FDA only says &quot;Other&quot;, validators read FDA&apos;s notes and
                  name the cause. Manufacturing problems, discontinuation and unexplained shortages are never excused.
                </p>
                <p>
                  <strong>Always paid in full.</strong> The bond covers every medicine (medicines × payout), each pays once, and the bond stays until 30
                  days after the recovery date. Every ruling keeps the exact listings read, with sha256 hashes.
                </p>
                <p>
                  <strong>Fair play.</strong> Only the side a ruling goes against can ask for a fresh reading, once, within 10 minutes. Nobody can rush a
                  payout in their own favour. If openFDA is down, nothing is decided and the stake comes back.
                </p>
              </div>
              <TransactionPanel />
            </aside>
          </section>
        </div>
      </main>
      <footer className="border-t border-border py-4 text-center text-sm text-muted-foreground">
        Data:{" "}
        <a href="https://open.fda.gov/apis/drug/drugshortages/" target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
          openFDA drug shortages
        </a>{" "}
        and{" "}
        <a href="https://open.fda.gov/apis/drug/ndc/" target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
          NDC directory
        </a>
        {" · "}
        <a href="https://genlayer.com" target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
          Built on GenLayer
        </a>
        {" · "}
        <a href="https://github.com/bars26/genlayer-shortagepledge" target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
          Source
        </a>
        {" · "}Not medical advice; rulings are about FDA&apos;s shortage list only.
      </footer>
      <CreatePledgeModal open={modal.open} ndc={modal.ndc} onOpenChange={(open) => setModal((m) => ({ ...m, open }))} />
    </div>
  );
}
