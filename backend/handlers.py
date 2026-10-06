"""Lambda handlers (API Gateway proxy events)."""
import json
import os

from escrow import Escrow, EscrowError, DynamoStore, MemoryStore
from paypal_client import get_client
import matcher

_store = DynamoStore(os.environ["ORDERS_TABLE"]) if os.getenv("ORDERS_TABLE") else MemoryStore()
_escrow = Escrow(_store, get_client())

LISTINGS = [
    {"listing_id": "l1", "title": "De-identified ICU vitals, 10k patients", "description": "time series vitals", "tags": ["icu", "vitals"]},
    {"listing_id": "l2", "title": "Chest X-ray imaging set", "description": "labeled radiology images", "tags": ["radiology", "xray"]},
]


def _resp(code: int, body: dict) -> dict:
    return {"statusCode": code, "headers": {"Content-Type": "application/json"}, "body": json.dumps(body)}


def _presign(listing_id: str) -> str:
    if not os.getenv("DATA_BUCKET"):
        return f"https://mock-bucket.local/{listing_id}?expires={os.getenv('PRESIGNED_URL_TTL_SECONDS', '900')}"
    import boto3

    return boto3.client("s3").generate_presigned_url(
        "get_object",
        Params={"Bucket": os.environ["DATA_BUCKET"], "Key": f"datasets/{listing_id}"},
        ExpiresIn=int(os.getenv("PRESIGNED_URL_TTL_SECONDS", "900")),
    )


def match_request(event, _ctx=None):
    body = json.loads(event.get("body") or "{}")
    return _resp(200, {"matches": matcher.match(body.get("request", ""), LISTINGS)})


def create_order(event, _ctx=None):
    b = json.loads(event.get("body") or "{}")
    order = _escrow.create_order(b["listing_id"], b["buyer_id"], b["seller_id"], b["amount"])
    return _resp(200, order)


def paypal_webhook(event, _ctx=None):
    raw = event.get("body") or ""
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    if not _escrow.paypal.verify_webhook(headers, raw):
        return _resp(401, {"error": "bad signature"})
    evt = json.loads(raw)
    if evt.get("event_type") == "CHECKOUT.ORDER.APPROVED" or evt.get("event_type") == "PAYMENT.CAPTURE.COMPLETED":
        res = evt.get("resource", {})
        paypal_order_id = res.get("id") if evt["event_type"] == "CHECKOUT.ORDER.APPROVED" else (
            res.get("supplementary_data", {}).get("related_ids", {}).get("order_id")
        )
        try:
            _escrow.mark_funded(paypal_order_id)
        except EscrowError as e:
            return _resp(404, {"error": str(e)})
    return _resp(200, {"ok": True})


def download(event, _ctx=None):
    order_id = (event.get("pathParameters") or {}).get("order_id", "")
    try:
        return _resp(200, {"url": _escrow.get_download_url(order_id, _presign)})
    except EscrowError as e:
        return _resp(403, {"error": str(e)})


def confirm(event, _ctx=None):
    order_id = (event.get("pathParameters") or {}).get("order_id", "")
    try:
        return _resp(200, _escrow.confirm_receipt(order_id))
    except EscrowError as e:
        return _resp(409, {"error": str(e)})
