// Live end-to-end demo of ShortagePledge on GenLayer Studio, using real records from FDA's drug
// shortage list and NDC directory (openFDA).
//
//   node scripts/demo.mjs <contract-address>
//
// The pledges are DEMO pledges made by a test wallet, not by the manufacturers. A "breach" here
// means the demo pledge's own promise was not met; it is not a finding about any company.

import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { writeFileSync } from "fs";

const [CONTRACT] = process.argv.slice(2);
if (!CONTRACT) {
  console.error("usage: node scripts/demo.mjs <contract-address>");
  process.exit(1);
}
const RPC = "https://studio.genlayer.com/api";
const GEN = 10n ** 18n;
const WINDOW_MS = 600_000;

function client(account) {
  return createClient({ chain: studionet, endpoint: RPC, account });
}

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const TRANSIENT = /rate limit|Unexpected token '<'|not valid JSON|fetch failed|ECONNRESET|socket hang up|50[234]/i;

async function write(c, who, functionName, args, value = 0n, { expectError = false } = {}) {
  const from = c.account.address;
  for (let attempt = 1; ; attempt++) {
    const nonceBefore = BigInt(await rpc("eth_getTransactionCount", [from, "latest"]));
    try {
      let hash;
      try {
        hash = await c.writeContract({ address: CONTRACT, functionName, args, value });
      } catch (err) {
        // The RPC sometimes answers a send with an HTML error page. Only resend if the
        // nonce did not move; otherwise the first send went through and we pick it up.
        if (!TRANSIENT.test(String(err?.message || err))) throw err;
        await sleep(15000);
        const nonceAfter = BigInt(await rpc("eth_getTransactionCount", [from, "latest"]));
        if (nonceAfter === nonceBefore) throw err;
        const txs = await rpc("sim_getTransactionsForAddress", [from]);
        hash = txs.filter((t) => (t.from_address || "").toLowerCase() === from.toLowerCase()).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0].hash;
        console.log(`  send answered with an error page but the tx exists: ${hash}`);
      }
      // Once a hash exists, only the wait is retried; the transaction is never sent twice.
      let receipt;
      for (let wait = 1; ; wait++) {
        try {
          receipt = await c.waitForTransactionReceipt({ hash, status: "ACCEPTED", retries: 60, interval: 5000 });
          break;
        } catch (err) {
          if (!TRANSIENT.test(String(err?.message || err)) || wait >= 6) throw Object.assign(err, { sent: true });
          await sleep(10000 * wait);
        }
      }
      const lr = receipt?.consensus_data?.leader_receipt;
      const first = Array.isArray(lr) ? lr[0] : lr;
      const exec = first?.execution_result ?? "?";
      let returned = first?.result?.payload?.readable;
      try { returned = JSON.parse(returned); } catch {}
      const row = {
        who,
        call: `${functionName}(${args.map((a) => (typeof a === "bigint" ? `${Number(a) / 1e18} GEN` : JSON.stringify(a)).slice(0, 60)).join(", ")})`,
        value: (Number(value) / 1e18).toString(),
        hash,
        status: receipt.statusName ?? receipt.status_name ?? "ACCEPTED",
        exec,
        returned: typeof returned === "string" ? returned : undefined,
      };
      log.push(row);
      console.log(`${row.who.padEnd(11)} ${row.call.padEnd(58)} ${row.status.padEnd(9)} ${row.exec.padEnd(7)} ${hash}${row.returned ? "  -> " + row.returned.slice(0, 160) : ""}`);
      if (expectError) {
        if (exec !== "ERROR") throw new Error(`${functionName} was expected to be refused but executed with ${exec}`);
        const msg = typeof first?.result?.payload === "string" ? first.result.payload : "";
        row.refused = msg;
        console.log(`  -> refused as designed: ${msg}`);
        return row;
      }
      if (exec !== "SUCCESS") throw new Error(`${functionName} executed with ${exec}`);
      return row;
    } catch (err) {
      const msg = String(err?.message || err);
      if (TRANSIENT.test(msg) && attempt < 5 && !err?.sent) {
        console.log(`  transient RPC error (${msg.slice(0, 60)}), waiting ${15 * attempt}s`);
        await sleep(15000 * attempt);
        continue;
      }
      throw err;
    }
  }
}

