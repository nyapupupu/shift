import test from 'node:test';
import assert from 'node:assert/strict';
import { holidaysOf, holidayName } from '../holidays.js';

test('2026年の祝日（内閣府公表と一致）', () => {
  assert.deepEqual(Object.keys(holidaysOf(2026)).sort(), [
    '2026-01-01', '2026-01-12', '2026-02-11', '2026-02-23', '2026-03-20', '2026-04-29',
    '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06', '2026-07-20', '2026-08-11',
    '2026-09-21', '2026-09-22', '2026-09-23', '2026-10-12', '2026-11-03', '2026-11-23',
  ]);
  assert.equal(holidayName('2026-05-06'), '振替休日');
  assert.equal(holidayName('2026-09-22'), '国民の休日');
});

test('2025年の振替休日', () => {
  for (const d of ['2025-02-24', '2025-05-06', '2025-11-24']) assert.equal(holidayName(d), '振替休日', d);
  assert.equal(holidayName('2025-03-20'), '春分の日');
  assert.equal(holidayName('2025-09-23'), '秋分の日');
});

test('2027年', () => {
  assert.deepEqual(Object.keys(holidaysOf(2027)).sort(), [
    '2027-01-01', '2027-01-11', '2027-02-11', '2027-02-23', '2027-03-21', '2027-03-22', '2027-04-29',
    '2027-05-03', '2027-05-04', '2027-05-05', '2027-07-19', '2027-08-11',
    '2027-09-20', '2027-09-23', '2027-10-11', '2027-11-03', '2027-11-23',
  ]);
});

test('平日は null', () => assert.equal(holidayName('2026-11-25'), null));
