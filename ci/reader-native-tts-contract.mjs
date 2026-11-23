// Reviewed PR-only contract. No model downloads or source-supplied runner/command values.
import { createHash } from "node:crypto";
export const MATRIX = Object.freeze([
  { id: "linux-x64-cpu", os: "ubuntu-24.04", platform: "linux", arch: "x64", backend: "cpu" },
  {
    id: "linux-arm64-cpu",
    os: "ubuntu-24.04-arm",
    platform: "linux",
    arch: "arm64",
    backend: "cpu",
  },
  { id: "macos-arm64-cpu", os: "macos-15", platform: "darwin", arch: "arm64", backend: "cpu" },
  { id: "macos-x64-cpu", os: "macos-15-intel", platform: "darwin", arch: "x64", backend: "cpu" },
  { id: "windows-x64-cpu", os: "windows-2022", platform: "win32", arch: "x64", backend: "cpu" },
  {
    id: "windows-arm64-cpu",
    os: "windows-11-arm",
    platform: "win32",
    arch: "arm64",
    backend: "cpu",
  },
  { id: "macos-arm64-metal", os: "macos-15", platform: "darwin", arch: "arm64", backend: "metal" },
]);
export const STEPS = Object.freeze([
  "submodule",
  "install",
  "runtime-contracts",
  "package-contracts",
  "archive-controls",
  "build",
  "cli-help",
]);
export const POLICY = Object.freeze({
  version: "reader-native-tts-pr-v1",
  realModels: false,
  node: "24.22.0",
  pnpm: "11.5.2",
  python: "3.12",
  timeoutMinutes: 45,
});
export const CONTRACT = createHash("sha256")
  .update(JSON.stringify({ policy: POLICY, matrix: MATRIX, steps: STEPS }))
  .digest("hex");
export function nativePath(file) {
  return /^(native\/(qwen3-tts|reader-models)\/|scripts\/(build-reader-local-tts\.mjs|package-reader-tts-runtime\.py|test_reader_tts_runtime_package\.py|reader-native-tts[^/]*|check-reader-ci[^/]*|verify-public[^/]*)$|apps\/reader\/scripts\/[^/]*local-tts[^/]*$|apps\/reader\/lib\/tts\/local-runtime\/|\.github\/workflows\/reader-native-tts\.yml$|release\/(native-tts-ci|verification-ci)\.json$)/.test(
    file,
  );
}
// A missing/truncated/oversized tree is uncertain, so requires verification.
export function nativeRequired(before, after) {
  const valid = (t) =>
    t &&
    t.truncated === false &&
    Array.isArray(t.tree) &&
    t.tree.length <= 100000 &&
    t.tree.every((x) => typeof x.path === "string" && /^[a-f0-9]{40}$/.test(x.sha));
  if (!valid(before) || !valid(after)) return true;
  const a = new Map(before.tree.map((x) => [x.path, x.sha])),
    b = new Map(after.tree.map((x) => [x.path, x.sha]));
  return [...new Set([...a.keys(), ...b.keys()])].some(
    (k) => a.get(k) !== b.get(k) && nativePath(k),
  );
}
