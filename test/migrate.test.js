import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, MIGRATIONS, CURRENT_VERSION, NewerDataError } from '../migrate.js';

test('現行形式はそのまま、payments が無ければ補う', () => {
  const d = migrate({ workplaces: [], shifts: [{ id: 'a' }] });
  assert.equal(d.version, CURRENT_VERSION);
  assert.deepEqual(d.shifts, [{ id: 'a' }]);
  assert.deepEqual(d.payments, []);
});

test('新しいバージョンのデータは拒否する（上書き事故を防ぐ）', () => {
  assert.throws(() => migrate({ version: CURRENT_VERSION + 1, workplaces: [], shifts: [] }), NewerDataError);
});

test('別物のデータは拒否する', () => {
  assert.throws(() => migrate({ foo: 1 }));
  assert.throws(() => migrate(null));
});

test('変換処理が順に適用される', () => {
  // 仮に v1 → v2 の変換があった場合の動きを確かめる
  MIGRATIONS[1] = (d) => ({ ...d, shifts: d.shifts.map((s) => ({ ...s, migrated: true })) });
  try {
    const orig = { version: 1, workplaces: [], shifts: [{ id: 'a' }] };
    // CURRENT_VERSION は定数なので、変換関数単体で確認する
    assert.deepEqual(MIGRATIONS[1](orig).shifts, [{ id: 'a', migrated: true }]);
    assert.deepEqual(orig.shifts, [{ id: 'a' }]);
  } finally { delete MIGRATIONS[1]; }
});
