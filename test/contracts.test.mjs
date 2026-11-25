import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {upcast, EventStream} from '../dist/contracts.js';
const fixtures = readFileSync('fixtures/orders.jsonl','utf8').trim().split('\n').map(JSON.parse);
const copy = value => structuredClone(value);

test('legacy totals retain unknown line items and customer identity type', () => {
  const result = upcast(fixtures[0]);
  assert.equal(result.payload.items,null);
  assert.deepEqual(result.payload.customer,{kind:'email',value:'buyer@example.test'});
  assert.equal(result.payload.totalCents,1250);
});
test('v2 derives exact integer totals and preserves item order', () => {
  const result = upcast(fixtures[1]);
  assert.equal(result.payload.totalCents,2700);
  assert.deepEqual(result.payload.items,fixtures[1].payload.items);
});
test('canonicalization is idempotent and does not mutate input', () => {
  for (const source of fixtures) { const before = copy(source); const result = upcast(source); assert.deepEqual(upcast(result),result); assert.deepEqual(source,before); }
});
test('event replay is deduplicated by canonical value, conflicts rejected', () => {
  const stream = new EventStream(); const first = stream.accept(fixtures[0]);
  assert.equal(stream.accept(first),null);
  const conflict = copy(first); conflict.payload.totalCents++;
  assert.throws(() => stream.accept(conflict),/conflicting/);
});
test('safe integer arithmetic rejects product overflow and fractions', () => {
  const value = copy(fixtures[1]); value.payload.items[0].unitPriceCents = Number.MAX_SAFE_INTEGER;
  assert.throws(() => upcast(value),/safe integer range/);
  value.payload.items[0].quantity = 1.5;
  assert.throws(() => upcast(value),/safe integer/);
});
test('strict contracts reject unsupported versions, fields and impossible dates', () => {
  for (const edit of [x=>x.schemaVersion=4,x=>x.schemaVersion='1',x=>x.extra=true,x=>x.occurredAt='2026-02-30T00:00:00.000Z',x=>x.payload.currency='cad',x=>x.payload.totalCents=true]) {
    const value = copy(fixtures[0]); edit(value); assert.throws(() => upcast(value));
  }
});
test('canonical totals must reconcile to supplied items', () => {
  const value = upcast(fixtures[1]); value.payload.totalCents++;
  assert.throws(() => upcast(value),/does not match/);
});
test('ID capacity is bounded and duplicates do not consume another slot', () => {
  const stream = new EventStream(1);stream.accept(fixtures[0]);assert.equal(stream.accept(fixtures[0]),null);
  assert.throws(()=>stream.accept(fixtures[1]),/capacity/);
});
test('CLI emits two canonical rows and counts a replay', () => {
  const result = spawnSync(process.execPath,['dist/cli.js','fixtures/orders.jsonl'],{encoding:'utf8'});
  assert.equal(result.status,0);assert.equal(result.stdout.trim().split('\n').length,2);
  assert.deepEqual(JSON.parse(result.stderr),{read:3,emitted:2,duplicate:1,rejected:0});
});
test('CLI malformed file and missing file fail with diagnostics', () => {
  assert.equal(spawnSync(process.execPath,['dist/cli.js','fixtures/rejected.jsonl']).status,2);
  assert.equal(spawnSync(process.execPath,['dist/cli.js','does-not-exist.jsonl']).status,2);
  assert.equal(spawnSync(process.execPath,['dist/cli.js','--help']).status,0);
});
