import type { AppDatabase } from "../db/connection";
import { loadCatalog } from "../ai/matcher";
import { rulesVerdict, sampleProfile } from "../ai/sample-check";
import { trustScore, type TrustOrder } from "./score";
import type { DatasetTrust, VendorTrust } from "./load";
import type { OrderEventRow } from "../db/client";
async function score(db: AppDatabase, ids: string[]) {
  if (!ids.length) return trustScore({ orders: [], sampleChecks: [] });
  const marks = ids.map(() => "?").join(", ");
  const orders = (await db
    .prepare(`SELECT id FROM orders WHERE dataset_id IN (${marks})`)
    .all(...ids)) as { id: string }[];
  const events = (await db
    .prepare(
      `SELECT e.* FROM order_events e JOIN orders o ON o.id = e.order_id WHERE o.dataset_id IN (${marks}) ORDER BY e.order_id, e.seq`,
    )
    .all(...ids)) as OrderEventRow[];
  const catalog = new Map(loadCatalog().map((d) => [d.id, d]));
  return trustScore({
    orders: orders.map((o) => ({
      id: o.id,
      events: events.filter((e) => e.order_id === o.id),
    })) as TrustOrder[],
    sampleChecks: ids.flatMap((id) => {
      const entry = catalog.get(id);
      return entry ? [rulesVerdict(sampleProfile(entry)).passed] : [];
    }),
  });
}
export async function datasetTrust(
  db: AppDatabase,
  id: string,
): Promise<DatasetTrust | null> {
  const ds = (await db
    .prepare("SELECT id, vendor_id, title FROM datasets WHERE id = ?")
    .get(id)) as { id: string; vendor_id: string; title: string } | undefined;
  return ds
    ? {
        datasetId: ds.id,
        vendorId: ds.vendor_id,
        title: ds.title,
        trust: await score(db, [ds.id]),
      }
    : null;
}
export async function vendorTrust(
  db: AppDatabase,
  id: string,
): Promise<VendorTrust | null> {
  const vendor = (await db
    .prepare("SELECT id, name FROM vendors WHERE id = ?")
    .get(id)) as { id: string; name: string } | undefined;
  if (!vendor) return null;
  const ids = (await db
    .prepare("SELECT id FROM datasets WHERE vendor_id = ?")
    .all(id)) as { id: string }[];
  return {
    vendorId: id,
    name: vendor.name,
    trust: await score(
      db,
      ids.map((d) => d.id),
    ),
  };
}
export async function listTrust(db: AppDatabase) {
  const vendorIds = (await db
    .prepare("SELECT id FROM vendors ORDER BY id")
    .all()) as { id: string }[];
  const datasetIds = (await db
    .prepare("SELECT id FROM datasets ORDER BY id")
    .all()) as { id: string }[];
  const vendors: VendorTrust[] = [],
    datasets: DatasetTrust[] = [];
  for (const row of vendorIds) vendors.push((await vendorTrust(db, row.id))!);
  for (const row of datasetIds)
    datasets.push((await datasetTrust(db, row.id))!);
  return { vendors, datasets };
}
