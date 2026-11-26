import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/desktop-candidates.yml', import.meta.url), 'utf8');
const scalar = workflow.match(/^  build:\n[\s\S]*?^    timeout-minutes: (.+)$/m)?.[1];
function jobBudget(target) {
  if (/^\d+$/.test(scalar ?? '')) return Number(scalar);
  const selected = scalar?.match(/^\$\{\{ matrix\.id == 'darwin-x64' && (\d+) \|\| (\d+) \}\}$/);
  assert.ok(selected, 'Candidate job budget must remain explicit and bounded');
  return Number(selected[target === 'darwin-x64' ? 1 : 2]);
}

test('cold Intel prefix leaves time for offline validation, final privacy and upload', () => {
  // Native run 45777132115: successful setup/build/recovery took 74 minutes
  // before offline validation. Its 75-minute job budget cancelled that step,
  // so no privacy-checked candidate could be uploaded.
  const measuredPrefixMinutes = 74;
  const offline = workflow.match(/- name: Validate offline native reading and network restoration\n\s+timeout-minutes: (\d+)/)?.[1];
  assert.ok(offline, 'Offline validation must retain its own timeout');
  const finalPrivacyAndUploadMinutes = 8;
  assert.ok(jobBudget('darwin-x64') >= measuredPrefixMinutes + Number(offline) + finalPrivacyAndUploadMinutes,
    'Intel cold build exhausts its total job budget before the mandatory final gates');
});

test('other native targets and individual build/offline guards keep bounded budgets', () => {
  for (const target of ['darwin-arm64', 'win32-x64', 'linux-x64']) assert.equal(jobBudget(target), 75);
  assert.ok(jobBudget('darwin-x64') <= 105);
  assert.match(workflow, /- name: Build unsigned candidates without publishing\n\s+timeout-minutes: 40/);
  assert.match(workflow, /- name: Validate offline native reading and network restoration\n\s+timeout-minutes: 12/);
  const audit = workflow.indexOf('- name: Audit final candidate files before upload');
  const upload = workflow.indexOf('- name: Upload privacy-checked candidate artifacts only');
  assert.ok(audit > 0 && upload > audit, 'All candidates must still pass final privacy before upload');
});
