"use client";

import { Loader2 } from "lucide-react";
import {
  CAUSE_LABEL,
  CODE_LABEL,
  OUTCOME_TEXT,
  VERDICT_STYLE,
  evidenceOf,
  factsOf,
  formatGen,
  sameAddress,
  timelineOf,
  windowLeftSeconds,
  type Claim,
  type EvidencePacket,
  type Pledge,
} from "@/lib/contracts/types";
import { formatAddress, useWallet } from "@/lib/genlayer/wallet";
import { useNow } from "@/lib/hooks/useNow";
import { usePledgeWrite } from "@/lib/hooks/useShortagePledge";
import { Button } from "./ui/button";

/** One claim: the ruling, its reason, what FDA's list said, its timeline and what you can do now. */
export function ClaimCard({ claim, pledge }: { claim: Claim; pledge: Pledge }) {
  const { address } = useWallet();
  const { write, pending } = usePledgeWrite();
  const now = useNow(1000);
  const f = factsOf(claim);
  const steps = timelineOf(claim);
  const packets = evidenceOf(claim);
  const left = windowLeftSeconds(claim, now);
  const open = claim.state === "pending";
  const breach = claim.verdict === "BREACHED";
  const isPledger = sameAddress(pledge.pledger, address);
  const isReporter = sameAddress(claim.claimant, address);
  const canContest = open && left > 0 && (breach ? isPledger && !claim.pledger_contested : isReporter && !claim.claimant_contested);
  const canSettle = open && (left === 0 || (breach ? isPledger : isReporter));
  const busy = pending === `contest:${claim.id}` || pending === `settle:${claim.id}`;
  const v = VERDICT_STYLE[claim.verdict];

  return (
    <div className="rounded-xl border border-border bg-[#FFFCF7] p-4 space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${v?.cls}`} title={v?.help}>
          {v?.label}
        </span>
        <span className="font-medium">{f.name || claim.ndc}</span>
        <span className="mono text-xs text-muted-foreground">{claim.ndc}</span>
        <span className="text-xs text-muted-foreground">{CODE_LABEL[claim.code] ?? claim.code}</span>
        <span className="ml-auto text-xs mono text-muted-foreground">{claim.id}</span>
      </div>

      <p className="leading-relaxed">
        <span className="font-semibold">Why: </span>
        {claim.why}
      </p>

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">What the validators read</summary>
        <dl className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
          <Fact k="Promised back by" v={f.recover_by || "—"} />
          <Fact k="Listed as" v={f.availability || f.availability_seen || (claim.code === "not_listed" ? "not listed" : "—")} />
          <Fact k="FDA re-verified" v={f.updated || "—"} />
          <Fact k="Cause" v={f.cause ? CAUSE_LABEL[f.cause] ?? f.cause : "—"} />
          <Fact k="Cause read by" v={f.cause_by === "validators" ? "validators (FDA said \"Other\")" : f.cause_by === "fda" ? "FDA's own category" : "—"} />
          <Fact k="Discontinued" v={f.discontinued || "—"} />
        </dl>
        {packets.length > 0 && (
          <div className="mt-3 space-y-2">
            <p className="font-medium text-foreground">Evidence packets (one per reading, stored on-chain)</p>
            {packets.map((e, i) => (
              <Packet key={i} n={i + 1} e={e} />
            ))}
          </div>
        )}
      </details>

      <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {steps.map((s, i) => (
          <li key={i} className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-[#2F8F5B]" />
            <span className="mono">{s.at.slice(5, 16).replace("T", " ")}</span>
            <span className="text-foreground">
              {s.event === "filed" && `reported by ${formatAddress(claim.claimant)} → ${s.verdict}`}
              {s.event === "contested" && `${s.by} asked for a fresh reading: ${s.before} → ${s.verdict}`}
              {s.event === "settled" &&
                (s.outcome === "paid"
                  ? `paid ${formatGen(s.beneficiary)} GEN to the beneficiary, ${formatGen(s.reporter)} GEN + stake to the reporter`
                  : OUTCOME_TEXT[s.outcome ?? ""] ?? "settled")}
            </span>
          </li>
        ))}
      </ol>

      {open && (
        <p className="text-xs text-[#8A5A08]">
          {left > 0
            ? `Response window: ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} left. ${breach ? "Only the pledger can contest or concede now." : "Only the reporter can contest or accept now."} After it, anyone can settle.`
            : "The response window is over: anyone can settle."}
        </p>
      )}

      {(canContest || canSettle) && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {canContest && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => write({ kind: "contest", claimId: claim.id })}>
              {pending === `contest:${claim.id}` && <Loader2 className="w-3 h-3 animate-spin" />}
              Ask for a fresh reading
            </Button>
          )}
          {canSettle && (
            <Button size="sm" disabled={busy} onClick={() => write({ kind: "settle", claimId: claim.id })}>
              {pending === `settle:${claim.id}` && <Loader2 className="w-3 h-3 animate-spin" />}
              {left > 0 ? (breach ? "Concede and pay now" : "Accept the ruling now") : "Settle"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** What one reading saw on FDA's list, with the hashes that commit to it. */
function Packet({ n, e }: { n: number; e: EvidencePacket }) {
  const hash = (h?: string) => <span className="mono break-all">{h ? `${h.slice(0, 16)}…` : "—"}</span>;
  return (
    <div className="rounded-lg border border-border bg-white/70 p-2 space-y-1">
      <p className="text-muted-foreground">
        #{n} read {e.read_at?.replace("T", " ")} UTC · openFDA data of {e.data_version || "—"} · packet {hash(e.packet_sha256)}
      </p>
      <p>
        Query:{" "}
        <a href={e.source} target="_blank" rel="noopener noreferrer" className="text-[#3A1F4B] break-all hover:underline">
          {e.source}
        </a>{" "}
        · listings {hash(e.listings_sha256)}
      </p>
      {e.listings?.length ? (
        <ul className="space-y-1">
          {e.listings.map((l) => (
            <li key={l.package} className="rounded bg-[#F4EDE2] px-2 py-1">
              <span className="mono">{l.package}</span> · {l.status} · {l.availability || "—"} · re-verified {l.updated || "—"}
              {l.discontinued ? ` · discontinued ${l.discontinued}` : ""}
              {l.reason ? ` · FDA reason: ${l.reason}` : ""}
              {l.cause ? ` · cause: ${CAUSE_LABEL[l.cause] ?? l.cause}` : ""}
              {l.info ? <span className="block text-muted-foreground">“{l.info}”</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">{e.state === "none" ? "openFDA answered: no matches (not on the list)." : "No listing read."}</p>
      )}
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="mono break-words">{v}</dd>
    </div>
  );
}
