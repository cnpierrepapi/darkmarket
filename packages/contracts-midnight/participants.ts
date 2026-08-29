// The five participants.
//
// One mnemonic, five distinct wallets. Each seed is derived from the master by
// hashing it with the participant index, so the set is reproducible from the
// same mnemonic and nobody has to look after five separate phrases.
//
// Participant 0 is the wallet that already holds funds. It pays for the other
// four, which is why the ordering matters.

import { Buffer } from "node:buffer";
import { createHash, pbkdf2Sync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

export const PARTICIPANTS = 5;

export const readLocalEnv = (key: string): string | undefined => {
  if (process.env[key]) return process.env[key];
  for (const f of [".env.local", "/app/.env.local", "../../.env.local"]) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
      if (!line.trim() || line.trimStart().startsWith("#")) continue;
      const at = line.indexOf("=");
      if (at < 0) continue;
      if (line.slice(0, at).trim() === key) {
        return line.slice(at + 1).trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  return undefined;
};

/** BIP39 seed for the master mnemonic: PBKDF2-HMAC-SHA512, 2048 rounds, 64 bytes. */
export const masterSeed = (mnemonic: string): Buffer => {
  const words = mnemonic.trim().split(/\s+/).join(" ").normalize("NFKD");
  const n = words.split(" ").length;
  if (n !== 12 && n !== 24) throw new Error(`expected 12 or 24 words, got ${n}`);
  return pbkdf2Sync(words, "mnemonic".normalize("NFKD"), 2048, 64, "sha512");
};

/**
 * Participant 0 is the master seed itself, so the already-funded wallet keeps
 * the address it has. Everyone else is a hash of the master with their index.
 */
export const participantSeed = (master: Buffer, index: number): string => {
  if (index === 0) return master.toString("hex");
  const h = createHash("sha512")
    .update(master)
    .update(Buffer.from(`darkmarket/participant/${index}`, "utf8"))
    .digest();
  return h.toString("hex");
};

export const allSeeds = (mnemonic: string): string[] => {
  const m = masterSeed(mnemonic);
  return Array.from({ length: PARTICIPANTS }, (_, i) => participantSeed(m, i));
};

/**
 * Same derivation, but from a raw hex seed rather than a mnemonic. The local
 * chain funds a fixed genesis wallet instead of a phrase, so participant 0 has
 * to be that wallet or nobody can pay for anything.
 */
export const allSeedsFromMaster = (masterHex: string): string[] => {
  const m = Buffer.from(masterHex.replace(/^0x/, ""), "hex");
  return Array.from({ length: PARTICIPANTS }, (_, i) => participantSeed(m, i));
};

/** What each participant wants. Sums to 800 YES and 300 NO. */
export const INTENTS = [
  { side: true, size: 500n },
  { side: true, size: 200n },
  { side: false, size: 100n },
  { side: true, size: 100n },
  { side: false, size: 200n },
];
