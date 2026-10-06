import pytest

from escrow import Escrow, EscrowError, MemoryStore
from paypal_client import MockPayPal
import matcher


@pytest.fixture
def escrow():
    return Escrow(MemoryStore(), MockPayPal())


def presign(listing_id):
    return f"https://x/{listing_id}"


def test_no_download_before_funding(escrow):
    o = escrow.create_order("l1", "b", "s", "100.00")
    with pytest.raises(EscrowError):
        escrow.get_download_url(o["order_id"], presign)


def test_happy_path(escrow):
    o = escrow.create_order("l1", "b", "s", "100.00")
    escrow.mark_funded(o["paypal_order_id"])
    assert escrow.get_download_url(o["order_id"], presign) == "https://x/l1"
    assert escrow.confirm_receipt(o["order_id"])["state"] == "RELEASED"


def test_webhook_replay_is_idempotent(escrow):
    o = escrow.create_order("l1", "b", "s", "100.00")
    escrow.mark_funded(o["paypal_order_id"])
    assert escrow.mark_funded(o["paypal_order_id"])["state"] == "FUNDED"


def test_cannot_release_unfunded(escrow):
    o = escrow.create_order("l1", "b", "s", "100.00")
    with pytest.raises(EscrowError):
        escrow.confirm_receipt(o["order_id"])


def test_keyword_matcher():
    listings = [{"listing_id": "l1", "title": "ICU vitals", "tags": []}, {"listing_id": "l2", "title": "X-ray", "tags": []}]
    res = matcher.match("need icu vitals data", listings)
    assert res and res[0]["listing_id"] == "l1"
