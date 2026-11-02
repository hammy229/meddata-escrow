import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
function key(): Buffer {
  const value = process.env.CONNECTION_ENCRYPTION_KEY;
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value))
    throw new Error(
      "Set CONNECTION_ENCRYPTION_KEY to a base64-encoded 32-byte key",
    );
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 32) throw new Error("Invalid connection encryption key");
  return bytes;
}
export function encryptSecret(value: string, owner: string): string {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(owner));
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
}
export function decryptSecret(value: string, owner: string): string {
  const [version, iv, tag, data] = value.split(".");
  if (version !== "v1" || !iv || !tag || !data)
    throw new Error("Invalid encrypted connection");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(iv, "base64"),
  );
  cipher.setAAD(Buffer.from(owner));
  cipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    cipher.update(Buffer.from(data, "base64")),
    cipher.final(),
  ]).toString("utf8");
}
