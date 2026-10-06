"""Escrow state machine. Storage is injected so DynamoDB can replace the in-memory store."""
import time
import uuid

# state -> allowed next states
TRANSITIONS = {
    "PENDING_PAYMENT": {"FUNDED", "CANCELLED"},
    "FUNDED": {"RELEASED", "REFUNDED"},
    "RELEASED": set(),
    "REFUNDED": set(),
    "CANCELLED": set(),
}


class EscrowError(Exception):
    pass


class MemoryStore:
    def __init__(self):
        self.orders = {}

    def put(self, order: dict):
        self.orders[order["order_id"]] = order

    def get(self, order_id: str):
        return self.orders.get(order_id)

    def find_by_paypal_order(self, paypal_order_id: str):
        return next((o for o in self.orders.values() if o["paypal_order_id"] == paypal_order_id), None)


class DynamoStore:
    """Same interface, backed by DynamoDB. Table key: order_id. GSI: paypal_order_id."""

    def __init__(self, table_name: str):
        import boto3

        self.table = boto3.resource("dynamodb").Table(table_name)

    def put(self, order: dict):
        self.table.put_item(Item=order)

    def get(self, order_id: str):
        return self.table.get_item(Key={"order_id": order_id}).get("Item")

    def find_by_paypal_order(self, paypal_order_id: str):
        from boto3.dynamodb.conditions import Key

        res = self.table.query(
            IndexName="paypal_order_id-index", KeyConditionExpression=Key("paypal_order_id").eq(paypal_order_id)
        )
        items = res.get("Items", [])
        return items[0] if items else None


class Escrow:
    def __init__(self, store, paypal):
        self.store, self.paypal = store, paypal

    def create_order(self, listing_id: str, buyer_id: str, seller_id: str, amount: str) -> dict:
        order_id = uuid.uuid4().hex
        pp = self.paypal.create_order(amount, reference_id=order_id)
        order = {
            "order_id": order_id,
            "listing_id": listing_id,
            "buyer_id": buyer_id,
            "seller_id": seller_id,
            "amount": amount,
            "paypal_order_id": pp["id"],
            "approve_url": pp["approve_url"],
            "state": "PENDING_PAYMENT",
            "created_at": int(time.time()),
        }
        self.store.put(order)
        return order

    def _move(self, order: dict, new_state: str) -> dict:
        if new_state not in TRANSITIONS[order["state"]]:
            raise EscrowError(f"illegal transition {order['state']} -> {new_state}")
        order["state"] = new_state
        order[f"{new_state.lower()}_at"] = int(time.time())
        self.store.put(order)
        return order

    def mark_funded(self, paypal_order_id: str) -> dict:
        """Called from the PayPal webhook. Idempotent: replays of the same event are no-ops."""
        order = self.store.find_by_paypal_order(paypal_order_id)
        if not order:
            raise EscrowError("order not found")
        if order["state"] == "FUNDED":
            return order
        return self._move(order, "FUNDED")

    def get_download_url(self, order_id: str, s3_presigner) -> str:
        order = self.store.get(order_id)
        if not order or order["state"] != "FUNDED":
            raise EscrowError("data is only released after escrow is funded")
        return s3_presigner(order["listing_id"])

    def confirm_receipt(self, order_id: str) -> dict:
        order = self.store.get(order_id)
        if not order:
            raise EscrowError("order not found")
        return self._move(order, "RELEASED")