async function read(c, functionName, args = []) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await c.readContract({ address: CONTRACT, functionName, args });
    } catch (err) {
      if (TRANSIENT.test(String(err?.message)) && attempt < 6) {
        await sleep(15000 * attempt);
        continue;
      }
      throw err;
    }
  }
}

const balance = async (addr) => BigInt(await rpc("eth_getBalance", [addr, "latest"]));
const fmt = (wei) => (Number(wei) / 1e18).toFixed(2);
const fund = async (addr, gen) => rpc("sim_fundAccount", [addr, Number(gen * GEN)]);
const field = (obj, name) => (obj instanceof Map ? obj.get(name) : obj[name]);

const keys = { pledger: generatePrivateKey(), reporter: generatePrivateKey(), fund: generatePrivateKey(), bystander: generatePrivateKey() };
const acct = Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, createAccount(v)]));
const P = client(acct.pledger);
const R = client(acct.reporter);
const F = client(acct.fund);
const B = client(acct.bystander);
if (process.env.DEMO_KEYS) writeFileSync(process.env.DEMO_KEYS, JSON.stringify(keys));

console.log("contract  ", CONTRACT);
for (const [k, a] of Object.entries(acct)) console.log(k.padEnd(10), a.address);
await fund(acct.pledger.address, 100n);
await fund(acct.reporter.address, 20n);
await fund(acct.fund.address, 1n);
await fund(acct.bystander.address, 1n);
await sleep(3000);

const firstPledge = (await read(P, "get_pledges", [0, 200])).length;
let nextClaim = (await read(P, "get_claims", [0, 200])).length;
const pid = (n) => `pledge_${firstPledge + n}`;
const ruling = async (claimId, label) => {
  const c = await read(P, "get_claim", [claimId]);
  console.log(`  -> ${label}: ${field(c, "verdict")} (${field(c, "code")}) ${field(c, "why")}`);
  return field(c, "verdict");
};
const file = async (who, c, pledgeId, ndc, label, stake) => {
  const row = await write(c, who, "file_claim", [pledgeId, ndc], stake);
  if (row.returned?.startsWith("REFUNDED")) return null;
  const claimId = `claim_${nextClaim++}`;
  await ruling(claimId, label);
  return claimId;
};
const claims = [];

// GEN transfers out of the contract (payouts, refunds) run as their own transactions once the call
// that emitted them is finalized, so compare balances only when nothing touching the contract is in flight.
const quiet = async () => {
  let last = -1;
  for (let i = 0; i < 60; i++) {
    const txs = await rpc("sim_getTransactionsForAddress", [CONTRACT]);
    const busy = txs.filter((t) => t.status !== "FINALIZED" && t.status !== "CANCELED" && t.status !== "UNDETERMINED").length;
    if (busy === 0 && txs.length === last) return txs.length;
    last = busy === 0 ? txs.length : -1;
    await sleep(10000);
  }
  throw new Error("transactions did not finalize");
};
const reconcile = async (label) => {
  await quiet();
  const t = JSON.parse(await read(P, "totals"));
  const onChain = await balance(CONTRACT);
  const ok = BigInt(t.expected_balance) === onChain;
  const row = { label, bonds: t.bonds, pending_stakes: t.pending_stakes, expected: t.expected_balance, balance: onChain.toString(), ok };
  reconciliations.push(row);
  console.log(`  reconcile (${label}): active bonds ${fmt(t.bonds)} + open stakes ${fmt(t.pending_stakes)} = ${fmt(t.expected_balance)} GEN; contract balance ${fmt(onChain)} GEN ${ok ? "OK" : "MISMATCH"}`);
  if (!ok) throw new Error("balance mismatch");
};
const reconciliations = [];
const coverages = {};

// Retroactive demo terms: the products were promised back by 2026-10-01, so FDA's current list decides.
const BY = "2026-10-01";
const UNTIL = "2027-06-30";

