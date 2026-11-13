#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, createReadStream, lstatSync, mkdirSync, mkdtempSync, openSync, readSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { isHermesCrossStringMatch } from "./release/hermes-strings.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = path.join(repository, "scripts/release/privacy-gitleaks.toml");
const publicDataFile = path.join(repository, "scripts/release/privacy-public-data.json");
const hermesPolicyFile = path.join(repository, "scripts/release/hermes-strings.mjs");
const publicData = JSON.parse(readFileSync(publicDataFile, "utf8"));
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
export const scannerVersion = "8.30.1";
const archiveExtensions = /\.(zip|apk|aab|ipa|asar|dmg|deb|appimage|7z|tgz|gz|bz2|xz|tar)$/i;
const installerExtension = /\.exe$/i;
// An .exe inside unpacked resources can be a legitimate sidecar, not an installer.
// Top-level EXE inputs remain unsupported by the explicit entrypoint format check.
const unsupportedArchives = /\.rar$/i;

// These rules scan bytes too: native executables can contain embedded credentials.
const contentRules = [
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/],
  ["provider-token", /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{40,}|AKIA[A-Z0-9]{16})/],
  ["developer-home", /(?:\/Users\/(?!runner\/)[a-zA-Z0-9._-]+\/|\/home\/(?!runner\/)[a-zA-Z0-9._-]+\/|[A-Za-z]:\\{1,2}Users\\{1,2}(?!runneradmin\\{1,2})[^\\\s]+\\{1,2})/],
];

export function pathRule(name) {
  const parts = name.replaceAll("\\", "/").split("/");
  const base = parts.at(-1);
  if (/^\.env(?:\.|$)|^\.npmrc$|^\.netrc$|^id_(?:rsa|ed25519)$|^auth\.json$/i.test(base)) return "credential-file";
  if (/\.(p8|p12|pfx|key|keystore|jks)$/i.test(base)) return "private-key-file";
  if (/\.map$/i.test(base)) return "source-map-file";
  if (/\.(sqlite3?|db)(?:-(?:wal|shm))?$|\.(log|har|pcap)$/i.test(base)) return "runtime-data-file";
  const compiledUploadRoute = /(?:^|\/)\.next\/server\/app\/api\/uploads\//.test(name) && /(?:\.js|(?:app-paths|build|server-reference)-manifest\.json)$/.test(base);
  if (!compiledUploadRoute && parts.some((p) => /^(?:uploads|recordings|user-data|evidence-bundles)$/i.test(p))) return "user-content-directory";
  if (parts.includes(".git")) return "git-metadata";
  return null;
}

function command(binary, args) {
  const r = spawnSync(binary, args, { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 300000 });
  // Never print subprocess stderr: it may contain a sensitive source line or absolute path.
  if (r.error || r.signal) throw new Error("Privacy scanner tool unavailable, timed out or failed");
  return r;
}

function loadAsar(projectDir) {
  const req = createRequire(path.join(projectDir, "package.json"));
  try { return req("@electron/asar"); }
  catch {
    try {
      let builder;
      try { builder = req.resolve("app-builder-lib"); }
      catch { builder = createRequire(req.resolve("electron-builder")).resolve("app-builder-lib"); }
      return createRequire(builder)("@electron/asar");
    } catch { throw new Error("ASAR reader unavailable; install application build dependencies"); }
  }
}

function inventory(root, name = "") {
  const file = path.join(root, name), stat = lstatSync(file);
  if (stat.isSymbolicLink()) return [[name, "link", readlinkSync(file)]];
  if (stat.isDirectory()) return [[name, "dir"], ...readdirSync(file).sort().flatMap((e) => inventory(root, path.join(name, e)))];
  return [[name, "file", stat.size]];
}

