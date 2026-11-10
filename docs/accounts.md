# Accounts and workspace setup

Visit `/signup` and choose Researcher or Data provider. Create an account with
an email and a password of 12–128 characters, then complete `/setup`.
Researchers save their institution and research focus; the focus prefills their
study request. Providers save an organization description and PayPal payout
email. Setup can be edited later. Roles are fixed at signup.

Accounts, profiles, and sessions persist in PostgreSQL when `APP_DATABASE_URL`
is set, with SQLite as the local fallback. The hosted demo uses a free Neon
PostgreSQL, wired in through the Render blueprint. Run `npm run db:migrate` and `npm run db:check`; see
[live database setup](live-databases.md), including the one-time SQLite import.

Passwords are salted with scrypt (N=32768, r=8, p=1). Seven-day opaque sessions
store only token hashes in the database. Cookies are HttpOnly, SameSite=Lax,
and Secure in production. Signing out revokes the current session. Auth writes
reject cross-origin requests and authentication attempts are rate limited per
process and IP. Add a shared rate-limit store before running multiple instances.

API route adapters require a valid, fully set-up account and enforce role and
order/dataset/run ownership. Researcher purchases and agent purchases use the
session email, regardless of the supplied buyerEmail. Business handlers are
separate modules to allow direct unit tests of their existing validation and
escrow behavior; they are not public routes. API integration tests cover the
authenticated adapters.

Provider accounts get a new vendor ID. They cannot claim demo vendors or view
other providers' listings, orders, or earnings. Researchers see their own
orders and procurement runs. Orders are linked to the account ID. Existing demo orders retain their buyer
email but are not claimed by registering an account with a matching address.

Providers can connect a PostgreSQL research view from their workspace and publish
synthetic cohorts. Credentials are encrypted and never returned to clients.
Only whitelisted aggregate plans are executed; raw records remain at the source.
New providers begin with an empty catalog. See [live databases](live-databases.md)
for supported view fields, allowed hosts, TLS, and the local synthetic fixture.

The global demo reset HTTP endpoint is disabled because it would erase other
accounts' orders. Vendor webhook simulators are removed; mock PayPal webhooks
are rejected in production. Researcher delivery and payout controls are removed;
those actions belong to the provider.

Before a real launch, integrate email verification, password recovery, and MFA
with a managed identity provider. Payout emails are saved addresses, not verified
PayPal account connections. The current login is suitable for the existing
synthetic-data application and does not establish institutional credentials.

The guided `/demo` page runs mock-only steps in an isolated per-browser SQLite
workspace. Its reset cannot erase authenticated account data. Mandate issuance
requires a researcher account and uses the session buyer identity. Trust reads
require authentication; insights are scoped to the signed-in account.
