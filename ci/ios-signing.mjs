import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {appendFileSync,existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
const security=args=>execFileSync('/usr/bin/security',args,{encoding:'utf8',stdio:'pipe'});
export function assertProfileCapabilities(entitlements,bundle){
 assert.ok(['net.thucydides.LWTReader','net.thucydides.LWTReader.share'].includes(bundle));
 assert.ok(entitlements['com.apple.security.application-groups']?.includes('group.net.thucydides.LWTReader'),'Required Reader App Group missing from profile');
 if(bundle==='net.thucydides.LWTReader')assert.ok(entitlements['com.apple.developer.applesignin']?.includes('Default'),'Required Apple sign-in missing from profile');
}
function paths(temp){assert.ok(path.isAbsolute(temp));const root=path.join(temp,'reader-ios-signing');return {root,state:path.join(root,'state.json'),keychain:path.join(root,'reader.keychain-db')};}
export function cleanupIos(temp,run=security){
 const p=paths(temp);if(!existsSync(p.root))return;
 const state=JSON.parse(readFileSync(p.state));assert.equal(state.kind,'reader-ios-signing-v1');assert.equal(state.keychain,p.keychain);
 assert.ok(state.original.length && state.original.every(x=>path.isAbsolute(x)));
 let failed=false;
 try{run(['list-keychains','-d','user','-s',...state.original]);}catch{failed=true;}
 try{run(['delete-keychain',p.keychain]);}catch{failed=true;}
 for(const file of state.profiles||[]) {assert.ok(path.basename(file).startsWith('reader-ci-'));rmSync(file,{force:true});}
 rmSync(p.root,{recursive:true,force:true});if(failed)throw new Error('iOS signing cleanup failed');
}
export function prepareIos(temp,envFile,env=process.env,run=security,profileRoot=path.join(os.homedir(),'Library/Developer/Xcode/UserData/Provisioning Profiles')){
 const p=paths(temp);assert.ok(!existsSync(p.root));
 const keys=['IOS_SIGNING_P12_BASE64','IOS_SIGNING_P12_PASSWORD','IOS_PROFILE_BASE64','IOS_SHARE_PROFILE_BASE64'];assert.ok(keys.every(k=>env[k]),'Missing isolated iOS signing material');
 const original=[...run(['list-keychains','-d','user']).matchAll(/"([^"\n]+)"/g)].map(m=>m[1]);assert.ok(original.length);
 mkdirSync(p.root,{mode:0o700});mkdirSync(profileRoot,{recursive:true});
 const state={kind:'reader-ios-signing-v1',keychain:p.keychain,original,profiles:[]};
 const save=()=>writeFileSync(p.state,JSON.stringify(state),{mode:0o600});save();
 try{
  const p12=path.join(p.root,'distribution.p12');writeFileSync(p12,Buffer.from(env.IOS_SIGNING_P12_BASE64,'base64'),{mode:0o600});
  const password=randomBytes(32).toString('hex');
  run(['create-keychain','-p',password,p.keychain]);run(['set-keychain-settings','-lut','21600',p.keychain]);run(['unlock-keychain','-p',password,p.keychain]);run(['list-keychains','-d','user','-s',p.keychain,...original]);
  run(['import',p12,'-k',p.keychain,'-P',env.IOS_SIGNING_P12_PASSWORD,'-T','/usr/bin/codesign','-T','/usr/bin/security']);
  run(['set-key-partition-list','-S','apple-tool:,apple:,codesign:','-s','-k',password,p.keychain]);
  const identities=[...run(['find-identity','-v','-p','codesigning',p.keychain]).matchAll(/^\s*\d+\) ([A-F0-9]{40}) "([^"\n]+)"/gm)];
  assert.equal(identities.length,1);assert.equal(identities[0][1],'0B25C8552D5E560E9F7FB28E6F0BB370BB1AE1C7');assert.match(identities[0][2],/^Apple Distribution: .+\(N4HQH532K9\)$/);
  for(const [key,bundle,name] of [['IOS_PROFILE_BASE64','net.thucydides.LWTReader','LWT Reader AppStore'],['IOS_SHARE_PROFILE_BASE64','net.thucydides.LWTReader.share','LWT Reader Share AppStore']]){
   const file=path.join(profileRoot,`reader-ci-${randomBytes(16).toString('hex')}.mobileprovision`);
   state.profiles.push(file);save();writeFileSync(file,Buffer.from(env[key],'base64'),{flag:'wx',mode:0o600});
   // Only public profile identity is printed to the bounded verifier's stdin; its full plist is never logged.
   const plist=run(['cms','-D','-i',file]);
   const entitlements=JSON.parse(execFileSync('python3',['-c',`import datetime,hashlib,json,plistlib,sys
p=plistlib.loads(sys.stdin.buffer.read())
assert p['Name']==sys.argv[1] and p['TeamIdentifier']==['N4HQH532K9']
assert p['Entitlements']['application-identifier']=='N4HQH532K9.'+sys.argv[2]
assert p['Entitlements'].get('get-task-allow') is False
assert p['ExpirationDate']>datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
assert '0B25C8552D5E560E9F7FB28E6F0BB370BB1AE1C7' in [hashlib.sha1(c).hexdigest().upper() for c in p['DeveloperCertificates']]
print(json.dumps(p['Entitlements']))
`,name,bundle],{input:plist,stdio:['pipe','pipe','pipe']}));
   assertProfileCapabilities(entitlements,bundle);
  }
  rmSync(p12);appendFileSync(envFile,`READER_IOS_KEYCHAIN=${p.keychain}\n`);
 }catch{try{cleanupIos(temp,run);}catch{}throw new Error('iOS signing setup failed; private arguments omitted');}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{assert.equal(process.platform,'darwin');if(process.argv[2]==='prepare')prepareIos(process.env.RUNNER_TEMP,process.env.GITHUB_ENV);else if(process.argv[2]==='cleanup')cleanupIos(process.env.RUNNER_TEMP);else throw Error('Use prepare or cleanup');console.log('iOS isolated signing state '+process.argv[2]+' complete');}catch(error){console.error(error.message);process.exitCode=1;}
}