// Refused at pledging.
await write(P, "pledger", "create_pledge", ["641-6000", BY, "", 2n * GEN, acct.fund.address, UNTIL], 2n * GEN);
await write(P, "pledger", "create_pledge", ["9999-9999", BY, "", 2n * GEN, acct.fund.address, UNTIL], 2n * GEN);
await write(P, "pledger", "create_pledge", ["0641-6000,0641-6001", BY, "", 2n * GEN, acct.fund.address, UNTIL], 3n * GEN); // bond < 2 products x payout
await write(P, "pledger", "create_pledge", ["0641-6000", "2026-12-01", "", 2n * GEN, acct.fund.address, "2026-12-15"], 2n * GEN); // ends before reports can come in
await write(P, "pledger", "create_pledge", ["0641-6000", BY, "MANUFACTURING", 2n * GEN, acct.fund.address, UNTIL], 2n * GEN); // manufacturing is never excusable

// P0: Hikma lorazepam injection (Ativan), two products, demand increases excused.
console.log("");
await write(P, "pledger", "create_pledge", ["0641-6000,0641-6001", BY, "DEMAND_INCREASE", 2n * GEN, acct.fund.address, UNTIL], 4n * GEN);
const s0 = BigInt(await read(P, "stake_for", [pid(0)]));
await write(R, "reporter", "file_claim", [pid(0), "0641-6000"], GEN); // wrong stake: refunded
claims.push(await file("reporter", R, pid(0), "0641-6000", "P0 Ativan 10 mL vials", s0));
const c0a = claims.at(-1);
claims.push(await file("reporter", R, pid(0), "0641-6001", "P0 Ativan 1 mL vials, claimed at the same time", s0));
const c0b = claims.at(-1);
await write(R, "reporter", "file_claim", [pid(0), "0641-6000"], s0); // one open claim per product: refunded
coverages[`${pid(0)} with two open claims`] = JSON.parse(await read(P, "coverage", [pid(0)]));
console.log(`  coverage(${pid(0)}) = ${JSON.stringify(coverages[`${pid(0)} with two open claims`])}`);
await reconcile("two claims open on pledge P0");
await write(R, "reporter", "settle", [c0a], 0n, { expectError: true }); // the reporter gains from a payout
await write(F, "fund", "settle", [c0a], 0n, { expectError: true }); // so does the beneficiary
await write(P, "pledger", "settle", [c0a]); // the pledger concedes: paid in full
await write(R, "reporter", "settle", [c0b]); // the reporter accepts the excused ruling
await write(R, "reporter", "file_claim", [pid(0), "0641-6000"], s0); // paid once: refunded
coverages[`${pid(0)} after settling`] = JSON.parse(await read(P, "coverage", [pid(0)]));
await reconcile("after P0 settles");

// P1: B. Braun heparin: FDA's reason is "Other"; validators read the cause from FDA's notes.
console.log("");
await write(P, "pledger", "create_pledge", ["0264-9872", BY, "DEMAND_INCREASE", 2n * GEN, acct.fund.address, UNTIL], 2n * GEN);
const s1 = BigInt(await read(P, "stake_for", [pid(1)]));
claims.push(await file("reporter", R, pid(1), "0264-9872", "P1 heparin", s1));
const c1 = claims.at(-1);
await write(P, "pledger", "contest", [c1]);
await ruling(c1, "P1 heparin after the pledger's contest");

// P2: Teva Adderall 5 mg: on the list, but available.
console.log("");
await write(P, "pledger", "create_pledge", ["57844-120", BY, "", 2n * GEN, acct.fund.address, UNTIL], 2n * GEN);
const s2 = BigInt(await read(P, "stake_for", [pid(2)]));
claims.push(await file("reporter", R, pid(2), "57844-120", "P2 Adderall", s2));
await write(R, "reporter", "contest", [claims.at(-1)]);
await ruling(claims.at(-1), "P2 Adderall after the reporter's contest");
await write(R, "reporter", "settle", [claims.at(-1)]);