async function inspectBytes(file, reviewedHomeRanges = []) {
  const digest = createHash("sha256");
  const rules = new Set();
  let tail = "", bytes = 0;
  let standardMarker = false, unknownMarker = false, keyMaterial = false;
  for await (const chunk of createReadStream(file)) {
    digest.update(chunk); bytes += chunk.length;
    const text = tail + chunk.toString("latin1");
    for (const [name, pattern] of contentRules) {
      if (name !== "developer-home") { if (pattern.test(text)) rules.add(name); continue; }
      // Latin-1 preserves raw byte indexes, including escaped Windows separators.
      const textOffset = bytes - chunk.length - tail.length;
      for (const match of text.matchAll(new RegExp(pattern.source, "g"))) {
        const start = textOffset + match.index, end = start + match[0].length;
        const reviewed = reviewedHomeRanges.some(range => start >= range.start && end <= range.end);
        const prefix = text.slice(Math.max(0, match.index - 2048), match.index).replaceAll("\\\\", "\\");
        if (!reviewed && !/https?:\/\/[^\s"'`\x00?#]*$/i.test(prefix)) rules.add(name);
      }
    }
    const normalized = text.replaceAll("\\n", "\n").replaceAll("\\r", "\r");
    for (const marker of normalized.matchAll(/-----BEGIN ([ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?)-----/g)) {
      if (!/^(?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY$/.test(marker[1])) { unknownMarker = true; continue; }
      standardMarker = true;
      const following = normalized.slice(marker.index + marker[0].length, marker.index + marker[0].length + 1024);
      const body = /^[\sA-Za-z0-9+/=]+/.exec(following)?.[0].replace(/\s/g, "") || "";
      if (body.length >= 48 || /^\s*(?:Proc-Type:|DEK-Info:)/.test(following)) keyMaterial = true;
      else if (!/^\s*["'`]/.test(following)) unknownMarker = true;
    }
    tail = text.slice(-1024);
  }
  if (keyMaterial) rules.add("private-key");
  return { sha256: digest.digest("hex"), bytes, rules: [...rules], markerOnly: standardMarker && !unknownMarker && !keyMaterial };
}

// Only exact published file bytes in validated packed ranges can classify a
// container-level home-path match. Header/tail bytes and crossing matches remain
// unreviewed. Other content/secret rules never consume these ranges.
function readAsarHeader(file) {
  const fileSize = lstatSync(file).size;
  const descriptor = openSync(file, "r"), prefix = Buffer.alloc(16);
  try {
    if (readSync(descriptor, prefix, 0, prefix.length, 0) !== prefix.length || prefix.readUInt32LE(0) !== 4) throw new Error("Invalid ASAR header frame");
    const headerSize = prefix.readUInt32LE(4), jsonSize = prefix.readUInt32LE(12);
    if (headerSize < 8 || headerSize % 4 || headerSize > 16 * 1024 ** 2 || 8 + headerSize > fileSize || prefix.readUInt32LE(8) !== headerSize - 4 || jsonSize < 2 || jsonSize > headerSize - 8) throw new Error("Invalid ASAR header bound");
    const data = Buffer.alloc(jsonSize);
    if (readSync(descriptor, data, 0, jsonSize, 16) !== jsonSize) throw new Error("Truncated ASAR header");
    const header = JSON.parse(data.toString("utf8"));
    if (!isRecord(header) || !isRecord(header.files)) throw new Error("Invalid ASAR file tree");
    return { headerSize, header };
  } finally { closeSync(descriptor); }
}

// ASAR headers use literal path components. Reader listPackage() instead joins
// them using the host separator, so it is not an archive-path authority on Windows.
function canonicalAsarEntries(header, asar, file) {
  const entries = [], names = new Set(), pending = [{ files: header.files, prefix: "", depth: 0 }];
  while (pending.length) {
    const { files, prefix, depth } = pending.pop();
    if (!isRecord(files) || depth > 128) throw new Error("Invalid ASAR directory bound");
    for (const [part, node] of Object.entries(files)) {
      if (!safeArchiveName(part) || part === "." || part.includes("/") || !isRecord(node)) throw new Error("Unsafe ASAR entry");
      const name = prefix ? `${prefix}/${part}` : part, key = name.toLowerCase();
      if (names.has(key) || entries.length >= 200000) throw new Error("Unsafe ASAR entry or entry bound");
      names.add(key);
      const info = asar.statFile(file, name.split("/").join(path.sep), false);
      entries.push({ name, info });
      if (Object.hasOwn(node, "files")) {
        if (!isRecord(node.files)) throw new Error("Invalid ASAR directory metadata");
        pending.push({ files: node.files, prefix: name, depth: depth + 1 });
      }
    }
  }
  return entries;
}

export function reviewedAsarRanges(file, headerSize, entries) {
  const fileSize = lstatSync(file).size, raw = readAsarHeader(file);
  if (headerSize !== raw.headerSize) throw new Error("ASAR reader/header mismatch");
  if (!Number.isSafeInteger(headerSize) || headerSize < 4 || headerSize % 4 || headerSize > 16 * 1024 ** 2 || 8 + headerSize > fileSize) throw new Error("Invalid ASAR header bound");
  const dataStart = 8 + headerSize, packed = [];
  for (const { name, info } of entries) {
    let original = raw.header;
    for (const part of name.split("/")) {
      if (!isRecord(original.files) || !Object.hasOwn(original.files, part)) throw new Error("ASAR entry absent from raw header");
      original = original.files[part];
    }
    if (!isDeepStrictEqual(original, info)) throw new Error("ASAR reader/raw entry mismatch");
    if (Object.hasOwn(info, "link")) throw new Error("ASAR links require explicit review");
    if (info.files) continue;
    if (!Number.isSafeInteger(info.size) || info.size < 0 || info.size > 256 * 1024 ** 2 || (info.unpacked !== undefined && typeof info.unpacked !== "boolean")) throw new Error("Invalid ASAR file bound");
    if (info.unpacked) continue;
    if (typeof info.offset !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(info.offset)) throw new Error("Invalid ASAR packed offset");
    const offset = Number(info.offset), start = dataStart + offset, end = start + info.size;
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < dataStart || end > fileSize) throw new Error("ASAR packed file exceeds input");
    packed.push({ name, start, end });
  }
  packed.sort((a, b) => a.start - b.start || a.end - b.end);
  let previousEnd = dataStart;
  for (const range of packed) {
    if (range.end === range.start) continue;
    if (range.start < previousEnd) throw new Error("Overlapping ASAR packed files");
    previousEnd = range.end;
  }
  const reviewed = [], descriptor = openSync(file, "r"), buffer = Buffer.alloc(64 * 1024);
  try {
    for (const range of packed) {
      const candidates = publicData.files.filter(p => p.rule === "developer-home" && (range.name === p.suffix || range.name.endsWith("/" + p.suffix)));
      if (!candidates.length) continue;
      const digest = createHash("sha256");let position = range.start;
      while (position < range.end) {
        const count = readSync(descriptor, buffer, 0, Math.min(buffer.length, range.end - position), position);
        if (!count) throw new Error("ASAR packed bytes truncated");
        digest.update(buffer.subarray(0, count));position += count;
      }
      const sha256 = digest.digest("hex"), match = candidates.find(p => p.sha256 === sha256);
      if (match) reviewed.push({ start: range.start, end: range.end, reviewId: match.id });
    }
  } finally { closeSync(descriptor); }
  return reviewed;
}

// ZIPs are extracted by Python only after validating every entry. No execution of payload code.
function unzip(file, dest) {
  const r = command("python3", ["-c", `
import pathlib,shutil,sys,zipfile
root=pathlib.Path(sys.argv[2]); total=0; seen=set()
with zipfile.ZipFile(sys.argv[1]) as z:
 if len(z.infolist())>100000: raise ValueError('entry bound')
 for e in z.infolist():
  p=pathlib.PurePosixPath(e.filename)
  key=str(p)
  if not e.filename or p.is_absolute() or '..' in p.parts or '\\\\' in e.filename or ':' in e.filename or key in seen or e.flag_bits & 1: raise ValueError('unsafe entry')
  if any(s.endswith((' ','.')) or s.split('.')[0].upper() in ('CON','NUL','PRN','AUX',*[f'COM{i}' for i in range(1,10)],*[f'LPT{i}' for i in range(1,10)]) for s in p.parts):raise ValueError('platform alias')
  seen.add(key); total+=e.file_size
  if total>8*1024**3: raise ValueError('size bound')
 # Android resource names are case sensitive. Preserve all members on macOS/Windows
 # without overwriting aliases; ordinary paths retain ASAR/unpacked sibling layout.
 prefix='.privacy-case-alias'
 while any(n.casefold()==prefix or n.casefold().startswith(prefix+'/') for n in seen):prefix+='-'
 folded=set()
 for i,e in enumerate(z.infolist()):
  p=pathlib.PurePosixPath(e.filename);key=str(p).casefold()
  target=root/p if key not in folded else root/prefix/str(i)/p
  folded.add(key)
  if e.is_dir():target.mkdir(parents=True,exist_ok=True);continue
  target.parent.mkdir(parents=True,exist_ok=True)
  with z.open(e) as src,target.open('wb') as dst:shutil.copyfileobj(src,dst)
  target.chmod(0o600)
`, file, dest]);
  if (r.status !== 0) throw new Error("ZIP cannot be completely inspected (unsafe, encrypted or corrupt)");
}

function safeArchiveName(name) {
  return typeof name === "string" && name.length > 0 && !/^[\\/]|[\\:\x00-\x1f]/.test(name) && !name.split("/").some(part => part === ".." || (part !== "." && /[. ]$/.test(part)) || /^(?:CON|NUL|PRN|AUX|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part));
}

// Extract individual members to plain files. Archive symlinks, hardlinks and mode bits
// never reach the filesystem. Do not execute self-extracting installers/AppImages.
function unpackSevenZip(file, dest, sevenZip) {
  const listing = command(sevenZip, ["l", "-slt", "-ba", "-sccUTF-8", "--", file]);
  if (listing.status !== 0) throw new Error("Installer/archive listing failed");
  const rows = listing.stdout.split(/\r?\n\r?\n/).filter(block => block.trim()).map((block) => {
    const row = {};
    for (const line of block.split(/\r?\n/)) {
      if (!line) continue;
      const i = line.indexOf(" = ");
      if (i < 0 || Object.hasOwn(row, line.slice(0, i))) throw new Error("Ambiguous archive listing");
      row[line.slice(0, i)] = line.slice(i + 3);
    }
    return row;
  });
  if (!rows.length || rows.length > 100000) throw new Error("Archive entry bound");
  const names = new Set();
  let total = 0;
  for (const row of rows) {
    const name = row.Path, size = Number(row.Size);
    const key = typeof name === "string" ? path.posix.normalize(name).toLowerCase() : "";
    if (!safeArchiveName(name) || names.has(key) || row.Encrypted === "+") throw new Error("Unsafe installer/archive entry");
    names.add(key);
    if (row.Folder === "+" || row.Attributes?.startsWith("D")) continue;
    if (row["Symbolic Link"] || row["Hard Link"]) {
      const target = path.join(dest, name);
      mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      writeFileSync(target, row["Symbolic Link"] || row["Hard Link"], { mode: 0o600 });
      continue;
    }
    if (!Number.isSafeInteger(size) || size < 0 || size > 1024 ** 3 || (total += size) > 8 * 1024 ** 3) throw new Error("Archive size bound");
    const result = spawnSync(sevenZip, ["x", "-so", "-spd", "-y", "--", file, name], { maxBuffer: Math.max(size + 65536, 1024 * 1024), timeout: 300000, input: "" });
    if (result.error || result.status !== 0 || result.stdout.length !== size) throw new Error("Archive member could not be completely read");
    const target = path.join(dest, name);
    mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, result.stdout, { mode: 0o600 });
  }
}

function unpackAppImage(file, dest) {
  // Only squashfs AppImage type 2. Reject ambiguous/missing magic instead of executing it.
  const r = command("python3", ["-c", `
import pathlib,sys,struct,subprocess,posixpath
p=pathlib.Path(sys.argv[1]); offsets=[]; tail=b''; pos=0
with p.open('rb') as f:
 while b:=f.read(1024*1024):
  data=tail+b; start=0
  while (i:=data.find(b'hsqs',start))>=0:
   offsets.append(pos-len(tail)+i); start=i+1
   if len(offsets)>10000:raise ValueError('magic bound')
  pos+=len(b);tail=data[-3:]
valid=[]
with p.open('rb') as f:
 for o in offsets:
  f.seek(o);s=f.read(96)
  if len(s)!=96:continue
  block=struct.unpack_from('<I',s,12)[0];major,minor=struct.unpack_from('<HH',s,28);used=struct.unpack_from('<Q',s,40)[0]
  if major==4 and minor==0 and block>=4096 and block<=1048576 and block&(block-1)==0 and 96<=used<=p.stat().st_size-o:valid.append(o)
if len(valid)!=1:raise ValueError('ambiguous squashfs')
listing=subprocess.run(['unsquashfs','-lls','-o',str(valid[0]),str(p)],check=True,capture_output=True,text=True).stdout
total=0;count=0
for line in listing.splitlines():
 if not line or line[0] not in '-dlcbps':continue
 parts=line.split(None,5)
 if len(parts)!=6:raise ValueError('ambiguous squashfs listing')
 mode,_,size,_,_,name=parts;count+=1
 if mode[0] not in '-dl' or not size.isdigit():raise ValueError('special squashfs entry')
 total+=int(size)
 if total>8*1024**3 or count>100000:raise ValueError('squashfs bound')
 if mode[0]=='l':
  name,target=name.split(' -> ',1)
  resolved=posixpath.normpath(posixpath.join(posixpath.dirname(name),target))
  if not resolved.startswith('squashfs-root/'):raise ValueError('external squashfs symlink')
 if name!='squashfs-root' and not name.startswith('squashfs-root/'):raise ValueError('unsafe squashfs path')
if count==0:raise ValueError('empty squashfs listing')
subprocess.run(['unsquashfs','-no-progress','-no-xattrs','-d',sys.argv[2],'-o',str(valid[0]),str(p)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
`, file, dest]);
  if (r.status !== 0) throw new Error("AppImage could not be inspected without execution");
}

/** Local-only audit. A PASS describes this input hash, not permission to publish. */
export async function scanReleasePrivacy(input, { projectDir = path.join(repository, "apps/reader"), gitleaks = "gitleaks", sevenZip = process.platform === "win32" ? "7z" : "7zz", plainFile = false, profile = "generic" } = {}) {
  if (!["generic", "desktop"].includes(profile)) throw new Error("Unknown privacy audit profile");
  input = path.resolve(input);
  const initial = lstatSync(input);
  if (initial.isSymbolicLink()) throw new Error("Audit input must not be a symlink");
  if (!initial.isDirectory() && !archiveExtensions.test(input) && !installerExtension.test(input) && !(plainFile && (/\.(md|txt|json|ya?ml|blockmap)$/i.test(input) || path.basename(input) === "SHA256SUMS"))) throw new Error("Unsupported artifact; provide an unpacked application directory or supported archive");
  const version = command(gitleaks, ["version"]);
  if (version.status !== 0 || version.stdout.trim().replace(/^v/, "") !== scannerVersion) throw new Error(`Gitleaks ${scannerVersion} is required`);
  const temp = mkdtempSync(path.join(tmpdir(), "release-privacy-"));
  const findings = [], notices = [], files = [], scanRoots = [];
  const before = JSON.stringify(inventory(input));
  let expandedBytes = 0, entries = 0;
  const mounts = [];
  const add = (rule, file) => findings.push({ rule, file });
  try {
    const ignore = path.join(temp, "empty-ignore");
    writeFileSync(ignore, "", { mode: 0o600 });
    async function visit(file, label, root, depth, dmgRoot = false) {
      if (++entries > 200000 || depth > 8) throw new Error("Inspection entry/depth bound exceeded");
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) {
        if (dmgRoot && path.basename(file) === "Applications" && readlinkSync(file) === "/Applications") return;
        // Framework aliases are internal and their actual targets are visited separately.
        const resolved = realpathSync(file);
        if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error("External artifact symlink");
        return;
      }
      if (stat.isDirectory()) {
        for (const entry of readdirSync(file).sort()) await visit(path.join(file, entry), label ? `${label}/${entry}` : entry, root, depth, dmgRoot && realpathSync(file) === root);
        return;
      }
      if (!stat.isFile()) throw new Error("Non-regular artifact entry");
      const bytes = await inspectBytes(file);
      files.push({ file, label, sha256: bytes.sha256, bytes: bytes.bytes, markerOnly: bytes.markerOnly });
      const why = pathRule(label);
      if (why) add(why, label);
      for (const rule of bytes.rules) {
        if (rule === "developer-home" && /\.asar$/i.test(file)) continue;
        const reviewed = rule === "developer-home" && publicData.files.find(p => p.rule === rule && bytes.sha256 === p.sha256 && (label === p.suffix || label.endsWith("/" + p.suffix)));
        if (reviewed) notices.push({ rule: "reviewed-public-data", reviewId: reviewed.id, file: label });
        else add(rule, label);
      }
      if (unsupportedArchives.test(file)) throw new Error("Nested unsupported archive; unpack it before auditing");
      if (!archiveExtensions.test(file) && !(file === input && installerExtension.test(file))) return;
      const dest = path.join(temp, `expanded-${scanRoots.length}`);
      mkdirSync(dest, { mode: 0o700 });
      scanRoots.push({ dir: dest, prefix: `${label}!` });
      if (/\.dmg$/i.test(file)) {
        if (process.platform !== "darwin") throw new Error("DMG audit requires macOS");
        const result = command("hdiutil", ["attach", "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", dest, file]);
        if (result.status !== 0) throw new Error("DMG could not be mounted read-only");
        mounts.push(dest);
        await visit(dest, `${label}!`, realpathSync(dest), depth + 1, true);
        return;
      } else if (/\.asar$/i.test(file)) {
        const rawHeader = readAsarHeader(file);
        const asar = loadAsar(projectDir);
        asar.uncache(file);
        const headerSize = asar.getRawHeader(file).headerSize;
        if (headerSize !== rawHeader.headerSize) throw new Error("ASAR header changed during inspection");
        const entries = canonicalAsarEntries(rawHeader.header, asar, file);
        for (const { info } of entries) {
          if (info.link) throw new Error("ASAR links require explicit review");
          if (info.files) continue;
          expandedBytes += info.size;
          if (expandedBytes > 8 * 1024 ** 3 || info.size > 256 * 1024 ** 2) throw new Error("ASAR expansion bound exceeded");
        }
        const ranges = reviewedAsarRanges(file, headerSize, entries);
        for (const { name, info } of entries) {
          if (info.files) continue;
          const target = path.join(dest, name);
          mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
          writeFileSync(target, asar.extractFile(file, name.split("/").join(path.sep)), { mode: 0o600 });
        }
        const checked = await inspectBytes(file, ranges);
        if (checked.sha256 !== bytes.sha256) throw new Error("ASAR changed during inspection");
        if (checked.rules.includes("developer-home")) add("developer-home", label);
        else if (bytes.rules.includes("developer-home")) notices.push({ rule: "reviewed-asar-public-data", reviewIds: ranges.map(r => r.reviewId), file: label });
      } else if (/\.appimage$/i.test(file)) {
        unpackAppImage(file, dest);
      } else if (/\.(zip|apk|aab|ipa)$/i.test(file)) {
        unzip(file, dest); // Python materializes ZIP symlinks as inert text, never follows them.
      } else unpackSevenZip(file, dest, sevenZip);
      await visit(dest, `${label}!`, realpathSync(dest), depth + 1);
    }
    if (initial.isDirectory()) {
      scanRoots.push({ dir: input, prefix: "" });
      await visit(input, "", realpathSync(input), 0);
    } else {
      if (plainFile && !archiveExtensions.test(input) && !installerExtension.test(input)) scanRoots.push({ dir: input, prefix: "" });
      await visit(input, path.basename(input), path.dirname(input), 0);
    }
    if (!files.length) throw new Error("Empty artifact cannot pass");
    // Explicit trusted config and empty ignore file prevent a payload from disabling detection.
    for (const { dir, prefix } of scanRoots) {
      const report = path.join(temp, "gitleaks.json");
      // Raw tool results remain in the same 0700 workspace as extracted payloads.
      // They are never forwarded, returned or retained after this invocation.
      rmSync(report, { force: true });
      writeFileSync(report, "", { mode: 0o600 });
      const r = command(gitleaks, ["dir", dir, "--config", config, "--gitleaks-ignore-path", ignore,
        "--ignore-gitleaks-allow", "--redact=0", "--no-banner", "--max-target-megabytes", "0",
        "--report-format", "json", "--report-path", report]);
      if (![0, 1].includes(r.status)) throw new Error("Secret scan did not complete");
      const results = JSON.parse(readFileSync(report, "utf8"));
      if (!Array.isArray(results) || (r.status === 1 && !results.length)) throw new Error("Invalid secret scan result");
      for (const row of results) {
        const rel = lstatSync(dir).isFile() ? path.basename(dir) : path.isAbsolute(row.File) ? path.relative(dir, row.File) : row.File;
        const label = prefix ? `${prefix}/${rel}` : rel;
        if (row.RuleID === "generic-api-key") {
          const secretHash = createHash("sha256").update(row.Secret).digest("hex");
          const reviewed = publicData.matches.find(p => p.rule === row.RuleID && p.sha256 === secretHash && (!p.label || row.Match.includes(p.label)) && (!p.suffix || label.endsWith("/" + p.suffix) || label === p.suffix));
          // Boundaries alone cannot exclude a credential followed by another
          // packed string. Require an exact reviewed public-data match as well.
          if (reviewed?.format === "hermes-v98-cross-string" && /(?:^|\/)index\.android\.bundle$/.test(label)) {
            const file = path.isAbsolute(row.File) ? row.File : path.resolve(dir, row.File);
            if (lstatSync(file).size <= 256 * 1024 ** 2 && isHermesCrossStringMatch(readFileSync(file), row.Secret)) {
              notices.push({ rule: "hermes-cross-string-match", reviewId: reviewed.id, file: label }); continue;
            }
          }
          if (/(?:^|\/)files\.json$/.test(label) && /^chunk-[A-Z0-9]{8}\.js$/.test(row.Secret)) {
            const file = path.isAbsolute(row.File) ? row.File : path.resolve(dir, row.File);
            const index = JSON.parse(readFileSync(file, "utf8"));
            if (Array.isArray(index) && index.includes(row.Secret) && index.every(p => typeof p === "string" && /^[a-zA-Z0-9_.-]+$/.test(p) && /\.(?:js|css|html|json|txt|svg|png|ico|woff2?|ttf|wasm|webmanifest)$/.test(p))) {
              notices.push({ rule: "generated-bundle-chunk-filename", file: label }); continue;
            }
          }
          if (reviewed && !reviewed.format) { notices.push({ rule: "reviewed-public-data", reviewId: reviewed.id, file: label }); continue; }
          if (profile === "desktop") {
            const file = path.isAbsolute(row.File) ? row.File : path.resolve(dir, row.File);
            if (label.endsWith(".next/server/server-reference-manifest.json")) {
              const data = JSON.parse(readFileSync(file, "utf8"));
              if (isRecord(data.node) && isRecord(data.edge) && !Object.keys(data.node).length && !Object.keys(data.edge).length && data.encryptionKey === row.Secret && /^[A-Za-z0-9+/]{43}=$/.test(row.Secret)) {
                notices.push({ rule: "unused-next-desktop-action-key", file: label }); continue;
              }
            }
            if (label.endsWith(".next/prerender-manifest.json")) {
              const data = JSON.parse(readFileSync(file, "utf8"));
              if (isRecord(data.routes) && isRecord(data.dynamicRoutes) && !Object.keys(data.dynamicRoutes).length && Object.keys(data.routes).every(r => ["/_not-found", "/_global-error", "/apple-icon.png", "/favicon.ico", "/icon.png", "/manifest.webmanifest"].includes(r)) && /^[a-f0-9]{64}$/.test(row.Secret) && [data.preview?.previewModeSigningKey, data.preview?.previewModeEncryptionKey].includes(row.Secret)) {
                notices.push({ rule: "unused-next-desktop-preview-key", file: label }); continue;
              }
            }
          }
        }
        if (row.RuleID === "private-key") {
          let match;
          try {
            const absolute = realpathSync(path.isAbsolute(row.File) ? row.File : path.resolve(dir, row.File));
            match = files.find(f => realpathSync(f.file) === absolute);
          } catch { /* Unknown location retains the blocking finding. */ }
          if (match?.markerOnly) {
            notices.push({ rule: "pem-marker-without-key-material", file: match.label });
            continue;
          }
        }
        add(`gitleaks:${row.RuleID}`, prefix ? `${prefix}/${rel}` : rel);
      }
    }
    // Detect replacement of input bytes while scanning; the receipt cannot bless different bytes.
    for (const f of files) if ((await inspectBytes(f.file)).sha256 !== f.sha256) throw new Error("Artifact changed during audit");
    if (JSON.stringify(inventory(input)) !== before) throw new Error("Artifact inventory changed during audit");
    const manifest = files.filter((f) => !f.file.startsWith(temp + path.sep)).map((f) => [f.label, f.sha256, f.bytes]);
    const artifactSha256 = initial.isFile() ? files[0].sha256 : createHash("sha256").update(JSON.stringify({ entries: JSON.parse(before), files: manifest })).digest("hex");
    return { kind: "release-privacy-audit", schemaVersion: 1, status: findings.length ? "FAIL" : "PASS",
      artifactSha256, hashKind: initial.isFile() ? "file-sha256" : "sorted-tree-sha256-v2",
      profile, scanner: { gitleaks: scannerVersion, policySha256: createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).update(readFileSync(config)).update(readFileSync(publicDataFile)).update(readFileSync(hermesPolicyFile)).digest("hex") }, filesScanned: files.length,
      findings: [...new Map(findings.map((f) => [JSON.stringify(f), f])).values()],
      notices,
      limitations: ["Pattern scanning cannot establish consent or detect all personal content; review screenshots, audio and sample assets separately."] };
  } finally {
    for (const mount of mounts.reverse()) {
      if (command("hdiutil", ["detach", mount]).status !== 0) throw new Error("DMG cleanup failed; mounted audit workspace retained");
    }
    rmSync(temp, { recursive: true, force: true });
  }
}

export async function requireReleasePrivacy(input, options) {
  const report = await scanReleasePrivacy(input, options);
  if (report.status !== "PASS") throw new Error(`Release privacy gate blocked ${report.findings.length} finding(s); run scripts/release-privacy.mjs locally for redacted details`);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { positionals, values } = parseArgs({ allowPositionals: true, options: { "project-dir": { type: "string" }, profile: { type: "string", default: "generic" } } });
    if (positionals.length !== 1) throw new Error("Invalid audit arguments");
    const result = await scanReleasePrivacy(positionals[0], { ...(values["project-dir"] ? { projectDir: path.resolve(values["project-dir"]) } : {}), profile: values.profile });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === "PASS" ? 0 : 1;
  } catch {
    console.error('Release privacy audit ERROR: inspection incomplete; no PASS issued. Verify tools, archive format, read permissions and size bounds.');
    process.exitCode = 2;
  }
}
