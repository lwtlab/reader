#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, closeSync, createReadStream, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readlinkSync, readSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
const defaultOnlyPrerender = data => data?.version === 4 && isRecord(data.routes) && isRecord(data.dynamicRoutes) && !Object.keys(data.dynamicRoutes).length && Object.keys(data.routes).every(r => ["/_not-found", "/_global-error", "/apple-icon.png", "/favicon.ico", "/icon.png", "/manifest.webmanifest"].includes(r));
const previewFields = ["previewModeId", "previewModeSigningKey", "previewModeEncryptionKey"];
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
  ["developer-home", /(?:\/Users\/(?!runner\/)[a-zA-Z0-9._-]+\/|\/home\/(?!runner\/)[a-zA-Z0-9._-]+\/|[A-Za-z]:\\Users\\(?!runneradmin\\)[^\\\s]+\\)/],
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

function command(binary, args, maxBuffer = 1024 * 1024) {
  const r = spawnSync(binary, args, { encoding: "utf8", maxBuffer, timeout: 300000 });
  // Never print subprocess stderr: it may contain a sensitive source line or absolute path.
  if (r.error || r.signal) throw new Error("Privacy scanner tool unavailable, timed out or failed");
  return r;
}

function loadAsar(projectDir) {
  const req = createRequire(path.join(projectDir, "package.json"));
  try { return req("@electron/asar"); }
  catch {
    try { return createRequire(req.resolve("app-builder-lib"))("@electron/asar"); }
    catch { throw new Error("ASAR reader unavailable; install application build dependencies"); }
  }
}

function inventory(root, name = "") {
  const file = path.join(root, name), stat = lstatSync(file);
  if (stat.isSymbolicLink()) return [[name, "link", readlinkSync(file)]];
  if (stat.isDirectory()) return [[name, "dir"], ...readdirSync(file).sort().flatMap((e) => inventory(root, path.join(name, e)))];
  return [[name, "file", stat.size]];
}

// CodeResources is Apple's signed resource index, not arbitrary application prose.
// Classify only the two matching, typed plist keys for each fixed compiler filename.
function macResourcePathRanges(file) {
  const r = command("python3", [
    "-c",
    `
import json,pathlib,plistlib,re,sys
b=pathlib.Path(sys.argv[1]).read_bytes();ranges=[]
try:
 d=plistlib.loads(b)
 if not b.lstrip().startswith(b'<?xml') or not isinstance(d,dict) or set(d)!={'files','files2','rules','rules2'} or any(not isinstance(d[k],dict) for k in d):raise ValueError('schema')
 for name in ('app-paths-manifest.json','build-manifest.json','server-reference-manifest.json'):
  key='Resources/standalone/apps/reader/.next/server/app/api/home/route/'+name
  old=d['files'].get(key);new=d['files2'].get(key)
  if not isinstance(old,bytes) or len(old)!=20 or not isinstance(new,dict) or set(new)!={'hash2'} or not isinstance(new['hash2'],bytes) or len(new['hash2'])!=32:continue
  matches=list(re.finditer(re.escape(b'<key>'+key.encode()+b'</key>'),b))
  if len(matches)==2:ranges.extend([[m.start()+5,m.end()-6] for m in matches])
except Exception:pass
print(json.dumps(ranges))
`,
    file,
  ]);
  if (r.status !== 0) throw new Error("Resource index path inspection incomplete");
  return JSON.parse(r.stdout);
}

