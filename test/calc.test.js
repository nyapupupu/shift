import test from 'node:test';
import assert from 'node:assert/strict';
import { shiftMinutes, shiftWage, payDateFor, rateFor, aggregate, paymentBreakdown } from '../calc.js';

const cafe = {
  id: 'w1', closingDay: 0, payMonthOffset: 1, payDay: 25, nightPremium: true,
  rates: [{ from: '2000-01-01', payType: 'hourly', amount: 1100 }, { from: '2026-04-01', payType: 'hourly', amount: 1200 }],
};

test('勤務時間と休憩', () => {
  assert.deepEqual(shiftMinutes({ start: '10:00', end: '15:00', breakMin: 60 }), { totalMin: 300, paidMin: 240, nightMin: 0 });
});

test('深夜時間（日付またぎ）', () => {
  assert.equal(shiftMinutes({ start: '20:00', end: '02:00', breakMin: 0 }).nightMin, 240);
  assert.equal(shiftMinutes({ start: '03:00', end: '07:00', breakMin: 0 }).nightMin, 120);
});

test('時給の改定は日付で切り替わる', () => {
  assert.equal(rateFor(cafe, '2026-03-31').amount, 1100);
  assert.equal(rateFor(cafe, '2026-04-01').amount, 1200);
  assert.equal(shiftWage({ date: '2026-03-31', start: '10:00', end: '15:00', breakMin: 60 }, cafe), 4400);
  assert.equal(shiftWage({ date: '2026-04-01', start: '10:00', end: '15:00', breakMin: 60 }, cafe), 4800);
});

test('深夜割増 25%', () => {
  // 1100*4 + 1100*0.25*2 = 4950
  assert.equal(shiftWage({ date: '2026-01-10', start: '18:00', end: '23:59', breakMin: 0 }, { ...cafe, rates: [{ from: '2000-01-01', payType: 'hourly', amount: 1200 }] }) > 0, true);
  assert.equal(shiftWage({ date: '2026-01-10', start: '20:00', end: '00:00', breakMin: 0 }, cafe), 4950);
});

test('日給（職場設定・シフト個別・単発）', () => {
  const daily = { ...cafe, rates: [{ from: '2000-01-01', payType: 'daily', amount: 8000 }] };
  assert.equal(shiftWage({ date: '2026-01-10', start: '09:00', end: '18:00' }, daily), 8000);
  assert.equal(shiftWage({ date: '2026-01-10', start: '09:00', end: '18:00', dailyOverride: 7000 }, cafe), 7000);
  assert.equal(shiftWage({ date: '2026-01-10', oneOff: { daily: 7000 } }, null), 7000);
});

test('締め日と給料日', () => {
  assert.equal(payDateFor({ date: '2026-01-31' }, cafe), '2026-02-25');
  const c15 = { ...cafe, closingDay: 15, payMonthOffset: 0, payDay: 0 };
  assert.equal(payDateFor({ date: '2026-02-15' }, c15), '2026-02-28');
  assert.equal(payDateFor({ date: '2026-02-16' }, c15), '2026-03-31');
  assert.equal(payDateFor({ date: '2026-12-20' }, cafe), '2027-01-25');
});

test('月別集計（給料日基準）', () => {
  const state = {
    workplaces: [cafe],
    shifts: [
      { id: 's1', workplaceId: 'w1', date: '2026-01-05', start: '10:00', end: '15:00', breakMin: 60, transport: 420 },
      { id: 's2', workplaceId: null, date: '2026-02-03', oneOff: { name: 'イベント', daily: 7000 }, transport: 600 },
    ],
    payments: [],
  };
  const agg = aggregate(state, 'pay');
  assert.deepEqual(agg['2026-02'].w1, { count: 1, minutes: 240, wage: 4400, transport: 420 });
  assert.equal(agg['2026-02'].oneoff.wage, 7000);
});

test('振込実績の内訳', () => {
  assert.deepEqual(paymentBreakdown({ amount: 50000, transport: 4000, deduction: 1500 }),
    { amount: 50000, transport: 4000, deduction: 1500, gross: 51500, wageGross: 47500 });
});
