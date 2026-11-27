import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/desktop-candidates.yml', import.meta.url), 'utf8').replace(/\r\n/gu, '\n');
const jobScalar = workflow.match(/^  build:\n[\s\S]*?^    timeout-minutes: (.+)$/m)?.[1];
const buildScalar = workflow.match(/- name: Build unsigned candidates without publishing\n\s+timeout-minutes: (.+)/)?.[1];
function selectedBudget(scalar, target) {
  if (/^\d+$/.test(scalar ?? '')) return Number(scalar);
  const selected = scalar?.match(/^\$\{\{ matrix\.id == 'darwin-x64' && (\d+) \|\| (\d+) \}\}$/);
  assert.ok(selected, 'Candidate budgets must remain explicit and bounded');
  return Number(selected[target === 'darwin-x64' ? 1 : 2]);
}
const jobBudget = target => selectedBudget(jobScalar, target);
const buildBudget = target => selectedBudget(buildScalar, target);

test('cold Intel preparation and build leave measured post-build gates plus headroom', () => {
  // QA8 run 45967310951: preparation took 26m11s, then the 40-minute
  // build step timed out. No renderer/window QA ran in that attempt.
  // Successful B2 run 45944597379 needed 14m16s after its build.
  const observedPreparationSeconds = 26 * 60 + 11;
  const observedSuccessfulPostBuildSeconds = 14 * 60 + 16;
  const headroom = jobBudget('darwin-x64') * 60 - observedPreparationSeconds
    - buildBudget('darwin-x64') * 60 - observedSuccessfulPostBuildSeconds;
  assert.equal(headroom, 19 * 60 + 33,
    'Intel must retain room for all observed final gates after a full cold build');
});

for (const target of ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64']) {
  test(`${target}: only Intel receives the measured cold build and job allowance`, () => {
    assert.equal(jobBudget(target), target === 'darwin-x64' ? 120 : 75);
    assert.equal(buildBudget(target), target === 'darwin-x64' ? 60 : 40);
  });
}

test('individual QA guards and final privacy/upload ordering keep their original limits', () => {
  assert.match(workflow, /- name: Validate installed desktop window\n\s+timeout-minutes: 5/);
  assert.match(workflow, /- name: Validate Linux desktop window\n\s+timeout-minutes: 5/);
  assert.match(workflow, /- name: Install fixed Rust dependency scanner\n\s+timeout-minutes: 20/);
  assert.match(workflow, /- name: Validate offline native reading and network restoration\n\s+timeout-minutes: 12/);
  const audit = workflow.indexOf('- name: Audit final candidate files before upload');
  const upload = workflow.indexOf('- name: Upload privacy-checked candidate artifacts only');
  assert.ok(audit > 0 && upload > audit, 'All candidates must still pass final privacy before upload');
});
