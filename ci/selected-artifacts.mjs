import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {digest,positive} from './reader-verification.mjs';

const PREFIXES = new Set(['plan','reader','cpu','hear','qualification']);
const ZIP_LIMIT = 512 * 1024;
const MEMBER_LIMIT = 64 * 1024;
const decodeZip = `
import base64,json,stat,sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    rows=archive.infolist()
    names=[row.filename for row in rows]
    assert sorted(names)==sorted(json.loads(sys.argv[2]))
    assert len(names)==len(set(names))
    result={}
    for row in rows:
        assert row.filename.endswith('.json') and '/' not in row.filename and '\\\\' not in row.filename
        assert 0<row.file_size<=65536 and not row.flag_bits&1
        mode=row.external_attr>>16
        assert stat.S_IFMT(mode) in (0,stat.S_IFREG)
        data=archive.read(row)
        assert len(data)==row.file_size
        result[row.filename]=base64.b64encode(data).decode('ascii')
    print(json.dumps(result))
`;

export function artifactMembers(bytes,names) {
  assert(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=ZIP_LIMIT);
  assert(Array.isArray(names)&&names.length>0&&names.length<=3);
  const folder=mkdtempSync(join(tmpdir(),'selected-receipt-'));
  try {
    const file=join(folder,'receipt.zip');
    writeFileSync(file,bytes,{mode:0o600});
    const result=JSON.parse(execFileSync('python3',['-c',decodeZip,file,JSON.stringify(names)],{
      encoding:'utf8',timeout:5000,maxBuffer:3*MEMBER_LIMIT*2,stdio:['ignore','pipe','ignore'],
    }));
    return Object.fromEntries(Object.entries(result).map(([name,data])=>[name,Buffer.from(data,'base64')]));
  } finally {rmSync(folder,{recursive:true,force:true});}
}

export async function readSelectedArtifact(api,value,{run,attempt,token,prefix,names,transport=fetch}) {
  assert(PREFIXES.has(prefix));positive(run);positive(attempt);assert(token);
  const listing=await api(`repos/lwtlab/reader/actions/runs/${run}/artifacts?per_page=100`);
  assert(listing.total_count<100,'Paginated artifact listing is required');
  const candidates=listing.artifacts.filter(row=>row.name===`reader-selected-${prefix}-result-${run}-${attempt}`);
  assert.equal(candidates.length,1);
  const artifact=candidates[0];
  assert.equal(artifact.expired,false);
  assert.equal(artifact.workflow_run.id,run);
  assert.equal(artifact.workflow_run.head_sha,value.workflow);
  assert.match(artifact.digest??'',/^sha256:[a-f0-9]{64}$/);
  assert(Number.isSafeInteger(artifact.size_in_bytes)&&artifact.size_in_bytes>0&&artifact.size_in_bytes<=ZIP_LIMIT);
  const response=await transport(`https://api.github.com/repos/lwtlab/reader/actions/artifacts/${positive(artifact.id)}/zip`,{
    headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'},redirect:'manual',signal:AbortSignal.timeout(60000),
  });
  assert.equal(response.status,302);
  const location=new URL(response.headers.get('location'));
  assert.equal(location.protocol,'https:');assert(!location.username&&!location.password);
  // The signed storage request never receives the private repository credential.
  const download=await transport(location,{signal:AbortSignal.timeout(60000)});
  assert(download.ok&&download.body);
  const parts=[];let length=0;
  for await(const part of download.body){length+=part.length;assert(length<=ZIP_LIMIT);parts.push(part);}
  const bytes=Buffer.concat(parts);
  assert.equal(bytes.length,artifact.size_in_bytes);
  assert.equal(`sha256:${digest(bytes)}`,artifact.digest);
  return artifactMembers(bytes,names);
}
