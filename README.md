# ShortagePledge

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/license/mit/)

<img src="assets/shortagepledge-logo.png" alt="ShortagePledge logo" width="96" align="right" />

**Drug-shortage recovery pledges, backed by GEN and ruled by GenLayer validators.**

More than a thousand drug packages sit on FDA's drug shortage list, many with a manufacturer's estimated recovery date
that keeps slipping ("Estimated recovery: TBD", "late Q4"). Hospitals and pharmacies plan around those dates, but
nothing happens when one is missed.

ShortagePledge puts money behind the date:

1. A **pledger** (the manufacturer, or anyone backing a medicine's recovery with their own GEN) names up to five
   products by **product NDC** and a **recovery date**, and bonds GEN. Validators read each product from FDA's NDC
   directory and **freeze it with its shortage listing at pledging**. The pledger may excuse some causes (demand
   increase, ingredient shortage, shipping delay, regulatory delay); manufacturing problems, discontinuation and
   unexplained shortages are never excusable. The bond must cover **every product in full** (products × payout), and
   the pledge runs at least 30 days past the recovery date so every product can be reported.
2. After the recovery date, **anyone reports** a medicine that is not back by staking 10% of the payout.
3. **Every validator** reads every package of that product on FDA's drug shortage list (openFDA) and decides **in code**:
   - not on the list, or listed as available or resolved: **back** (kept);
   - listed as discontinued, with the date reached: **not back**;
   - listed as unavailable or limited, and **re-verified by FDA after the recovery date**: still short. If FDA has not
     re-verified the listing since then, nothing is decided (`UNCLEAR`) and the stake comes back.
   - For a shortage, the **cause** decides whether it is excused. FDA's own categories ("Demand increase for the drug",
     "Requirements related to complying with good manufacturing practices", ...) map to a cause in code. Only when FDA
     says **"Other"** do validators read FDA's free-text notes and name the cause; notes too short to say anything
     ("TBD") are "unstated" without asking.
4. The side the ruling goes against may ask **once** for a fresh reading within 10 minutes. Every ruling stores a
   **plain-English reason**, a **timeline** and an **evidence packet**: the openFDA query, openFDA's data version, every
   listing read and the cause named, with sha256 hashes.
5. A medicine not back pays 90% of the payout to the beneficiary (for example a hospital pharmacy) and 10% plus the
   stake back to the reporter, always in full. A medicine back or excused adds the reporter's stake to the bond. If
   openFDA cannot be read, nothing is decided and the stake goes back.

