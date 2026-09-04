import crypto from "node:crypto";
import { AsyncEntry } from "@napi-rs/keyring";

const SERVICE = "FujianJudicialAuctionAgent";
const ACCOUNT = "developer-delivery-password-v1";

function credential() {
  if (process.platform !== "win32") throw new Error("开发者密码当前只支持Windows凭据管理器");
  return new AsyncEntry(SERVICE, ACCOUNT);
}

export function hashDeveloperPassword(password, salt = crypto.randomBytes(16)) {
  if (String(password || "").length < 10) throw new Error("开发者密码至少需要10个字符");
  const derived = crypto.scryptSync(String(password), salt, 32);
  return { version: 1, salt: salt.toString("base64"), hash: derived.toString("base64") };
}

export function verifyDeveloperPasswordHash(password, record) {
  try {
    const salt = Buffer.from(record.salt, "base64");
    const expected = Buffer.from(record.hash, "base64");
    const actual = crypto.scryptSync(String(password || ""), salt, expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
}

export async function developerPasswordConfigured() {
  try { return Boolean(await credential().getPassword()); } catch { return false; }
}

export async function verifyDeveloperPassword(password) {
  try {
    const stored = await credential().getPassword();
    return stored ? verifyDeveloperPasswordHash(password, JSON.parse(stored)) : false;
  } catch { return false; }
}

export async function setDeveloperPassword(password, currentPassword = null) {
  const configured = await developerPasswordConfigured();
  if (configured && !await verifyDeveloperPassword(currentPassword)) throw new Error("原开发者密码不正确");
  await credential().setPassword(JSON.stringify(hashDeveloperPassword(password)));
  return true;
}

export function createDeveloperSession() {
  return { token: crypto.randomBytes(32).toString("base64url"), expiresAt: Date.now() + 15 * 60_000 };
}
