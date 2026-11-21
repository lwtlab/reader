import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { binding, positive } from "./reader-verification.mjs";
import { checkedBuild } from "./reader-native-tts-run.mjs";
import { snapshot } from "./llama-cpu-run.mjs";
import { MATRIX } from "./reader-native-tts-contract.mjs";
try {
  assert.equal(process.platform, "win32");
  assert.equal(process.arch, "arm64");
  const value = binding(JSON.parse(process.env.VERIFICATION_BINDING)),
    source = path.resolve("source"),
    build = path.join(process.env.RUNNER_TEMP, "native-build"),
    matrix = MATRIX.find((m) => m.id === "windows-arm64-cpu");
  assert.equal(snapshot(source).head, value.tested);
  assert.equal(snapshot(source).dirty, false);
  const proof = checkedBuild(build, matrix, source, snapshot(source)),
    cache = readFileSync(path.join(build, "CMakeCache.txt"), "utf8");
  assert.match(cache, /^GGML_NATIVE:BOOL=OFF\r?$/m);
  assert.match(cache, /^CMAKE_GENERATOR_PLATFORM:INTERNAL=ARM64\r?$/m);
  assert.match(cache, /^CMAKE_GENERATOR_TOOLSET:INTERNAL=ClangCL\r?$/m);
  const bytes = readFileSync(path.join(build, "bin/reader-qwen3-tts.exe"));
  assert.equal(bytes.subarray(0, 2).toString(), "MZ");
  const offset = bytes.readUInt32LE(0x3c);
  assert(offset + 6 <= bytes.length);
  assert.equal(bytes.readUInt32LE(offset), 0x4550);
  assert.equal(bytes.readUInt16LE(offset + 4), 0xaa64);
  writeFileSync(
    "native-tts-output/source-controls.json",
    JSON.stringify({
      schemaVersion: 1,
      kind: "reader-native-toolchain-probe",
      binding: value,
      run: positive(process.env.GITHUB_RUN_ID),
      attempt: positive(process.env.GITHUB_RUN_ATTEMPT),
      status: "PASS",
      compiler: "ClangCL",
      host: "windows-arm64",
      peMachine: "ARM64",
      nativeTuning: false,
      build: proof,
    }),
  );
  console.log(
    "Diagnostic ARM64 PE and portable ClangCL build verified; no qualification status issued",
  );
} catch {
  console.error("Native toolchain diagnostic failed; details stay encrypted");
  process.exitCode = 1;
}
