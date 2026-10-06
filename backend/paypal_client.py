"""PayPal client with two interchangeable modes.

PAYPAL_MODE=mock    -> no network, deterministic fake responses (default)
PAYPAL_MODE=sandbox -> real calls to the PayPal sandbox API
"""
import os
import uuid

import requests


class PayPalError(Exception):
    pass


class MockPayPal:
    def __init__(self):
        self.orders = {}

    def create_order(self, amount: str, reference_id: str, currency: str = "USD") -> dict:
        order_id = f"MOCK-{uuid.uuid4().hex[:12].upper()}"
        self.orders[order_id] = {"status": "CREATED", "amount": amount, "reference_id": reference_id}
        return {
            "id": order_id,
            "status": "CREATED",
            "approve_url": f"https://www.sandbox.paypal.com/checkoutnow?token={order_id}",
        }

    def capture_order(self, order_id: str) -> dict:
        order = self.orders.get(order_id)
        if not order:
            raise PayPalError(f"unknown order {order_id}")
        order["status"] = "COMPLETED"
        return {"id": order_id, "status": "COMPLETED"}

    def verify_webhook(self, headers: dict, body: str) -> bool:
        return True


class SandboxPayPal:
    def __init__(self, client_id: str, secret: str, base: str, webhook_id: str):
        self.client_id, self.secret, self.base, self.webhook_id = client_id, secret, base, webhook_id

    def _token(self) -> str:
        r = requests.post(
            f"{self.base}/v1/oauth2/token",
            auth=(self.client_id, self.secret),
            data={"grant_type": "client_credentials"},
            timeout=15,
        )
        if not r.ok:
            raise PayPalError(f"token request failed: {r.status_code}")
        return r.json()["access_token"]

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self._token()}", "Content-Type": "application/json"}

    def create_order(self, amount: str, reference_id: str, currency: str = "USD") -> dict:
        body = {
            "intent": "CAPTURE",
            "purchase_units": [
                {"reference_id": reference_id, "amount": {"currency_code": currency, "value": amount}}
            ],
        }
        r = requests.post(f"{self.base}/v2/checkout/orders", json=body, headers=self._headers(), timeout=15)
        if not r.ok:
            raise PayPalError(r.text)
        data = r.json()
        approve = next((l["href"] for l in data["links"] if l["rel"] in ("approve", "payer-action")), None)
        return {"id": data["id"], "status": data["status"], "approve_url": approve}

    def capture_order(self, order_id: str) -> dict:
        r = requests.post(
            f"{self.base}/v2/checkout/orders/{order_id}/capture", headers=self._headers(), timeout=15
        )
        if not r.ok:
            raise PayPalError(r.text)
        return r.json()

    def verify_webhook(self, headers: dict, body: str) -> bool:
        import json

        payload = {
            "auth_algo": headers.get("paypal-auth-algo"),
            "cert_url": headers.get("paypal-cert-url"),
            "transmission_id": headers.get("paypal-transmission-id"),
            "transmission_sig": headers.get("paypal-transmission-sig"),
            "transmission_time": headers.get("paypal-transmission-time"),
            "webhook_id": self.webhook_id,
            "webhook_event": json.loads(body),
        }
        r = requests.post(
            f"{self.base}/v1/notifications/verify-webhook-signature",
            json=payload,
            headers=self._headers(),
            timeout=15,
        )
        return r.ok and r.json().get("verification_status") == "SUCCESS"


def get_client():
    if os.getenv("PAYPAL_MODE", "mock") == "sandbox":
        return SandboxPayPal(
            os.environ["PAYPAL_CLIENT_ID"],
            os.environ["PAYPAL_CLIENT_SECRET"],
            os.getenv("PAYPAL_API_BASE", "https://api-m.sandbox.paypal.com"),
            os.getenv("PAYPAL_WEBHOOK_ID", ""),
        )
    return MockPayPal()
