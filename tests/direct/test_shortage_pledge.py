"""Direct-mode tests for the ShortagePledge contract."""

import hashlib
import json
from datetime import datetime, timedelta, timezone

import pytest

from tests.direct.conftest import to_hex

CONTRACT_PATH = "contracts/shortage_pledge.py"
GEN = 10**18
A, B = "0641-6000", "0641-6001"  # Hikma lorazepam injection, 2 mg/mL and 4 mg/mL
NDC_RE = r"^https://api\.fda\.gov/drug/ndc\.json\?search=product_ndc:%22(\d{4,5}-\d{3,4})%22&limit=1$"
SHORT_RE = r"^https://api\.fda\.gov/drug/shortages\.json\?search=package_ndc:{ndc}-\*&limit=100$"
RECOVER_BY = "2026-10-01"
UPDATED = "10/14/2026"


def _sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


def _days_from_now(n):
    return (datetime.now(timezone.utc) + timedelta(days=n)).strftime("%Y-%m-%d")


def _us(day):
    y, m, d = day.split("-")
    return f"{m}/{d}/{y}"


def _listing(ndc, package="10", status="Current", availability="Unavailable", updated=UPDATED, reason="Other",
             info="Estimated recovery: TBD", discontinued=None):
    r = {"package_ndc": f"{ndc}-{package}", "status": status, "update_date": updated, "generic_name": "Lorazepam Injection",
         "company_name": "Hikma Pharmaceuticals USA, Inc.", "presentation": f"Lorazepam, Injection (NDC {ndc}-{package})",
         "initial_posting_date": "09/05/2018", "related_info": info}
    if availability:
        r["availability"] = availability
    if reason:
        r["shortage_reason"] = reason
    if discontinued:
        r["discontinued_date"] = discontinued
    return r


def _mock(direct_vm, pattern, body, status=200):
    direct_vm.mock_web(pattern, {"method": "GET", "response": {"status": status, "headers": {"Content-Type": b"application/json"},
                                                               "body": json.dumps(body).encode()}})


NOT_FOUND = {"error": {"code": "NOT_FOUND", "message": "No matches found!"}}


def _setup(direct_vm, shortages=None, ndc_status=200, short_status=200, cause="MANUFACTURING", known=(A, B)):
    """shortages: {ndc: [listings]}; an NDC missing from it gets openFDA's NOT_FOUND."""
    direct_vm.clear_mocks()
    shortages = {A: [_listing(A)], B: [_listing(B, package="25", availability="Limited Availability", reason="Demand increase for the drug",
                                                 info="Additional lots are scheduled to be manufactured.")]} if shortages is None else shortages
    for ndc in set(known) | set(shortages):
        if ndc_status != 200:
            _mock(direct_vm, NDC_RE.replace(r"(\d{4,5}-\d{3,4})", ndc), {"error": {"code": "SERVER_ERROR"}}, ndc_status)
        elif ndc in known:
            _mock(direct_vm, NDC_RE.replace(r"(\d{4,5}-\d{3,4})", ndc), {"meta": {}, "results": [{
                "product_ndc": ndc, "brand_name": "Ativan" if ndc == A else "Lorazepam", "generic_name": "Lorazepam",
                "labeler_name": "Hikma Pharmaceuticals USA Inc.", "dosage_form": "INJECTION",
                "active_ingredients": [{"name": "LORAZEPAM", "strength": "2 mg/mL" if ndc == A else "4 mg/mL"}]}]})
        else:
            _mock(direct_vm, NDC_RE.replace(r"(\d{4,5}-\d{3,4})", ndc), NOT_FOUND, 404)
        pattern = SHORT_RE.format(ndc=ndc)
        if short_status != 200:
            _mock(direct_vm, pattern, {"error": {"code": "SERVER_ERROR"}}, short_status)
        elif shortages.get(ndc):
            _mock(direct_vm, pattern, {"meta": {"last_updated": "2026-10-21"}, "results": shortages[ndc]})
        else:
            _mock(direct_vm, pattern, NOT_FOUND, 404)
    direct_vm.mock_llm(r".*", json.dumps({"cause": cause}))


