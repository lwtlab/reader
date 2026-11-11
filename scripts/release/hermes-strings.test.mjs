import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { isHermesCrossStringMatch } from "./hermes-strings.mjs";

// Authored format fixtures, not application bundles or user evidence.
export function syntheticHermes(parts, { overflow = false, utf16 = false } = {}) {
  const pool = Buffer.from(parts.join(""), utf16 ? "utf16le" : "ascii");
  const storage = 128 + 12 + 4 + 4 * parts.length + (overflow ? 8 * parts.length : 0);
  const bytes = Buffer.alloc(storage + pool.length + 20);
  bytes.writeBigUInt64LE(0x1f1903c103bc1fc6n);
  bytes.writeUInt32LE(98, 8); bytes.writeUInt32LE(bytes.length, 32);
  bytes.writeUInt32LE(1, 40); bytes.writeUInt32LE(1, 44);
  bytes.writeUInt32LE(parts.length, 52); bytes.writeUInt32LE(overflow ? parts.length : 0, 56);
  bytes.writeUInt32LE(pool.length, 60); bytes.writeUInt32LE(parts.length, 140);
  let offset = 0;
  parts.forEach((part, n) => {
    const entry = ((overflow ? n : offset) * 2 + Number(utf16)) | ((overflow ? 255 : part.length) << 24);
    bytes.writeUInt32LE(entry >>> 0, 144 + 4 * n);
    if (overflow) {
      bytes.writeUInt32LE(offset, 144 + 4 * parts.length + 8 * n);
      bytes.writeUInt32LE(part.length, 144 + 4 * parts.length + 8 * n + 4);
    }
    offset += part.length * (utf16 ? 2 : 1);
  });
  pool.copy(bytes, storage);
  return seal(bytes);
}
function seal(bytes) {
  createHash("sha1").update(bytes.subarray(0, -20)).digest().copy(bytes, bytes.length - 20);
  return bytes;
}

test("Hermes boundaries classify adjacent strings but retain complete literals and unknown input", () => {
  const value = "authoredSyntheticAlphabet0123456789";
  const parts = ["apiKey='", value.slice(0, 17), value.slice(17), "';"];
  for (const overflow of [false, true]) {
    const bytes = syntheticHermes(parts, { overflow });
    assert.equal(isHermesCrossStringMatch(bytes, value), true);
    assert.equal(isHermesCrossStringMatch(bytes, parts[1]), false);
    assert.equal(isHermesCrossStringMatch(bytes, "absent"), false);
    assert.equal(isHermesCrossStringMatch(syntheticHermes([...parts, value], { overflow }), value), false);
  }
  assert.equal(isHermesCrossStringMatch(syntheticHermes(parts, { utf16: true }), value), false);
  assert.equal(isHermesCrossStringMatch(Buffer.from("short"), value), false);
  for (const [offset, replacement] of [[8, 99], [32, 0], [52, 0xffffffff], [60, 0xffffffff], [144, 0xff0000ff]]) {
    const bytes = syntheticHermes(parts);
    bytes.writeUInt32LE(replacement, offset);
    assert.equal(isHermesCrossStringMatch(seal(bytes), value), false);
  }
  const corrupt = syntheticHermes(parts); corrupt[70] ^= 1;
  assert.equal(isHermesCrossStringMatch(corrupt, value), false);
});
