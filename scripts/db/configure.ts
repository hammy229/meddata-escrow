import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
const path = ".env.local";
let content = existsSync(path)
  ? readFileSync(path, "utf8")
  : "# Local development secrets. Never commit this file.\n";
if (!/^CONNECTION_ENCRYPTION_KEY=.+$/m.test(content)) {
  content = content.replace(/^CONNECTION_ENCRYPTION_KEY=.*\n?/m, "");
  content += `\nCONNECTION_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}\n`;
  writeFileSync(path, content, { mode: 0o600 });
  console.log(
    "Provider connection encryption key saved to ignored .env.local.",
  );
} else console.log("Existing provider connection encryption key preserved.");
console.log(
  "Render creates APP_DATABASE_URL through render.yaml. For local PostgreSQL, set APP_DATABASE_URL in .env.local; leave it unset to use SQLite.",
);
