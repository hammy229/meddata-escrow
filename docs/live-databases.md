# Live databases

The existing project deploys on Render (`docs/architecture.md` and `render.yaml`)
and already listed PostgreSQL as the next persistence layer (`docs/devpost.md`).
The implementation therefore uses standard PostgreSQL for both app persistence
and provider research sources. It also works with other PostgreSQL hosts.

## Hosted app database: Render

Apply the updated `render.yaml` blueprint in your Render workspace. It declares
`meddata-escrow-db` and injects its private connection string as `APP_DATABASE_URL`.
Render generates `CONNECTION_ENCRYPTION_KEY`; there is no database API key to
copy into the source code. Startup runs migrations, seeds missing synthetic
catalog rows without changing prices, then starts the web service. The health
endpoint checks the database and required tables.

The blueprint uses the free database plan to match this project's evaluation
deployment. Free databases are for evaluation; select a production plan and
backup policy before relying on long-term retention. This repository change
does not itself provision a database or deploy the service. Apply the blueprint
or connect the Render integration to activate it.

Render private connections use self-signed certificates. The blueprint explicitly
sets `APP_DATABASE_TLS_MODE=require`: traffic is encrypted, but certificate
verification is disabled for that private app connection. The default for other
app connections is `verify-full`, and provider connections always verify their
certificates. Private-CA deployments can supply `APP_DATABASE_CA_CERT` (PEM).
See [Render connection documentation](https://render.com/docs/postgresql-creating-connecting)
and [blueprint references](https://render.com/docs/blueprint-spec).

`APP_DATABASE_URL` takes precedence over `DATABASE_URL`. Leave it unset for the
existing local SQLite database. Do not put a PostgreSQL URL into a `file:` URL.
SQL migrations are in `lib/db/schema.postgres.sql`, applied explicitly under a
transaction and an advisory lock. The async repository (`lib/db/store.ts`) backs
login, sessions, billing, orders, webhooks, catalog, and procurement. The original
synchronous SQLite helpers remain for test fixtures and local demo scripts.

## Local PostgreSQL for both paths

With Docker installed:

```sh
docker compose up -d
npm run db:configure
```

Set these in ignored `.env.local` (development-only credentials):

```dotenv
APP_DATABASE_URL=postgresql://meddata_app:local-app-only@127.0.0.1:5432/meddata_escrow?sslmode=disable
PROVIDER_DATABASE_HOSTS=127.0.0.1
PROVIDER_DATABASE_ALLOW_LOCAL=true
PAYPAL_MODE=mock
```

Then run:

```sh
npm run db:migrate
npm run db:seed
npm run db:check
npm run dev
```

`db:configure` generates a 32-byte encryption key once and preserves an existing
key. Keep that key stable; losing it makes stored provider credentials unusable.
Render generates its own deployment key. The compose file binds both servers
only to localhost and keeps their data in named volumes. Docker initialization
scripts run only when a volume is new. Docker was not available in the coding
session; PostgreSQL SQL behavior was tested with PGlite instead.

Sign up as a data provider and complete account setup. In the provider workspace,
expand **Add a database connection** and enter:

- Name: `Local synthetic warehouse`
- URL: `postgresql://meddata_reader:local-reader-only@127.0.0.1:5433/research?sslmode=disable`
- Schema: `public`
- Research view: `research_records`

The fixture contains 1,200 synthetic records. After **Test and save**, expand
**Publish a dataset**. Use dataset key `cardio_demo`, a title and description,
and a price. The live cohort count is fetched before publication. Researchers
can discover it through matching, buy it, and run aggregate questions once the
provider delivers the order. PayPal mock mode and database execution mode are
independent: mock payments can purchase a real synthetic PostgreSQL cohort.

## Connecting an existing provider database

Create a dedicated login with SELECT-only access to a dedicated view. Never
use a superuser, a BYPASSRLS account, or an account with write access to the
view. The app tests these permissions before saving or publishing.

The view must expose `dataset_id` plus any of these supported research fields:

- Numeric: `age`, `value`, `cost`, `los`, `bmi`, `score`
- Grouping: `sex`, `region`, `age_group`, `diagnosis`, `year`

Other columns cause the test to fail. Use the view to project or rename your
schema; identifiers must use lowercase letters, digits, and underscores.
`dataset_id` is the provider's cohort key, independent of the marketplace's
randomly generated dataset ID. The supported source contract is intentionally
narrow; arbitrary schemas and SQL are not accepted.

Add the exact source hostname to server-side `PROVIDER_DATABASE_HOSTS` and
restart/redeploy. Wildcards are not accepted. Remote connections require TLS
with certificate verification. Optional PEM CA certificates are stored encrypted
alongside the connection URL. Private network addresses require the separate
operator setting `PROVIDER_DATABASE_ALLOW_PRIVATE=true`. Loopback access and
plaintext TLS opt-out are available only for explicitly enabled local development.
Metadata, loopback, link-local, multicast, and unspecified addresses are denied
for remote sources. DNS results are pinned for each connection while preserving
the TLS hostname, so a hostname cannot rebind between validation and connection.

Credentials are encrypted with AES-256-GCM and bound to the vendor/connection
ID. API reads return metadata only. Connections and dataset publication are
provider-only, and all queries use the dataset's stored vendor-owned source.
A connection used by published datasets cannot be deleted and strand purchases.
To rotate credentials in this version, create a new connection and publish a new
dataset; existing listings keep their original mapping.

The server compiles a validated plan into a parameterized aggregate query. Every
source transaction is read-only, has query/lock timeouts, enforces the cohort key,
returns at most 200 groups, and suppresses every group with fewer than 11 records
in PostgreSQL before returning results. Actual group counts also gate averages,
minimums, and maximums. Connection failures never fall back to fabricated data;
failed/suppressed queries are not billed. Successful responses identify whether
results came from PostgreSQL or the existing mock executor. Sample checks report
live counts and the view contract; they do not pretend to audit completeness,
duplicates, or provenance. This application still accepts synthetic data only.

## Preserve existing SQLite accounts and orders

Before switching an existing database, back it up and stop writes to it. Set the
new `APP_DATABASE_URL` and `SQLITE_IMPORT_PATH` (path to that backup), then run:

```sh
npm run db:migrate
npm run db:import-sqlite
npm run db:check
```

The explicit import inserts rows in foreign-key order inside one destination
transaction. Existing destination rows are preserved on conflicts; the source
is opened read-only. Inspect imported counts and sign in before switching
traffic. Import into a fresh destination before `db:seed` to avoid conflicts
with seeded catalog rows. Provider credentials imported from SQLite require the
same `CONNECTION_ENCRYPTION_KEY`. The import never runs automatically at boot.

## Verification

`npm test` includes real PostgreSQL execution via PGlite for app migrations,
escrow state transitions, billing, webhook deduplication, read-only source
permissions, actual aggregate results, and small-cell suppression. It also tests
encrypted connection storage, cross-vendor ownership, and dataset publication.
These tests do not claim a hosted database was provisioned or reachable.
