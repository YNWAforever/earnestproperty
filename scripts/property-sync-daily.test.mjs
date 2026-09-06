import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const path = new URL('../.github/workflows/property-sync-daily.yml', import.meta.url);
test('daily workflow is gated, serialized, immutable and narrowly scoped', () => {
  const y = readFileSync(path,'utf8');
  for (const value of ['17 18 * * *','cancel-in-progress: false','PROPERTY_SYNC_DAILY_ENABLED','PROPERTY_SYNC_POLICY_APPROVED','PROPERTY_SYNC_EXPECTED_BRANCH','python-version: "3.14"','node-version: "22"','--dry-run','replay_28hse_sync.py','retention-days: 7','retention-days: 90','if: always()','--apply','agent:540']) assert.ok(y.includes(value),value);
  assert.equal((y.match(/secrets\.DATABASE_URL_UNPOOLED/g)||[]).length,1);
  assert.ok(!/npm run build|playwright|wrangler|migrate|send-message/.test(y));
  assert.ok(y.indexOf('Collect without database access') < y.indexOf('secrets.DATABASE_URL_UNPOOLED'));
});


test('database credential exists only on the gated apply step', async () => {
  const {createRequire} = await import('node:module');
  const require = createRequire(import.meta.url);
  const workflow = require('js-yaml').load(readFileSync(path,'utf8'));
  assert.equal(workflow.concurrency.group, 'property-sync-agent-540');
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.match(workflow.jobs.daily.if, /PROPERTY_SYNC_DAILY_ENABLED == 'true'/);
  const steps = workflow.jobs.daily.steps;
  const apply = steps.filter(step => step.env?.DATABASE_URL_UNPOOLED);
  assert.equal(apply.length, 1);
  assert.equal(apply[0].if, "endsWith(env.MODE, 'apply')");
  assert.match(apply[0].run, /replay_28hse_sync\.py --payload "\$PAYLOAD" --root daily-output --apply/);
  const pinIndex = steps.findIndex(step => step.name === 'Pin immutable request before database access');
  assert.ok(pinIndex < steps.indexOf(apply[0]));
  assert.ok(!workflow.env?.DATABASE_URL_UNPOOLED);
  assert.ok(!workflow.jobs.daily.env.DATABASE_URL_UNPOOLED);
  assert.equal(steps.find(step => step.name === 'Pin unresolved evidence independently of artifact expiry').if, 'failure()');
  assert.match(steps.find(step => step.name === 'Restore last accepted full baseline').run, /daily_artifacts.py unpack/);
});
