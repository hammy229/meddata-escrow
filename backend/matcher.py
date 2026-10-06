"""AI matching of buyer requests to dataset listings.

USE_BEDROCK=1 calls Claude on Amazon Bedrock; otherwise a keyword fallback is used so
the app runs locally with no AWS account.
"""
import json
import os

MODEL_ID = os.getenv("BEDROCK_MODEL_ID", "anthropic.claude-3-5-sonnet-20241022-v2:0")

PROMPT = """You match medical research data requests to dataset listings.
Request: {request}

Listings (JSON): {listings}

Return ONLY JSON: {{"matches": [{{"listing_id": str, "score": 0-100, "reason": str}}]}}
Sorted by score descending. Only include listings with score >= 40."""


def _keyword_match(request: str, listings: list) -> list:
    words = {w.lower().strip(".,") for w in request.split() if len(w) > 3}
    out = []
    for l in listings:
        text = f"{l['title']} {l.get('description', '')} {' '.join(l.get('tags', []))}".lower()
        hits = sum(1 for w in words if w in text)
        if hits:
            out.append({"listing_id": l["listing_id"], "score": min(100, 30 + hits * 20), "reason": f"{hits} keyword hits"})
    return sorted(out, key=lambda m: -m["score"])


def match(request: str, listings: list) -> list:
    if os.getenv("USE_BEDROCK") != "1":
        return _keyword_match(request, listings)
    import boto3

    client = boto3.client("bedrock-runtime", region_name=os.getenv("AWS_REGION", "us-east-1"))
    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 1000,
        "messages": [{"role": "user", "content": PROMPT.format(request=request, listings=json.dumps(listings))}],
    }
    resp = client.invoke_model(modelId=MODEL_ID, body=json.dumps(body))
    text = json.loads(resp["body"].read())["content"][0]["text"]
    try:
        return json.loads(text)["matches"]
    except (ValueError, KeyError):
        return _keyword_match(request, listings)