// P3: Eli Lilly Humalog: not on the shortage list at all.
console.log("");
await write(P, "pledger", "create_pledge", ["0002-7510", BY, "", 2n * GEN, acct.fund.address, UNTIL], 2n * GEN);
const s3 = BigInt(await read(P, "stake_for", [pid(3)]));
claims.push(await file("reporter", R, pid(3), "0002-7510", "P3 Humalog", s3));
await write(R, "reporter", "settle", [claims.at(-1)]);

// P4: Solco quinapril: listed unavailable, but FDA has not re-verified it since June.
console.log("");
await write(P, "pledger", "create_pledge", ["43547-410", BY, "", 2n * GEN, acct.fund.address, UNTIL], 2n * GEN);
const s4 = BigInt(await read(P, "stake_for", [pid(4)]));
claims.push(await file("reporter", R, pid(4), "43547-410", "P4 quinapril", s4));
await write(R, "reporter", "settle", [claims.at(-1)]);

// P5: Amgen Corlanor (ivabradine): discontinued.
console.log("");
await write(P, "pledger", "create_pledge", ["55513-800", BY, "", 2n * GEN, acct.fund.address, UNTIL], 2n * GEN);
const s5 = BigInt(await read(P, "stake_for", [pid(5)]));
claims.push(await file("reporter", R, pid(5), "55513-800", "P5 Corlanor", s5));
const c5 = claims.at(-1);

// P6: a forward pledge on Hospira morphine (unavailable now): back by 2026-12-31. Nothing can be claimed yet,
// and the bond cannot leave.
console.log("");
await write(P, "pledger", "create_pledge", ["0409-1896", "2026-12-31", "", 2n * GEN, acct.fund.address, "2027-03-31"], 2n * GEN);
const s6 = BigInt(await read(P, "stake_for", [pid(6)]));
await write(R, "reporter", "file_claim", [pid(6), "0409-1896"], s6);
await write(P, "pledger", "withdraw", [pid(6)], 0n, { expectError: true });
coverages[pid(6)] = JSON.parse(await read(P, "coverage", [pid(6)]));
console.log(`  coverage(${pid(6)}) = ${JSON.stringify(coverages[pid(6)])}`);

// After the response window, anyone settles the open breaches.
console.log("\nwaiting 10 minutes for the response window...");
await write(B, "bystander", "settle", [c1], 0n, { expectError: true });
await reconcile("P1 and P5 claims open");
await sleep(630_000);
await write(B, "bystander", "settle", [c1]);
await write(B, "bystander", "settle", [c5]);

await sleep(8000);
await reconcile("end of run");
const N = 7;
console.log("\nfinal pledges:");
for (let n = 0; n < N; n++) {
  const p = await read(P, "get_pledge", [pid(n)]);
  const products = JSON.parse(field(p, "products_json")).map((x) => x.ndc).join(",");
  console.log(`  ${pid(n)} ${products} bond=${fmt(field(p, "bond")).padStart(6)} paid=${fmt(field(p, "total_paid"))} kept=${field(p, "n_kept")} breached=${field(p, "n_breached")} other=${field(p, "n_other")} pending=${field(p, "pending")}`);
}
const evidence = {};
for (const id of claims.filter(Boolean)) {
  console.log(`  explain_claim(${id}) = ${await read(P, "explain_claim", [id])}`);
  const packets = JSON.parse(field(await read(P, "get_claim", [id]), "evidence_json"));
  evidence[id] = packets.map((e) => ({ packet_sha256: e.packet_sha256, listings_sha256: e.listings_sha256, data_version: e.data_version, read_at: e.read_at, listings: (e.listings || []).length }));
}
console.log(`  pledges_for_product(0641-6000) = ${JSON.stringify(await read(P, "pledges_for_product", ["0641-6000"]))}`);
const out = { contract: CONTRACT, accounts: Object.fromEntries(Object.entries(acct).map(([k, a]) => [k, a.address])), pledges: [...Array(N).keys()].map(pid), claims: claims.filter(Boolean), coverages, reconciliations, evidence, log };
writeFileSync(new URL("../docs/demo-run.json", import.meta.url), JSON.stringify(out, null, 2));
console.log("\nwrote docs/demo-run.json");
