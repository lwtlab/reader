import assert from 'node:assert/strict';
import {mkdtempSync,existsSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import {prepareIos,assertProfileCapabilities} from './ios-signing.mjs';
test('profile import rejects stale matching profiles before archive starts',()=>{
 assert.throws(()=>assertProfileCapabilities({},'net.thucydides.LWTReader'),/App Group/);
 const group={'com.apple.security.application-groups':['group.net.thucydides.LWTReader']};
 assert.throws(()=>assertProfileCapabilities(group,'net.thucydides.LWTReader'),/Apple sign-in/);
 assertProfileCapabilities(group,'net.thucydides.LWTReader.share');
 assertProfileCapabilities({...group,'com.apple.developer.applesignin':['Default']},'net.thucydides.LWTReader');
 assert.throws(()=>assertProfileCapabilities({'com.apple.security.application-groups':['group.other']},'net.thucydides.LWTReader.share'),/App Group/);
});
test('iOS import denial restores the original keychains and never exposes secret arguments', t=>{
 const temp=mkdtempSync(path.join(os.tmpdir(),'reader-ios-signing-test-'));t.after(()=>rmSync(temp,{recursive:true,force:true}));const calls=[];
 const env={IOS_SIGNING_P12_BASE64:Buffer.from('PRIVATE_P12_SENTINEL').toString('base64'),IOS_SIGNING_P12_PASSWORD:'PRIVATE_PASSWORD_SENTINEL',IOS_PROFILE_BASE64:'unused',IOS_SHARE_PROFILE_BASE64:'unused'};
 const run=args=>{calls.push(args);if(args[0]==='list-keychains'&&args.length===3)return '"/original/login.keychain-db"';if(args[0]==='import')throw Error(env.IOS_SIGNING_P12_PASSWORD);return '';};
 assert.throws(()=>prepareIos(temp,path.join(temp,'env'),env,run,path.join(temp,'profiles')),error=>!error.message.includes('PRIVATE_')&&error.cause===undefined);
 assert.equal(existsSync(path.join(temp,'reader-ios-signing')),false);
 assert.deepEqual(calls.filter(a=>a[0]==='list-keychains').at(-1),['list-keychains','-d','user','-s','/original/login.keychain-db']);
});