async function inspectBytes(file) {
  const digest = createHash("sha256");
  const rules = new Set();
  let tail = "", bytes = 0;
  const tar = /\.tar$/i.test(file), zip = /\.(zip|apk|aab|ipa)$/i.test(file), md5 = path.basename(file) === "md5sums", macResources = file.split(path.sep).join("/").endsWith("/Contents/_CodeSignature/CodeResources"), homeRouteOffsets = new Set();
  let standardMarker = false, unknownMarker = false, keyMaterial = false, nextRouteMetadataPath = false;
  for await (const chunk of createReadStream(file)) {
    digest.update(chunk); bytes += chunk.length;
    const text = tail + chunk.toString("latin1");
    if (tar || zip || md5 || macResources) for (const match of text.matchAll(/\/home\/route\//g)) {
      if (!/https?:\/\/[^\s"'`\x00?#]*$/i.test(text.slice(Math.max(0, match.index - 2048), match.index)))
        homeRouteOffsets.add(bytes - chunk.length - tail.length + match.index);
      if (homeRouteOffsets.size > 100000) throw new Error("Path classification bound exceeded");
    }
    for (const [name, pattern] of contentRules) {
      if (name !== "developer-home") { if (pattern.test(text)) rules.add(name); continue; }
      const pathText = text.replaceAll("\\\\", "\\");
      for (const match of pathText.matchAll(new RegExp(pattern.source, "g"))) {
        const prefix = pathText.slice(Math.max(0, match.index - 2048), match.index);
        // TAR path fields can be split across ustar name/prefix fields. Defer
        // this one ambiguous account name until the validated TAR reader proves
        // exact byte ranges belonging to known compiler metadata paths.
        if ((tar || zip || md5 || macResources) && match[0] === "/home/route/") continue;
        if (!/https?:\/\/[^\s"'`\x00?#]*$/i.test(prefix)) rules.add(name);
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
  if ((md5 || macResources) && homeRouteOffsets.size) {
    const ranges = macResources && bytes <= 16 * 1024 ** 2 ? macResourcePathRanges(file) : [];
    if (md5 && bytes <= 16 * 1024 ** 2) {
      const data = readFileSync(file).toString("latin1");
      for (const match of data.matchAll(/^[a-fA-F0-9]{32} [ *]((?:\.\/)?opt\/Reader\/resources\/standalone\/apps\/reader\/\.next\/server\/app\/api\/home\/route\/(?:build-manifest|server-reference-manifest|app-paths-manifest)\.json)\r?$/gm)) {
        const start = match.index + match[0].indexOf(match[1]);
        ranges.push([start, start + match[1].length]);
      }
    }
    if ([...homeRouteOffsets].some(offset => !ranges.some(([start, end]) => offset >= start && offset + 12 <= end))) rules.add("developer-home");
    nextRouteMetadataPath = [...homeRouteOffsets].some(offset => ranges.some(([start, end]) => offset >= start && offset + 12 <= end));
  }
  if (keyMaterial) rules.add("private-key");
  return { sha256: digest.digest("hex"), bytes, rules: [...rules], tarHomeRoutes: tar ? [...homeRouteOffsets] : [], zipHomeRoutes: zip ? [...homeRouteOffsets] : [], nextRouteMetadataPath, markerOnly: standardMarker && !unknownMarker && !keyMaterial };
}

// ZIPs are extracted by Python only after validating every entry. No execution of payload code.
function unzip(file, dest) {
  const r = command("python3", [
    "-c",
    `
import json,pathlib,re,shutil,struct,sys,zipfile
root=pathlib.Path(sys.argv[2]); total=0; seen=set();ranges=[]
with zipfile.ZipFile(sys.argv[1]) as z:
 if len(z.infolist())>100000: raise ValueError('entry bound')
 for e in z.infolist():
  p=pathlib.PurePosixPath(e.filename)
  key=str(p)
  if not e.filename or e.orig_filename!=e.filename or any(ord(c)<32 for c in e.filename) or p.is_absolute() or '..' in p.parts or chr(92) in e.filename or ':' in e.filename or key in seen or e.flag_bits & 1: raise ValueError('unsafe entry')
  if any(s.endswith((' ','.')) or s.split('.')[0].upper() in ('CON','NUL','PRN','AUX',*[f'COM{i}' for i in range(1,10)],*[f'LPT{i}' for i in range(1,10)]) for s in p.parts):raise ValueError('platform alias')
  seen.add(key); total+=e.file_size
  if total>8*1024**3: raise ValueError('size bound')
 # Android resource names are case sensitive. Preserve all members on macOS/Windows
 # without overwriting aliases; ordinary paths retain ASAR/unpacked sibling layout.
 prefix='.privacy-case-alias'
 while any(n.casefold()==prefix or n.casefold().startswith(prefix+'/') for n in seen):prefix+='-'
 folded=set();central=z.start_dir
 for i,e in enumerate(z.infolist()):
  encoded=e.orig_filename.encode('utf8' if e.flag_bits & 0x800 else 'cp437')
  with open(sys.argv[1],'rb') as raw:
   raw.seek(e.header_offset);local=raw.read(30)
   if len(local)!=30 or local[:4]!=bytes([80,75,3,4]):raise ValueError('local header')
   local_length=struct.unpack_from('<H',local,26)[0]
   if raw.read(local_length)!=encoded:raise ValueError('local name')
   raw.seek(central);header=raw.read(46)
   if len(header)!=46 or header[:4]!=bytes([80,75,1,2]):raise ValueError('central header')
   name_length,extra_length,comment_length=struct.unpack_from('<HHH',header,28)
   if raw.read(name_length)!=encoded:raise ValueError('central name')
  known_directory=e.filename=='Reader.app/Contents/Resources/standalone/apps/reader/.next/server/app/api/home/route/' and e.is_dir() and e.file_size==0
  if known_directory or re.fullmatch(r'Reader[.]app/Contents/Resources/standalone/apps/reader/[.]next/server/app/api/home/route/(?:app-paths-manifest|build-manifest|server-reference-manifest)[.]json',e.filename):
   ranges.extend([[e.header_offset+30,e.header_offset+30+local_length],[central+46,central+46+name_length]])
  central+=46+name_length+extra_length+comment_length
  p=pathlib.PurePosixPath(e.filename);key=str(p).casefold()
  target=root/p if key not in folded else root/prefix/str(i)/p
  folded.add(key)
  if e.is_dir():target.mkdir(parents=True,exist_ok=True);continue
  target.parent.mkdir(parents=True,exist_ok=True)
  with z.open(e) as src,target.open('wb') as dst:shutil.copyfileobj(src,dst)
  target.chmod(0o600)
print(json.dumps(ranges))
`,
    file,
    dest,
  ]);
  if (r.status !== 0)
    throw new Error("ZIP cannot be completely inspected (unsafe, encrypted or corrupt)");
  return JSON.parse(r.stdout);
}

function safeArchiveName(name) {
  return typeof name === "string" && name.length > 0 && !/^[\\/]|[\\:\x00-\x1f]/.test(name) && !name.split("/").some(part => part === ".." || (part !== "." && /[. ]$/.test(part)) || /^(?:CON|NUL|PRN|AUX|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part));
}

function unpackTar(file, dest) {
  // A single bounded pass avoids starting a new archive reader for every file
  // in an uncompressed DEB data.tar. Never use extract()/extractall(): links and
  // modes stay inert, and every member is validated before any bytes are written.
  const r = command("python3", ["-c", `
import json,os,pathlib,re,shutil,sys,tarfile
root=pathlib.Path(sys.argv[2]);members=[];seen=set();total=0;ranges=[]
def known(name):
 return bool(re.fullmatch(r'opt/Reader/resources/standalone/apps/reader/\\.next/server/app/api/home/route(?:/(?:build-manifest|server-reference-manifest|app-paths-manifest)\\.json)?',str(pathlib.PurePosixPath(name))))
if pathlib.Path(sys.argv[1]).stat().st_size>8*1024**3:raise ValueError('raw archive bound')
with tarfile.open(sys.argv[1],mode='r:') as archive:
 for member in archive:
  name=member.name;p=pathlib.PurePosixPath(name);key=str(p).lower()
  if not name or p.is_absolute() or '..' in p.parts or '\\\\' in name or ':' in name or re.search(r'[\\x00-\\x1f]',name) or key in seen:raise ValueError('unsafe member')
  if any((s!='.' and s.endswith((' ','.'))) or re.match(r'^(CON|NUL|PRN|AUX|COM[1-9]|LPT[1-9])(?:\\.|$)',s,re.I) for s in p.parts):raise ValueError('platform alias')
  if not (member.isdir() or member.isfile() or member.issym() or member.islnk()):raise ValueError('special member')
  if not member.isdir() and not p.parts:raise ValueError('root file')
  if (member.isdir() or member.issym() or member.islnk()) and member.size!=0:raise ValueError('non-file data')
  if member.size<0 or member.size>1024**3:raise ValueError('member size bound')
  linkbytes=member.linkname.encode('utf8') if member.issym() or member.islnk() else b''
  if len(linkbytes)>1024**3:raise ValueError('link size bound')
  seen.add(key);members.append((member,linkbytes));total+=member.size+len(linkbytes)
  if len(members)>100000 or total>8*1024**3:raise ValueError('archive bound')
 if not members:raise ValueError('empty archive')
 # tarfile otherwise treats malformed/truncated headers after a valid member
 # as an ordinary end. Require both end blocks and only complete zero padding.
 archive.fileobj.seek(archive.offset);padding=0
 while chunk:=archive.fileobj.read(1024*1024):
  padding+=len(chunk)
  if any(chunk):raise ValueError('nonzero archive tail')
 if padding<1024 or padding%512:raise ValueError('missing archive terminator')
 for member,_ in members:
  if not known(member.name) or member.sparse is not None or member.type==tarfile.GNUTYPE_SPARSE:continue
  header=member.offset_data-512
  archive.fileobj.seek(header);block=archive.fileobj.read(512)
  if len(block)!=512:raise ValueError('missing header')
  name=block[:100].split(b'\\0',1)[0];prefix=block[345:500].split(b'\\0',1)[0]
  logical=member.name.encode('utf8')
  if name and not name.startswith(b'/') and (logical.rstrip(b'/').endswith(name.rstrip(b'/')) or logical.rstrip(b'/').startswith(name.rstrip(b'/'))):ranges.append([header,header+len(name)])
  if prefix and logical.startswith(prefix.rstrip(b'/')+b'/'):ranges.append([header+345,header+345+len(prefix)])
  if header-member.offset>32*1024**2:raise ValueError('header metadata bound')
  archive.fileobj.seek(member.offset);metadata=archive.fileobj.read(header-member.offset)
  start=0
  while (index:=metadata.find(logical,start))>=0:
   end=index+len(logical)
   if member.isdir() and metadata[end:end+1]==b'/':end+=1
   ranges.append([member.offset+index,member.offset+end]);start=index+1
 for member,linkbytes in members:
  if member.isdir():continue
  target=root/pathlib.PurePosixPath(member.name)
  target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
  with os.fdopen(os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as output:
   if member.issym() or member.islnk():output.write(linkbytes)
   else:
    source=archive.extractfile(member)
    if source is None:raise ValueError('missing member bytes')
    with source:shutil.copyfileobj(source,output)
  if member.isfile() and target.stat().st_size!=member.size:raise ValueError('truncated member')
  if member.isfile() and pathlib.PurePosixPath(member.name).name=='md5sums' and member.size<=16*1024**2 and member.sparse is None and member.type!=tarfile.GNUTYPE_SPARSE:
   offset=0
   for line in target.read_bytes().splitlines(keepends=True):
    match=re.fullmatch(rb'[a-fA-F0-9]{32} [ *]([^\\r\\n]+)(?:\\r?\\n)?',line)
    if match and known(match[1].decode('utf8')):
     ranges.append([member.offset_data+offset+match.start(1),member.offset_data+offset+match.end(1)])
    offset+=len(line)
print(json.dumps(ranges))
`, file, dest]);
  if (r.status !== 0) throw new Error("Unsafe, corrupt or oversized TAR archive");
  return JSON.parse(r.stdout);
}

// Extract individual members to plain files. Archive symlinks, hardlinks and mode bits
// never reach the filesystem. Do not execute self-extracting installers/AppImages.
function unpackSevenZip(file, dest, sevenZip) {
  // Pin the DEB outer container; newer 7-Zip otherwise auto-opens its nameless XZ stream.
  const nsis = /\.exe$/i.test(file);
  const container = /\.deb$/i.test(file) ? ["-tAr"] : nsis ? ["-tNsis"] : [];
  const listing = command(sevenZip, ["l", "-slt", "-ba", "-sccUTF-8", ...container, "--", file], 32 * 1024 ** 2);
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
  // XZ is a data stream with no filename field. 7-Zip represents a nameless
  // .tar.xz stream as one empty Path, not a filesystem entry. Materialize only
  // that exact format as a fixed virtual tar name; ordinary empty archive paths
  // and every directory/link/encrypted member remain invalid.
  let namelessTarStream = false;
  if (/\.tar\.xz$/i.test(file) && rows.length === 1 && (rows[0].Path === undefined || rows[0].Path === "") && rows[0].Folder !== "+" && !rows[0].Attributes?.startsWith("D") && !rows[0]["Symbolic Link"] && !rows[0]["Hard Link"] && rows[0].Encrypted !== "+") {
    const header = Buffer.alloc(6), fd = openSync(file, "r");
    try { readSync(fd, header, 0, header.length, 0); } finally { closeSync(fd); }
    if (header.equals(Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0]))) {
      namelessTarStream = true;
      rows[0].Path = "content.tar";
    }
  }
  const names = new Set();
  let total = 0;
  for (const row of rows) {
    const rawName = row.Path;
    // Windows 7-Zip renders member separators natively. Normalize only its
    // display/API boundary; raw ZIP/TAR/ASAR header validation stays strict.
    const name = process.platform === "win32" && typeof rawName === "string" ? rawName.replaceAll("\\", "/") : rawName;
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
    // NSIS compressed records need not store an unpacked size. Force the NSIS
    // decoder and read to successful EOF under the SAME member/total bounds;
    // an absent size in any other format remains incomplete, never zero.
    const unknownSize = nsis && row.Size === "";
    const size = !unknownSize && /^\d+$/.test(row.Size ?? "") ? Number(row.Size) : NaN;
    if (!unknownSize && (!Number.isSafeInteger(size) || size < 0 || size > 1024 ** 3 || total + size > 8 * 1024 ** 3)) throw new Error("Archive size bound");
    const maximum = unknownSize ? Math.min(1024 ** 3, 8 * 1024 ** 3 - total) : size;
    const result = spawnSync(sevenZip, ["x", "-so", "-spd", "-y", ...container, "--", file, ...(namelessTarStream ? [] : [rawName])], { maxBuffer: unknownSize ? maximum + 1 : Math.max(size + 65536, 1024 * 1024), timeout: 300000, input: "" });
    if (result.error || result.status !== 0 || (!unknownSize && result.stdout.length !== size)) throw new Error("Archive member could not be completely read");
    if (result.stdout.length > maximum) throw new Error("Archive size bound");
    total += result.stdout.length;
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
# unsquashfs 4.5 requires a nonexistent destination. Remove only this empty,
# dedicated directory; rmdir refuses a nonempty target and the 0700 parent stays.
pathlib.Path(sys.argv[2]).rmdir()
subprocess.run(['unsquashfs','-no-progress','-no-xattrs','-d',sys.argv[2],'-o',str(valid[0]),str(p)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
`, file, dest]);
  if (r.status !== 0) throw new Error("AppImage could not be inspected without execution");
}

/** Local-only audit. A PASS describes this input hash, not permission to publish. */
export async function scanReleasePrivacy(input, { projectDir = path.join(repository, "apps/reader"), gitleaks = "gitleaks", sevenZip = process.platform === "win32" ? "7z" : "7zz", plainFile = false, profile = "generic", onAsarUnclassifiedMatch } = {}) {
  if (!["generic", "desktop"].includes(profile)) throw new Error("Unknown privacy audit profile");
  input = path.resolve(input);
  const initial = lstatSync(input);
  if (initial.isSymbolicLink()) throw new Error("Audit input must not be a symlink");
  if (!initial.isDirectory() && !archiveExtensions.test(input) && !installerExtension.test(input) && !(plainFile && (/\.(md|txt|json|ya?ml|blockmap)$/i.test(input) || path.basename(input) === "SHA256SUMS"))) throw new Error("Unsupported artifact; provide an unpacked application directory or supported archive");
  const version = command(gitleaks, ["version"]);
  if (version.status !== 0 || version.stdout.trim().replace(/^v/, "") !== scannerVersion) throw new Error(`Gitleaks ${scannerVersion} is required`);
  const temp = mkdtempSync(path.join(tmpdir(), "release-privacy-"));
  const findings = [], notices = [], files = [], scanRoots = [];
  const asarMembers = new Map(), classifiedMatches = new Map(), asarProofs = new Map(), fileDigests = new Map();
  const asarDiagnostics = new Set();
  const asarHeaderHashes = new Map();
  const classificationKey = (rule, sha256) => `${["generic-api-key", "next-manifest-key"].includes(rule) ? "classified-key" : rule}:${sha256}`;
  const matchKey = row => classificationKey(row.RuleID, createHash("sha256").update(row.Secret).digest("hex"));
  const remember = (file, key) => {
    let matches = classifiedMatches.get(file);
    if (!matches) classifiedMatches.set(file, matches = new Set());
    matches.add(key);
  };
  async function provenAsarMatch(file, row) {
    const members = asarMembers.get(file);
    if (!members || typeof row.Secret !== "string") return false;
    const needle = Buffer.from(row.Secret);
    if (needle.length < 8 || needle.length > 4096) return false;
    const key = matchKey(row), cacheKey = `${file}\0${key}`;
    if (asarProofs.has(cacheKey)) return asarProofs.get(cacheKey);
    const ranges = members.filter(member => classifiedMatches.get(member.file)?.has(key));
    if (!ranges.length) return false;
    let position = 0, tail = Buffer.alloc(0), previous = -1, count = 0, valid = true;
    for await (const chunk of createReadStream(file)) {
      const bytes = Buffer.concat([tail, chunk]);
      for (let i = bytes.indexOf(needle); i >= 0; i = bytes.indexOf(needle, i + 1)) {
        const start = position - tail.length + i;
        if (start <= previous) continue;
        previous = start;
        if (++count > 100000 || !ranges.some(range => start >= range.start && start + needle.length <= range.end)) { valid = false; break; }
      }
      if (!valid) break;
      position += chunk.length;
      tail = bytes.subarray(Math.max(0, bytes.length - needle.length + 1));
    }
    const result = valid && count > 0;
    asarProofs.set(cacheKey, result);
    return result;
  }
  async function describeAsarMatch(file, row) {
    if (typeof onAsarUnclassifiedMatch !== "function" || !asarMembers.has(file) || typeof row.Secret !== "string") return;
    const needle = Buffer.from(row.Secret);
    if (needle.length < 8 || needle.length > 4096) return;
    const key = matchKey(row), occurrences = [], members = asarMembers.get(file);
    const safeDigest = file => fileDigests.get(file) === row.Secret ? undefined : fileDigests.get(file);
    const diagnosticKey = `${file}\0${row.RuleID}\0${key}`;
    if (asarDiagnostics.has(diagnosticKey)) return;
    asarDiagnostics.add(diagnosticKey);
    let position = 0, tail = Buffer.alloc(0), previous = -1, count = 0;
    for await (const chunk of createReadStream(file)) {
      const bytes = Buffer.concat([tail, chunk]);
      for (let i = bytes.indexOf(needle); i >= 0; i = bytes.indexOf(needle, i + 1)) {
        const start = position - tail.length + i;
        if (start <= previous) continue;
        previous = start;
        if (++count > 100000) throw new Error("ASAR diagnostic occurrence bound exceeded");
        if (occurrences.length >= 32) continue;
        const member = members.find(item => start >= item.start && start + needle.length <= item.end);
        occurrences.push(member ? {
          member: member.name.includes(row.Secret) ? "[redacted]" : member.name,
          fileSha256: safeDigest(member.file),
          offset: start - member.start,
          classified: classifiedMatches.get(member.file)?.has(key) ?? false,
        } : { member: null, offset: start, classified: false,
          boundaryMembers: [start, start + needle.length - 1].map(offset => {
            const adjacent = members.find(item => offset >= item.start && offset < item.end);
            return adjacent ? { member: adjacent.name.includes(row.Secret) ? "[redacted]" : adjacent.name, fileSha256: safeDigest(adjacent.file), offset: offset - adjacent.start } : null;
          }),
        });
      }
      position += chunk.length;
      tail = bytes.subarray(Math.max(0, bytes.length - needle.length + 1));
    }
    // Deliberately expose no tool Match/Secret, content, absolute paths or source lines.
    const secretSha256 = createHash("sha256").update(row.Secret).digest("hex");
    const headerHashCandidates = (asarHeaderHashes.get(file) ?? []).filter(item => item.valueSha256 === secretSha256).slice(0, 32).map(item => ({ member: item.name.includes(row.Secret) ? "[redacted]" : item.name, field: item.field, matchesWholeFile: item.valueSha256 === createHash("sha256").update(fileDigests.get(item.file) ?? "").digest("hex") }));
    await onAsarUnclassifiedMatch({ rule: row.RuleID, secretSha256, matchSha256: createHash("sha256").update(row.Match).digest("hex"), bytes: needle.length, count, occurrences, truncated: count > occurrences.length, headerHashCandidates });
  }
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
      fileDigests.set(realpathSync(file), bytes.sha256);
      files.push({ file, label, sha256: bytes.sha256, bytes: bytes.bytes, markerOnly: bytes.markerOnly });
      const why = pathRule(label);
      if (why) add(why, label);
      if (bytes.nextRouteMetadataPath) notices.push({ rule: "next-api-route-metadata-path", file: label });
      for (const rule of bytes.rules) {
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
        const asar = loadAsar(projectDir);
        // ASAR listPackage uses native path separators and normalizes header
        // components before returning them. Validate the raw tree first instead.
        asar.uncache(file);
        const raw = asar.getRawHeader(file);
        const header = raw.header;
        const dataOffset = 8 + raw.headerSize;
        if (!Number.isSafeInteger(dataOffset) || dataOffset > stat.size) throw new Error("Invalid ASAR header range");
        const pending = [{ tree: header.files, prefix: "" }];
        const memberRanges = [];
        asarMembers.set(realpathSync(file), memberRanges);
        const headerHashes = [];
        asarHeaderHashes.set(realpathSync(file), headerHashes);
        const names = new Set();
        let members = 0;
        while (pending.length) {
          const { tree, prefix } = pending.pop();
          if (!tree || typeof tree !== "object" || Array.isArray(tree)) throw new Error("Unsafe ASAR header");
          for (const [component, info] of Object.entries(tree)) {
            const name = prefix ? `${prefix}/${component}` : component;
            if (++members > 200000 || name.length > 4096) throw new Error("ASAR entry/path bound exceeded");
            const key = name.toLowerCase();
            if (!safeArchiveName(component) || component === "." || component.includes("/") || names.has(key)) throw new Error("Unsafe ASAR entry");
            names.add(key);
            if (!info || typeof info !== "object" || Array.isArray(info)) throw new Error("Unsafe ASAR header");
            if (Object.hasOwn(info, "link")) throw new Error("ASAR links require explicit review");
            if (Object.hasOwn(info, "files")) {
              pending.push({ tree: info.files, prefix: name });
              continue;
            }
            if (!Number.isSafeInteger(info.size) || info.size < 0) throw new Error("Invalid ASAR member size");
            if (info.unpacked !== undefined && typeof info.unpacked !== "boolean") throw new Error("Invalid ASAR header");
            if (!info.unpacked) {
              const offset = typeof info.offset === "string" && /^\d+$/.test(info.offset) ? Number(info.offset) : NaN;
              if (!Number.isSafeInteger(offset) || offset + info.size > stat.size - dataOffset) throw new Error("Invalid ASAR member range");
            }
            expandedBytes += info.size;
            if (expandedBytes > 8 * 1024 ** 3 || info.size > 256 * 1024 ** 2) throw new Error("ASAR expansion bound exceeded");
            const target = path.join(dest, name);
            const content = asar.extractFile(file, path.normalize(name));
            if (content.length !== info.size) throw new Error("Incomplete ASAR member");
            mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
            writeFileSync(target, content, { mode: 0o600 });
            if (typeof onAsarUnclassifiedMatch === "function" && info.integrity && typeof info.integrity === "object") {
              const values = [["integrity.hash", info.integrity.hash], ...(Array.isArray(info.integrity.blocks) ? info.integrity.blocks.slice(0, 64).map((value, index) => [`integrity.blocks[${index}]`, value]) : [])];
              for (const [field, value] of values) if (typeof value === "string" && /^[a-f0-9]{64}$/.test(value)) headerHashes.push({ name, file: realpathSync(target), field, valueSha256: createHash("sha256").update(value).digest("hex") });
            }
            if (!info.unpacked) memberRanges.push({ name, file: realpathSync(target), start: dataOffset + Number(info.offset), end: dataOffset + Number(info.offset) + info.size });
          }
        }
      } else if (/\.appimage$/i.test(file)) {
        unpackAppImage(file, dest);
      } else if (/\.(zip|apk|aab|ipa)$/i.test(file)) {
        const ranges = unzip(file, dest); // Links remain inert text.
        if (bytes.zipHomeRoutes.some(offset => !ranges.some(([start, end]) => offset >= start && offset + 12 <= end))) add("developer-home", label);
        if (bytes.zipHomeRoutes.some(offset => ranges.some(([start, end]) => offset >= start && offset + 12 <= end))) notices.push({ rule: "next-api-route-metadata-path", file: label });
      } else if (/\.tar$/i.test(file)) {
        const ranges = unpackTar(file, dest);
        if (bytes.tarHomeRoutes.some(offset => !ranges.some(([start, end]) => offset >= start && offset + 12 <= end))) add("developer-home", label);
        if (bytes.tarHomeRoutes.some(offset => ranges.some(([start, end]) => offset >= start && offset + 12 <= end))) notices.push({ rule: "next-api-route-metadata-path", file: label });
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
    for (const entry of files) {
      const canonical = realpathSync(entry.file);
      // A directory-scanner path exclusion is not a content proof. Reuse only
      // explicit reviewed values, their required suffix and optional whole-file digest.
      for (const reviewed of publicData.matches) {
        if (!reviewed.suffix || reviewed.label || reviewed.format || !["generic-api-key", "next-manifest-key"].includes(reviewed.rule)) continue;
        if (!(entry.label === reviewed.suffix || entry.label.endsWith("/" + reviewed.suffix)) || (reviewed.fileSha256 && reviewed.fileSha256 !== entry.sha256)) continue;
        remember(canonical, classificationKey(reviewed.rule, reviewed.sha256));
      }
      if (profile !== "desktop" || !entry.label.endsWith(".next/server/server-reference-manifest.js") || entry.bytes > 1024 * 1024) continue;
      // Next also emits an escaped JS copy. Accept only its exact inert wrapper,
      // exact schema and byte-equivalent data from the empty-action JSON sibling.
      try {
        const match = /^self\.__RSC_SERVER_MANIFEST\s*=\s*("(?:\\.|[^"\\])*")\s*;?\s*$/.exec(readFileSync(entry.file, "utf8"));
        if (!match) continue;
        const data = JSON.parse(JSON.parse(match[1]));
        const reference = JSON.parse(readFileSync(path.join(path.dirname(entry.file), "server-reference-manifest.json"), "utf8"));
        if (!isRecord(data) || Object.keys(data).sort().join(",") !== "edge,encryptionKey,node" || !isRecord(data.node) || !isRecord(data.edge) || Object.keys(data.node).length || Object.keys(data.edge).length || typeof data.encryptionKey !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(data.encryptionKey) || !isDeepStrictEqual(data, reference)) continue;
        remember(canonical, classificationKey("next-manifest-key", createHash("sha256").update(data.encryptionKey).digest("hex")));
        notices.push({ rule: "unused-next-desktop-action-key-copy", file: entry.label });
      } catch { /* Missing, malformed or changed proof remains unclassified. */ }
    }
    // Explicit trusted config and empty ignore file prevent a payload from disabling detection.
    // Classify validated member files before their raw ASAR container. Raw
    // matches still block unless every occurrence belongs to an approved member.
    for (const { dir, prefix } of [...scanRoots].reverse()) {
      const report = path.join(temp, "gitleaks.json");
      // Raw tool results remain in the same 0700 workspace as extracted payloads.
      // They are never forwarded, returned or retained after this invocation.
      rmSync(report, { force: true });
      writeFileSync(report, "", { mode: 0o600 });
      const r = command(gitleaks, ["dir", dir, "--config", config, "--gitleaks-ignore-path", ignore,
        "--ignore-gitleaks-allow", "--redact=0", "--no-banner", "--max-target-megabytes", "0",
        "--report-format", "json", "--report-path", report]);
      // Gitleaks may replace the precreated report; its private parent protects
      // it during execution, and the report itself stays private before reading.
      chmodSync(report, 0o600);
      if (![0, 1].includes(r.status)) throw new Error("Secret scan did not complete");
      const results = JSON.parse(readFileSync(report, "utf8"));
      if (!Array.isArray(results) || (r.status === 1 && !results.length)) throw new Error("Invalid secret scan result");
      for (const row of results) {
        const rel = lstatSync(dir).isFile() ? path.basename(dir) : path.isAbsolute(row.File) ? path.relative(dir, row.File) : row.File;
        // Normalize native separators only; a literal backslash on POSIX is not a route.
        const label = (prefix ? `${prefix}/${rel}` : rel).split(path.sep).join("/");
        const scannedFile = realpathSync(lstatSync(dir).isFile() ? dir : path.isAbsolute(row.File) ? row.File : path.resolve(dir, row.File));
        const accept = notice => {
          notices.push(notice);
          remember(scannedFile, matchKey(row));
        };
        if (await provenAsarMatch(scannedFile, row)) {
          accept({ rule: "asar-classified-member-match", originalRule: row.RuleID, file: label });
          continue;
        }
        await describeAsarMatch(scannedFile, row);
        if (row.RuleID === "generic-api-key" || row.RuleID === "next-manifest-key") {
          const secretHash = createHash("sha256").update(row.Secret).digest("hex");
          const reviewed = publicData.matches.find(p => p.rule === row.RuleID && p.sha256 === secretHash && (!p.label || row.Match.includes(p.label)) && (!p.suffix || label.endsWith("/" + p.suffix) || label === p.suffix) && (!p.fileSha256 || p.fileSha256 === fileDigests.get(scannedFile)));
          // Boundaries alone cannot exclude a credential followed by another
          // packed string. Require an exact reviewed public-data match as well.
          if (reviewed?.format === "hermes-v98-cross-string" && /(?:^|\/)index\.android\.bundle$/.test(label)) {
            const file = path.isAbsolute(row.File) ? row.File : path.resolve(dir, row.File);
            if (lstatSync(file).size <= 256 * 1024 ** 2 && isHermesCrossStringMatch(readFileSync(file), row.Secret)) {
              accept({ rule: "hermes-cross-string-match", reviewId: reviewed.id, file: label }); continue;
            }
          }
          if (/(?:^|\/)files\.json$/.test(label) && /^chunk-[A-Z0-9]{8}\.js$/.test(row.Secret)) {
            const file = path.isAbsolute(row.File) ? row.File : path.resolve(dir, row.File);
            const index = JSON.parse(readFileSync(file, "utf8"));
            if (Array.isArray(index) && index.includes(row.Secret) && index.every(p => typeof p === "string" && /^[a-zA-Z0-9_.-]+$/.test(p) && /\.(?:js|css|html|json|txt|svg|png|ico|woff2?|ttf|wasm|webmanifest)$/.test(p))) {
              accept({ rule: "generated-bundle-chunk-filename", file: label }); continue;
            }
          }
          if (reviewed && !reviewed.format) { accept({ rule: "reviewed-public-data", reviewId: reviewed.id, file: label }); continue; }
          if (profile === "desktop") {
            const file = path.isAbsolute(row.File) ? row.File : path.resolve(dir, row.File);
            if (label.endsWith(".next/server/server-reference-manifest.json")) {
              const data = JSON.parse(readFileSync(file, "utf8"));
              if (isRecord(data.node) && isRecord(data.edge) && !Object.keys(data.node).length && !Object.keys(data.edge).length && data.encryptionKey === row.Secret && /^[A-Za-z0-9+/]{43}=$/.test(row.Secret)) {
                accept({ rule: "unused-next-desktop-action-key", file: label }); continue;
              }
            }
            if (label.endsWith(".next/prerender-manifest.json")) {
              const data = JSON.parse(readFileSync(file, "utf8"));
              if (defaultOnlyPrerender(data) && /^[a-f0-9]{64}$/.test(row.Secret) && [data.preview?.previewModeSigningKey, data.preview?.previewModeEncryptionKey].includes(row.Secret)) {
                accept({ rule: "unused-next-desktop-preview-key", file: label }); continue;
              }
            }
            if (/(?:^|\/)\.next\/server\/preview-props\.json$/.test(label)) {
              // Next 16.4 emits a second copy of the preview metadata. Prove
              // identity with the already constrained prerender manifest and
              // absence of actions; never exempt an arbitrary token in this file.
              const prerenderFile = path.join(path.dirname(file), "..", "prerender-manifest.json");
              const referenceFile = path.join(path.dirname(file), "server-reference-manifest.json");
              if (existsSync(prerenderFile) && existsSync(referenceFile)) {
                const data = JSON.parse(readFileSync(file, "utf8"));
                const prerender = JSON.parse(readFileSync(prerenderFile, "utf8"));
                const reference = JSON.parse(readFileSync(referenceFile, "utf8"));
                if (isRecord(data) && Object.keys(data).length === previewFields.length && previewFields.every(key => typeof data[key] === "string" && data[key] === prerender.preview?.[key]) && /^[a-f0-9]{32}$/.test(data.previewModeId) && /^[a-f0-9]{64}$/.test(data.previewModeSigningKey) && /^[a-f0-9]{64}$/.test(data.previewModeEncryptionKey) && defaultOnlyPrerender(prerender) && isRecord(reference.node) && isRecord(reference.edge) && !Object.keys(reference.node).length && !Object.keys(reference.edge).length && [data.previewModeSigningKey, data.previewModeEncryptionKey].includes(row.Secret)) {
                  accept({ rule: "unused-next-desktop-preview-key-copy", file: label }); continue;
                }
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
            accept({ rule: "pem-marker-without-key-material", file: match.label });
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
