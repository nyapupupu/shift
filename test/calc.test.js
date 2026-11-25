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
  assert.deepEqual(agg['2026-02'].w1, { count: 1, minutes: 240, wage: 4400, transport: 420, expense: 0 });
  assert.equal(agg['2026-02'].oneoff.wage, 7000);
});

test('振込実績の内訳', () => {
  assert.deepEqual(paymentBreakdown({ amount: 50000, transport: 4000, deduction: 1500 }),
    { amount: 50000, transport: 4000, deduction: 1500, gross: 51500, wageGross: 47500 });
});

test('土日祝の上乗せ（一番高いものを適用）', async () => {
  const { premiumFor } = await import('../calc.js');
  const wp = { ...cafe, nightPremium: false, premiums: [{ days: [0, 6], holiday: false, amount: 50 }, { days: [], holiday: true, amount: 100 }] };
  assert.equal(premiumFor(wp, '2026-11-25'), 0);   // 水曜
  assert.equal(premiumFor(wp, '2026-11-28'), 50);  // 土曜
  assert.equal(premiumFor(wp, '2026-11-23'), 100); // 勤労感謝の日（月）
  assert.equal(premiumFor(wp, '2026-05-03'), 100); // 日曜かつ祝日 → 高い方
  // 1200+50 で 4時間
  assert.equal(shiftWage({ date: '2026-11-28', start: '10:00', end: '14:00' }, wp), 5000);
});

test('この日だけ時給を変える', () => {
  const wp = { ...cafe, premiums: [{ days: [0, 6], holiday: true, amount: 50 }] };
  // 上乗せは無視して、指定の時給（深夜割増は適用）
  assert.equal(shiftWage({ date: '2026-11-28', start: '20:00', end: '23:00', hourlyOverride: 1500 }, wp), 1500 * 3 + 1500 * 0.25 * 1);
  // 日給設定の職場でも時給指定が優先
  const daily = { ...cafe, rates: [{ from: '2000-01-01', payType: 'daily', amount: 8000 }] };
  assert.equal(shiftWage({ date: '2026-11-25', start: '10:00', end: '12:00', hourlyOverride: 1500 }, daily), 3000);
});

test('業務委託とアルバイトの交通費・税金用まとめ', async () => {
  const { taxSummary, aggregate, shiftTransport } = await import('../calc.js');
  const job = { ...cafe, id: 'w1', premiums: [] };
  const consult = { id: 'w2', contractType: 'contractor', transportPaid: true, closingDay: 0, payMonthOffset: 1, payDay: 0, nightPremium: false,
    rates: [{ from: '2000-01-01', payType: 'daily', amount: 10000 }] };
  const consultSelf = { ...consult, id: 'w3', transportPaid: false };
  assert.deepEqual(shiftTransport({ transport: 500 }, job), { paid: 500, expense: 0 });
  assert.deepEqual(shiftTransport({ transport: 500 }, consult), { paid: 500, expense: 500 });
  assert.deepEqual(shiftTransport({ transport: 500 }, consultSelf), { paid: 0, expense: 500 });
  assert.deepEqual(shiftTransport({ transport: 300, oneOff: { contractType: 'contractor', transportPaid: false } }, null), { paid: 0, expense: 300 });

  const state = {
    workplaces: [job, consult, consultSelf],
    shifts: [
      { id: 'a', workplaceId: 'w1', date: '2026-12-10', start: '10:00', end: '14:00', transport: 400 }, // 給与：支給は2027/1
      { id: 'b', workplaceId: 'w2', date: '2026-12-10', transport: 600 },                               // 委託：2026年の収入
      { id: 'c', workplaceId: 'w3', date: '2026-11-10', transport: 800 },
      { id: 'd', workplaceId: null, date: '2026-11-20', oneOff: { name: '単発', daily: 7000, contractType: 'contractor', transportPaid: true }, transport: 200 },
    ],
    payments: [
      { month: '2026-12', source: 'w3', amount: 9000, transport: 0, deduction: 1021 },
      { month: '2026-12', source: 'oneoff-contract', amount: 6485, transport: 200, deduction: 715 },
    ],
  };
  assert.ok(aggregate(state, 'work')['2026-11']['oneoff-contract']);
  const t26 = taxSummary(state, 2026);
  assert.deepEqual(t26.employee.est, { wage: 0, transport: 0, expense: 0, count: 0 });
  assert.deepEqual(t26.contractor.est, { wage: 27000, transport: 800, expense: 1600, count: 3 });
  assert.deepEqual(t26.contractor.actual, { count: 2, amount: 15485, transport: 200, deduction: 1736, gross: 17221 });
  const t27 = taxSummary(state, 2027);
  assert.deepEqual(t27.employee.est, { wage: 4800, transport: 400, expense: 0, count: 1 }); // 2026/4から時給1,200円
});

test('週・月の労働時間', async () => {
  const { workMinutesBetween, weeksOfMonth } = await import('../calc.js');
  const w = weeksOfMonth(2026, 11); // 2026/11/1 は日曜
  assert.equal(w.length, 5);
  assert.deepEqual(w[0], { from: '2026-11-01', to: '2026-11-07' });
  assert.deepEqual(w[4], { from: '2026-11-29', to: '2026-12-05' });
  const w2 = weeksOfMonth(2026, 12); // 12/1 は火曜 → 11/29 から
  assert.deepEqual(w2[0], { from: '2026-11-29', to: '2026-12-05' });
  assert.deepEqual(w2.at(-1), { from: '2026-12-27', to: '2027-01-02' });
  const state = { workplaces: [cafe], shifts: [
    { id: 'a', workplaceId: 'w1', date: '2026-11-30', start: '10:00', end: '15:00', breakMin: 60 },
    { id: 'b', workplaceId: 'w1', date: '2026-12-01', start: '22:00', end: '02:00', breakMin: 0 },
    { id: 'c', workplaceId: null, date: '2026-12-03', oneOff: { daily: 7000 } },
  ], payments: [] };
  assert.deepEqual(workMinutesBetween(state, '2026-11-29', '2026-12-05'), { total: 480, count: 3, bySrc: { w1: 480, oneoff: 0 } });
  assert.equal(workMinutesBetween(state, '2026-12-01', '2026-12-31').total, 240);
});
