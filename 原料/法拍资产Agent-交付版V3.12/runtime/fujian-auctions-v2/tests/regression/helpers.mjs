import crypto from "node:crypto";
import fs from "node:fs/promises";

export async function sha256(filePath) {
  return crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}
