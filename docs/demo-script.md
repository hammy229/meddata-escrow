# Demo Script

Target: a tight walkthrough under 3 minutes for the demo video.

## 0. Setup (before recording)

- `npm install && npm run seed && npm run dev`
- PayPal sandbox buyer account ready (Developer Dashboard → Sandbox → Accounts)

## 1. The problem (15s)

One line: researchers can't verify data before paying, and sharing raw records
is a privacy risk.

## 2. Researcher describes a study (20s)

Open `/researcher`, type a plain-English study description.

## 3. AI matches datasets (20s)

Show ranked matches in the AG Grid catalog.

## 4. Escrow: authorize (25s)

Trigger purchase → PayPal **authorizes** (funds held). Show the sandbox hold.

## 5. Sample check → capture (25s)

Sample passes → PayPal **captures**. (Mention: on failure it voids, buyer not charged.)

## 6. Pay-per-query (25s)

Run a plain-English query → privacy-safe aggregate returned → per-query charge
in PayPal. Emphasize: raw records never left the vendor.

## 7. Wrap-up (15s)

Synthetic data only. Public repo, MIT, runnable from the README.