def _pledge(direct_vm, direct_deploy, pledger, payee, bond=8 * GEN, setup=None, **terms):
    direct_vm.sender = pledger
    contract = direct_deploy(CONTRACT_PATH)
    _setup(direct_vm, **(setup or {}))
    args = dict(ndcs=f"{A},{B}", recover_by=RECOVER_BY, excused="DEMAND_INCREASE", payout=4 * GEN, beneficiary=to_hex(payee),
                expires=_days_from_now(400))
    args.update(terms)
    direct_vm.value = bond
    result = contract.create_pledge(*args.values())
    direct_vm.value = 0
    return contract, result


def _file(direct_vm, contract, pledge_id, who, ndc=A, stake=None, **setup):
    _setup(direct_vm, **setup)
    direct_vm.sender = who
    direct_vm.value = int(contract.stake_for(pledge_id)) if stake is None else stake
    result = contract.file_claim(pledge_id, ndc)
    direct_vm.value = 0
    return result


def _expire(contract, claim_id):
    contract.claims[claim_id].window_from = "2000-01-01T00:00:00"


# --- pledges -----------------------------------------------------------------


def test_pledge_freezes_products_and_their_listing(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    p = contract.get_pledge(pledge_id)
    products = json.loads(p.products_json)
    assert [(x["ndc"], x["brand"], x["strength"], x["labeler"]) for x in products] == [
        (A, "Ativan", "2 mg/mL", "Hikma Pharmaceuticals USA Inc."), (B, "Lorazepam", "4 mg/mL", "Hikma Pharmaceuticals USA Inc.")]
    assert products[0]["listed_at_pledge"] == [{"package": f"{A}-10", "status": "Current", "availability": "Unavailable", "updated": "2026-10-14"}]
    assert (p.recover_by, json.loads(p.excused_json)) == (RECOVER_BY, ["DEMAND_INCREASE"])
    assert contract.pledges_for_product(A) == [pledge_id]
    assert contract.stake_for(pledge_id) == str(4 * GEN // 10)


@pytest.mark.parametrize("terms, setup, reason", [
    (dict(ndcs="641-6000"), None, "ndcs must be 1 to 5 product NDCs"),
    (dict(ndcs=",".join(f"0641-600{i}" for i in range(6))), None, "ndcs must be 1 to 5 product NDCs"),
    (dict(ndcs=f"{A},{A}"), None, "ndcs lists a product twice"),
    (dict(recover_by="soon"), None, "recover_by must be a YYYY-MM-DD date"),
    (dict(excused="MANUFACTURING"), None, "excused may only list DEMAND_INCREASE, INGREDIENT_SHORTAGE, SHIPPING_DELAY, REGULATORY_DELAY"),
    (dict(payout=GEN // 2), None, "payout must be at least 1 GEN"),
    (dict(beneficiary="nope"), None, "beneficiary must be a wallet address"),
    (dict(recover_by=_days_from_now(30), expires=_days_from_now(40)), None, f"and {_days_from_now(60)} or later"),
    (dict(payout=5 * GEN), None, "the bond must cover every product: at least 2 x payout"),
    (dict(ndcs="9999-9999"), dict(shortages={"9999-9999": []}), "9999-9999 is not in FDA's NDC directory"),
    ({}, dict(ndc_status=503), "Could not read openFDA right now"),
    ({}, dict(short_status=500), "Could not read openFDA right now"),
])
def test_invalid_pledges_are_refunded(direct_vm, direct_deploy, direct_alice, direct_bob, terms, setup, reason):
    contract, result = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob, setup=setup, **terms)
    assert result.startswith("REFUNDED:") and reason in result
    assert contract.get_pledges(0, 10) == []


# --- rulings -------------------------------------------------------------------


def test_unexplained_shortage_is_a_breach(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim = contract.get_claim(_file(direct_vm, contract, pledge_id, direct_charlie, cause="UNSTATED"))
    facts = json.loads(claim.facts_json)
    assert (claim.verdict, claim.code, facts["cause"], facts["cause_by"]) == ("BREACHED", "not_recovered", "UNSTATED", "validators")
    assert claim.why.startswith(f"{A} (Ativan 2 mg/mL) is still listed as Unavailable (FDA re-verified 2026-10-14), after the promised date {RECOVER_BY}.")
    assert claim.why.endswith('FDA\'s reason was "Other", so validators read the cause from FDA\'s notes.')


def test_excused_cause_is_not_covered(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim = contract.get_claim(_file(direct_vm, contract, pledge_id, direct_charlie, ndc=B))
    facts = json.loads(claim.facts_json)
    assert (claim.verdict, claim.code, facts["cause"], facts["cause_by"]) == ("NOT_COVERED", "excused", "DEMAND_INCREASE", "fda")
    assert "is one this pledge excuses" in claim.why


def test_free_text_cause_goes_to_validators(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    heparin = {A: [_listing(A, availability="Limited Availability", info="Estimated recovery: late Q4 2026; Manufacturing delays")]}
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim = contract.get_claim(_file(direct_vm, contract, pledge_id, direct_charlie, shortages=heparin, cause="MANUFACTURING"))
    assert (claim.verdict, json.loads(claim.facts_json)["cause"]) == ("BREACHED", "MANUFACTURING")
    # the same notes, judged an excused cause, would not pay
    claim2 = contract.get_claim(_file(direct_vm, contract, pledge_id, direct_charlie, ndc=B,
                                      shortages={B: [_listing(B, info="Shortage per manufacturer: increased demand")]}, cause="DEMAND_INCREASE"))
    assert (claim2.verdict, claim2.code) == ("NOT_COVERED", "excused")


def test_notes_too_short_are_unstated_without_asking(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim = contract.get_claim(_file(direct_vm, contract, pledge_id, direct_charlie, shortages={A: [_listing(A, info="TBD")]}, cause="PROBABLY"))
    assert (claim.verdict, json.loads(claim.facts_json)["cause"]) == ("BREACHED", "UNSTATED")


@pytest.mark.parametrize("listings, verdict, code", [
    (None, "KEPT", "not_listed"),
    ([_listing(A, availability="Available", reason=None, info="")], "KEPT", "available"),
    ([_listing(A, status="Resolved", availability=None)], "KEPT", "available"),
    ([_listing(A, updated="05/01/2026")], "UNCLEAR", "stale"),
    ([_listing(A, status="To Be Discontinued", availability=None, discontinued="01/01/2026", reason=None)], "BREACHED", "discontinued"),
    ([_listing(A, status="To Be Discontinued", availability="Available", discontinued="01/01/2099", reason=None)], "KEPT", "available"),
    ([_listing(A, availability="Unvailable", reason="Requirements related to complying with good manufacturing practices")], "BREACHED", "not_recovered"),
])
def test_listing_states(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, listings, verdict, code):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim = contract.get_claim(_file(direct_vm, contract, pledge_id, direct_charlie, shortages={A: listings} if listings else {}))
    assert (claim.verdict, claim.code) == (verdict, code)


def test_one_unexcused_package_breaks_the_product(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    two = {A: [_listing(A, package="10", reason="Demand increase for the drug"), _listing(A, package="25", reason="Shortage of an active ingredient"),
               _listing(A, package="99", reason="Delay in shipping of the drug")]}
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob, excused="DEMAND_INCREASE,INGREDIENT_SHORTAGE")
    claim = contract.get_claim(_file(direct_vm, contract, pledge_id, direct_charlie, shortages=two))
    assert (claim.verdict, json.loads(claim.facts_json)["cause"]) == ("BREACHED", "SHIPPING_DELAY")


@pytest.mark.parametrize("status", [503, 429, 0])
def test_openfda_failures_decide_nothing(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, status):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim = contract.get_claim(_file(direct_vm, contract, pledge_id, direct_charlie, short_status=status or 502))
    assert (claim.verdict, claim.code) == ("UNCLEAR", "unreachable")


def test_non_enum_model_answer_reverts(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    with direct_vm.expect_revert("LLM cause must be one of"):
        _file(direct_vm, contract, pledge_id, direct_charlie, cause="PROBABLY")


# --- filing --------------------------------------------------------------------


def test_filing_is_checked_and_refunded(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    assert "exactly 400000000000000000 wei" in _file(direct_vm, contract, pledge_id, direct_charlie, stake=GEN)
    assert "0641-6002 is not one of this pledge's products" in _file(direct_vm, contract, pledge_id, direct_charlie, ndc="0641-6002")
    assert "No pledge with id pledge_9" in _file(direct_vm, contract, "pledge_9", direct_charlie, stake=0)
    contract.pledges[pledge_id].recover_by = _days_from_now(3)
    assert "claims open the day after" in _file(direct_vm, contract, pledge_id, direct_charlie)
    contract.pledges[pledge_id].recover_by = RECOVER_BY
    contract.pledges[pledge_id].expires = "2026-10-02"
    assert "This pledge expired on 2026-10-02" in _file(direct_vm, contract, pledge_id, direct_charlie)
    assert contract.get_claims(0, 10) == []


def test_one_open_claim_per_product(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    first = _file(direct_vm, contract, pledge_id, direct_charlie)
    assert _file(direct_vm, contract, pledge_id, direct_bob) == f"REFUNDED: {first} is already open for this product"
    assert _file(direct_vm, contract, pledge_id, direct_bob, ndc=B).startswith("claim_")


# --- payout guarantees ----------------------------------------------------------


@pytest.mark.parametrize("order", [(A, B), (B, A)])
def test_both_products_breached_are_paid_in_full(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, order):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob, bond=8 * GEN, excused="")
    claims = {ndc: _file(direct_vm, contract, pledge_id, direct_charlie, ndc=ndc) for ndc in (A, B)}
    assert json.loads(contract.totals()) == {"bonds": str(8 * GEN), "pending_stakes": str(8 * GEN // 10),
                                             "expected_balance": str(8 * GEN + 8 * GEN // 10)}
    for ndc in order:
        assert contract.get_claim(claims[ndc]).verdict == "BREACHED"
        _expire(contract, claims[ndc])
        assert contract.settle(claims[ndc]) == "paid"
        last = json.loads(contract.get_claim(claims[ndc]).timeline_json)[-1]
        assert (last["beneficiary"], last["reporter"]) == (str(36 * GEN // 10), str(4 * GEN // 10))
    p = contract.get_pledge(pledge_id)
    assert (int(p.bond), int(p.total_paid), int(p.n_breached)) == (0, 8 * GEN, 2)
    assert json.loads(contract.totals())["expected_balance"] == "0"
    cov = json.loads(contract.coverage(pledge_id))
    assert (cov["open_products"], cov["liability"], cov["covered"]) == ([], "0", True)
    assert "already been paid" in _file(direct_vm, contract, pledge_id, direct_charlie)


def test_kept_product_closes_and_frees_liability(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie, shortages={})
    _expire(contract, claim_id)
    assert contract.settle(claim_id) == "stake_to_bond"
    cov = json.loads(contract.coverage(pledge_id))
    assert (cov["open_products"], cov["liability"], cov["bond"]) == ([B], str(4 * GEN), str(8 * GEN + 4 * GEN // 10))
    assert "already been ruled back" in _file(direct_vm, contract, pledge_id, direct_charlie)


def test_unclear_returns_the_stake_and_can_be_refiled(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie, shortages={A: [_listing(A, updated="05/01/2026")]})
    _expire(contract, claim_id)
    assert contract.settle(claim_id) == "stake_returned"
    assert int(contract.get_pledge(pledge_id).bond) == 8 * GEN
    assert _file(direct_vm, contract, pledge_id, direct_charlie).startswith("claim_")


# --- who may act, and when --------------------------------------------------------


def test_only_the_pledger_can_concede_early(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie)
    for who in (direct_charlie, direct_bob):
        direct_vm.sender = who
        with direct_vm.expect_revert("only the pledger can concede early"):
            contract.settle(claim_id)
    direct_vm.sender = direct_alice
    assert contract.settle(claim_id) == "paid"


def test_only_the_losing_side_contests_once(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie)
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("Only the pledger can contest a breach"):
        contract.contest(claim_id)
    # FDA re-verified the listing as available in the meantime: the fresh reading keeps the promise
    _setup(direct_vm, shortages={A: [_listing(A, availability="Available", reason=None, info="", updated="10/20/2026")]})
    direct_vm.sender = direct_alice
    assert contract.contest(claim_id) == "KEPT"
    with direct_vm.expect_revert("Only the claimant can contest a ruling that pays nothing"):
        contract.contest(claim_id)
    _setup(direct_vm)
    direct_vm.sender = direct_charlie
    assert contract.contest(claim_id) == "BREACHED"
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("The pledger has already contested this claim"):
        contract.contest(claim_id)
    claim = contract.get_claim(claim_id)
    steps, packets = json.loads(claim.timeline_json), json.loads(claim.evidence_json)
    assert [s["event"] for s in steps] == ["filed", "contested", "contested"]
    assert [s["evidence"] for s in steps] == [p["packet_sha256"] for p in packets]


def test_window_closes_for_contests(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie)
    _expire(contract, claim_id)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("The response window has closed"):
        contract.contest(claim_id)


def test_bond_is_locked_until_expiry_and_open_claims(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Only the pledger can withdraw the bond"):
        contract.withdraw(pledge_id)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("The bond stays until the pledge expires"):
        contract.withdraw(pledge_id)
    contract.pledges[pledge_id].expires = "2026-10-15"
    with direct_vm.expect_revert("Settle the open claims first"):
        contract.withdraw(pledge_id)
    _expire(contract, claim_id)
    contract.settle(claim_id)
    assert contract.withdraw(pledge_id) == str(4 * GEN)
    assert contract.pledges_for_product(A) == []


# --- evidence --------------------------------------------------------------------


def test_every_reading_keeps_an_evidence_packet(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim = contract.get_claim(_file(direct_vm, contract, pledge_id, direct_charlie, cause="UNSTATED"))
    packet = json.loads(claim.evidence_json)[0]
    assert packet["source"] == f"https://api.fda.gov/drug/shortages.json?search=package_ndc:{A}-*&limit=100"
    assert (packet["data_version"], packet["state"], packet["record"]) == ("2026-10-21", "ok", "https://dps.fda.gov/drugshortages")
    listing = packet["listings"][0]
    assert (listing["package"], listing["availability"], listing["updated"], listing["info"], listing["cause"]) == (
        f"{A}-10", "Unavailable", "2026-10-14", "Estimated recovery: TBD", "UNSTATED")
    assert packet["listings_sha256"] == _sha(json.dumps(packet["listings"], sort_keys=True))
    body = {k: v for k, v in packet.items() if k != "packet_sha256"}
    assert packet["packet_sha256"] == _sha(json.dumps(body, sort_keys=True))
    assert json.loads(claim.timeline_json)[0]["evidence"] == packet["packet_sha256"]


def test_registry_reads_in_one_call(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie, cause="UNSTATED")
    assert [p.id for p in contract.get_pledges(0, 200)] == [pledge_id]
    assert [c.id for c in contract.get_claims(0, 200)] == [claim_id]
    assert contract.explain_claim(claim_id).startswith(f"BREACHED: {A} (Ativan 2 mg/mL) is still listed as Unavailable")
    assert contract.response_window_seconds() == 600