**Live app:** [shortagepledge-bars26.vercel.app](https://shortagepledge-bars26.vercel.app). Type a product NDC or a drug
name to see its packages on FDA's list without a wallet. Writes need MetaMask on GenLayer Studio (chain 61999); **Test
GEN** funds your wallet.
**Contract:** [`0xd8939fb77Fe683F41f7999f3B1c23a1000363363`](https://explorer-studio.genlayer.com/address/0xd8939fb77Fe683F41f7999f3B1c23a1000363363) on GenLayer Studio.

## Verified live, on FDA's real shortage list

`scripts/demo.mjs` ran demo pledges (made by a test wallet, not by the manufacturers, with the recovery date
2026-10-01 so FDA's current list decides them) with real validator consensus and LLM calls. Every transaction hash, the
coverage reads, the balance reconciliation and every evidence packet are in [`docs/REPRODUCTION.md`](docs/REPRODUCTION.md).

| Pledge | Product | What validators read | Ruling and stored reason |
|---|---|---|---|
| Hikma Ativan (lorazepam) injection, two products, demand increase excused, bond exactly 2 × payout | 0641-6000 (10 mL vials) | Unavailable, re-verified 2026-10-14, FDA reason "Other", notes "Estimated recovery: TBD" | **Not back**: *"…Cause: unstated, which this pledge does not excuse. FDA's reason was "Other", so validators read the cause from FDA's notes."* The reporter and the beneficiary could not settle early; the pledger conceded and paid in full |
| same, claimed at the same time | 0641-6001 (1 mL vials) | Limited, re-verified 2026-10-14, FDA reason "Demand increase for the drug" | **Excused**: *"…the cause, demand increase, is one this pledge excuses."* (decided in code) |
| B. Braun heparin | 0264-9872 | Limited, re-verified 2026-10-19, FDA reason "Other", notes "Estimated recovery: late Q4 2026; Manufacturing delays" | **Not back**: validators named the cause *manufacturing*; the pledger's fresh reading confirmed it; settled by a bystander after the window |
| Teva Adderall 5 mg | 57844-120 | listed, but "Available" | **Back on the shelf**; the reporter's fresh reading confirmed it |
| Eli Lilly Humalog | 0002-7510 | openFDA: no matches (not on the list) | **Back on the shelf** |
| Solco quinapril | 43547-410 | Unavailable, but last re-verified 2026-06-29 | **Undecided**: FDA has not re-verified it since the recovery date; the stake went back |
| Amgen Corlanor (ivabradine) | 55513-800 | To Be Discontinued, 2026-01-01 | **Not back**: *"…FDA lists it as discontinued on 2026-01-01: it will not be back."* |
| Hospira morphine, recovery date 2026-12-31 | 0409-1896 | not due yet | the claim was refunded (claims open the day after the date); the pledger's `withdraw` was refused |

Also refused on-chain: a malformed NDC, an NDC that is not in FDA's NDC directory, a bond below products × payout, a
pledge ending less than 30 days after its recovery date, "manufacturing" as an excused cause, a claim with the wrong
stake, a second claim on a product that already has one open, and a refile on a product already paid. The contract's
balance was reconciled with `totals()` (active bonds plus open stakes) at four points of the run, each time after every
transfer had finalized.

## Who can do what (and the attacks this blocks)

| Rule | Why |
|---|---|
| Products are frozen at pledging from FDA's NDC directory, with their listing then | Nobody can later swap which medicine was promised |
| The bond covers every product that can still pay (products × payout) | Every confirmed breach is paid in full, whatever the settlement order |
| One open claim per product; each product pays once; a product ruled back is closed | No double payouts, no claim spam |
| Claims open the day after the recovery date; the pledge runs at least 30 days longer | A reporter cannot claim early; the pledger cannot leave before reports can come in |
| A shortage counts only if FDA re-verified the listing after the recovery date | A stale listing never decides money |
| FDA's own reason decides the cause in code; validators read the notes only for "Other" | The model is asked only what code cannot read, with a fixed answer set |
| Manufacturing, discontinuation and unstated causes cannot be excused | A pledge cannot be written so that it never pays |
| openFDA's explicit "No matches found" means not listed; any other failure is `UNCLEAR` and returns the stake | An outage never decides a ruling |
| Only the side a ruling goes against contests, once per side; every contest restarts the window | Nobody spends the other side's only answer |
| Early settlement only against your own interest (the pledger concedes, the reporter accepts) | The reporter or beneficiary cannot rush a payout; the pledger cannot rush taking a stake |
| Payable calls never revert; they refund and return `REFUNDED: <reason>` | GenLayer keeps the value of a reverted call |

## The app

- **No-wallet first step:** type a product NDC or a drug name and see its **shelf**: one pill-bottle chip per package on
  FDA's list (green available, amber limited, brick unavailable, grey discontinued) with FDA's re-verification date and
  notes. Same openFDA reads as the contract (`/api/product`).
- **Coverage on every pledge:** what can still pay, the liability against the bond, when reports open, how long the bond
  stays locked, and each product's shelf today.
- **Evidence on every claim:** each reading's packet with the openFDA query, data version, every listing and the cause
  named, and hashes.
- **Report flow** that shows FDA's list today before you stake, and blocks claims the contract would refund.
- **Studio's 30 requests per minute:** page loads read the registry server-side with one `get_pledges` and one
  `get_claims` call, CDN-cached; the browser keeps its own 24-per-minute budget and shows it.

## Run it

```bash
pip install -r requirements.txt
genvm-lint check contracts/shortage_pledge.py
pytest tests/direct/ -v                     # 41 tests, openFDA and the LLM mocked

npm install
node scripts/deploy.mjs
node scripts/verify-code.mjs <address>
node scripts/demo.mjs <address>             # the live run above (about 30 minutes)
node scripts/reproduction.mjs               # regenerate docs/REPRODUCTION.md

cd frontend && cp .env.example .env.local && npm run dev
```

## Limits, stated plainly

- The contract does not verify that a pledger is the manufacturer; a pledge is a promise backed by the pledger's own GEN.
  The demo pledges are made by a test wallet.
- FDA's list says what FDA says. A product is judged by the first reading after the recovery date that a reporter
  triggers, so a shortage that resolves before anyone reports counts as back.
- openFDA mirrors FDA's database with some delay; the evidence packet records the data version every reading used.
- Not medical advice: rulings are about FDA's shortage list only.

MIT licensed.
