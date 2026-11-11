import { createHash } from "node:crypto";

// Read-only HBC v98 string boundaries, not a bytecode interpreter.
// Layout: https://github.com/facebook/hermes/blob/hermes-v250829098.0.17/include/hermes/BCGen/HBC/BytecodeFileFormat.h
// Unknown versions, inconsistent ranges and checksum failures retain the finding.
export function isHermesCrossStringMatch(bytes, secret) {
  if (bytes.length < 160 || bytes.length > 256 * 1024 ** 2 || !secret || !/^[\x20-\x7e]+$/.test(secret)) return false;
  if (bytes.readBigUInt64LE(0) !== 0x1f1903c103bc1fc6n || bytes.readUInt32LE(8) !== 98 || bytes.readUInt32LE(32) !== bytes.length) return false;
  const footer = bytes.length - 20;
  if (!createHash("sha1").update(bytes.subarray(0, footer)).digest().equals(bytes.subarray(footer))) return false;
  const functions = bytes.readUInt32LE(40), kinds = bytes.readUInt32LE(44), identifiers = bytes.readUInt32LE(48);
  const strings = bytes.readUInt32LE(52), overflow = bytes.readUInt32LE(56), storageSize = bytes.readUInt32LE(60);
  if (!functions || functions > 1_000_000 || bytes.readUInt32LE(36) >= functions || !kinds || kinds > strings || !strings || strings > 1_000_000 || identifiers > strings || overflow > strings) return false;
  const table = 128 + 12 * functions + 4 * kinds + 4 * identifiers;
  const overflowTable = table + 4 * strings, storage = overflowTable + 8 * overflow;
  if (storage + storageSize > footer) return false;
  const ranges = [];
  for (let n = 0; n < strings; n++) {
    const entry = bytes.readUInt32LE(table + 4 * n);
    let offset = (entry >>> 1) & 0x7fffff, length = entry >>> 24;
    if (length === 255) {
      if (offset >= overflow) return false;
      length = bytes.readUInt32LE(overflowTable + 8 * offset + 4);
      offset = bytes.readUInt32LE(overflowTable + 8 * offset);
    }
    const end = offset + length * (entry & 1 ? 2 : 1);
    if (end > storageSize) return false;
    ranges.push([storage + offset, storage + end]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const needle = Buffer.from(secret, "ascii");
  let matches = 0;
  for (let at = bytes.indexOf(needle); at !== -1; at = bytes.indexOf(needle, at + 1)) {
    if (++matches > 64 || at < storage || at + needle.length > storage + storageSize) return false;
    const end = at + needle.length;
    let covered = at;
    for (const [start, stop] of ranges) {
      if (start > covered) break;
      // Even one complete runtime literal must retain the blocking finding.
      if (start <= at && stop >= end) return false;
      if (stop > covered) covered = stop;
    }
    if (covered < end) return false;
  }
  return matches > 0;
}
