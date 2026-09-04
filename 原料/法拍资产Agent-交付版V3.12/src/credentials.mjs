import { AsyncEntry } from "@napi-rs/keyring";

const SERVICE = "FujianJudicialAuctionAgent";

function entry(envName) {
  if (process.platform !== "win32") throw new Error("当前持久密钥保存仅支持Windows凭据管理器");
  return new AsyncEntry(SERVICE, envName);
}

export function credentialStorageLabel() {
  return "Windows Credential Manager";
}

export async function savePersistentCredential(config, envName, apiKey) {
  await entry(envName).setPassword(apiKey);
  return credentialStorageLabel();
}

export async function loadPersistentCredential(config, envName = config.ai.apiKeyEnv) {
  try { return (await entry(envName).getPassword()) || null; } catch { return null; }
}

export async function forgetPersistentCredential(config, envName = config.ai.apiKeyEnv) {
  let forgotten = false;
  try { forgotten = Boolean(await entry(envName).deleteCredential()); } catch {}
  delete process.env[envName];
  return forgotten;
}

export async function activatePersistentCredential(config) {
  if (!config.ai.apiKeyEnv || process.env[config.ai.apiKeyEnv]) return Boolean(process.env[config.ai.apiKeyEnv]);
  const key = await loadPersistentCredential(config);
  if (!key) return false;
  process.env[config.ai.apiKeyEnv] = key;
  return true;
}
