import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {validateFocusedReport} from './gui-diagnostic.mjs';
import {digest} from './reader-verification.mjs';
import {MANIFEST} from './selected-input.mjs';
const realReport=JSON.parse(readFileSync(new URL('./fixtures/focused-gui-generated-report.json',import.meta.url)));
const generatedTitles=[...new Set(realReport.suites[0].specs.map(s=>digest(s.title)))];
function fixture(){return structuredClone(realReport);}
const check=report=>validateFocusedReport(Buffer.from(JSON.stringify(report)),generatedTitles);
test('focused contract requires all three unchanged cases twenty times without retries/skips',()=>{assert.deepEqual(check(fixture()),{passed:60,failed:0,skipped:0,repeats:20});});
test('actual reporter grouping and separately serialized repeats retain all60 distinct executions',()=>{const f=fixture();assert.equal(f.config.version,'1.61.1');assert.equal(f.suites[0].specs.length,3);assert(f.suites[0].specs.every(s=>s.tests.length===20));check(f);f.suites[0].specs=f.suites[0].specs.flatMap(spec=>spec.tests.map(t=>({...spec,tests:[t]})));assert.equal(f.suites[0].specs.length,60);check(f);});
test('partial, flaky, skipped, duplicate-family or failed diagnostic reports are rejected',()=>{
 for(const mutate of [f=>f.config.projects[0].repeatEach=1,f=>f.config.projects[0].retries=1,f=>f.config.workers=2,f=>f.suites[0].specs[0].tests.pop(),f=>f.suites[0].specs[0].tests[0].results[0].retry=1,f=>f.suites[0].specs[0].tests[0].results[0].status='failed',f=>f.suites[0].specs[0].tests[0].results.push({status:'passed'}),f=>f.suites[0].specs[0].title='extra',f=>f.suites[0].specs[0].tests[0].results[0].workerIndex=f.suites[0].specs[0].tests[1].results[0].workerIndex,f=>f.stats.skipped=1,f=>f.stats.flaky=1,f=>f.suites[0].specs[0].file='other.spec.ts']){const f=fixture();mutate(f);assert.throws(()=>check(f));}
});
test('actual collector encrypts explicit failure data without source-gate or raw-output artifacts',t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'gui-diagnostic-test-')));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'source'));mkdirSync(join(root,'runtime'));writeFileSync(join(root,'runtime','reader-private-build.log'),'GENERATED_PRIVATE_LOG');writeFileSync(join(root,'runtime','hear-focused-results.json'),JSON.stringify(fixture()));
 const e=MANIFEST.examples.find(e=>e.id==='unknown'),value={head:e.head,base:e.base,tested:'c'.repeat(40),pr:e.pr,workflow:'d'.repeat(40)},env={...process.env,GITHUB_REPOSITORY:'lwtlab/reader',GITHUB_REF:'refs/heads/ci/selected-gui-diagnostic-20261113',GITHUB_SHA:value.workflow,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',VERIFICATION_BINDING:JSON.stringify(value),RUNNER_TEMP:join(root,'runtime'),GUI_DIAGNOSTIC_OUTCOME:'success'},cli=new URL('./gui-diagnostic.mjs',import.meta.url).pathname;
 const run=op=>spawnSync(process.execPath,[cli,op],{cwd:root,env,encoding:'utf8'});let r=run('collect');assert.equal(r.status,0,r.stdout+r.stderr);assert(!/GENERATED_PRIVATE_LOG|Error:|gui-diagnostic-test-/.test(r.stdout+r.stderr));assert.deepEqual(readdirSync(join(root,'gui-diagnostic-output')).sort(),['diagnostic.json','diagnostics.enc.json']);const file=join(root,'gui-diagnostic-output','diagnostic.json'),receipt=JSON.parse(readFileSync(file));assert.equal(receipt.status,'NOT_QUALIFIED');assert.equal(receipt.sourceIdentity,'FAIL');assert.equal(receipt.controls,'FAIL');assert(Object.values(receipt.acceptance).every(s=>s==='NOT_RUN'));assert.equal(run('require').status,1);receipt.controls='PASS';writeFileSync(file,JSON.stringify(receipt));assert.equal(run('require').status,1);
});
test('workflow isolates focused credentials, unchanged GUI interaction and encrypted diagnostics from gates',()=>{
 const yaml=readFileSync(new URL('../.github/workflows/reader-private-verify.yml',import.meta.url),'utf8'),focused=yaml.slice(yaml.indexOf('  resolve-gui-diagnostic:')),execution=focused.split('  focused-gui-diagnostic:')[1],source=readFileSync(new URL('./gui-diagnostic.mjs',import.meta.url),'utf8');
 assert.match(yaml,/inputs.scope != 'selected-gui-diagnostic'/);assert.match(focused,/repeat-each 20 --trace retain-on-failure/);assert(!focused.includes('force: true'));assert(!execution.includes('READER_VERIFICATION_TOKEN'));assert(!source.includes("'POST'"));assert(!source.includes('reader-hear-public/selected'));assert(!/path:.*test-results/.test(focused));assert.match(execution,/path: gui-diagnostic-output\/diagnostics.enc.json/);assert.match(execution,/node ci\/gui-diagnostic.mjs require/);
});
