// 給料計算ロジック（DOMに依存しない純粋関数。node:test からもテストする）
import { holidayName } from './holidays.js';

export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
export const ym = (y, m) => `${y}-${pad(m)}`;
export const parseYmd = (s) => s.split('-').map(Number);
export const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
export const addMonths = (y, m, n) => {
  const t = y * 12 + (m - 1) + n;
  return [Math.floor(t / 12), (t % 12) + 1];
};
export const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** その日に有効な給与設定（rates は {from, payType, amount}） */
export function rateFor(wp, date) {
  const list = [...(wp.rates || [])].sort((a, b) => a.from.localeCompare(b.from));
  let cur = list[0] || null;
  for (const r of list) if (r.from <= date) cur = r;
  return cur;
}

/** 勤務時間（分）と深夜（22:00〜翌5:00）時間（分） */
export function shiftMinutes(shift) {
  if (!shift.start || !shift.end) return { totalMin: 0, paidMin: 0, nightMin: 0 };
  const s = toMin(shift.start);
  let e = toMin(shift.end);
  if (e <= s) e += 1440; // 日付をまたぐ勤務
  const totalMin = e - s;
  const breakMin = Math.max(0, Number(shift.breakMin) || 0);
  const paidMin = Math.max(0, totalMin - breakMin);
  let night = 0;
  for (let base = -1440; base <= 1440; base += 1440) {
    // 前日22:00〜当日5:00 の帯を順にずらして重なりを数える
    const ns = base + 1320, ne = base + 1740;
    night += Math.max(0, Math.min(e, ne) - Math.max(s, ns));
  }
  // 休憩は深夜帯以外で取ったものとみなし、深夜時間は支払対象時間を超えない
  const nightMin = Math.min(night, paidMin);
  return { totalMin, paidMin, nightMin };
}

/** その日の時給の上乗せ額（曜日・祝日の設定のうち、当てはまる中で一番高いもの） */
export function premiumFor(wp, date) {
  const [y, m, d] = parseYmd(date);
  const dow = new Date(y, m - 1, d).getDay();
  const holiday = !!holidayName(date);
  let best = 0;
  for (const r of wp?.premiums || []) {
    if ((r.days || []).includes(dow) || (r.holiday && holiday)) best = Math.max(best, Number(r.amount) || 0);
  }
  return best;
}

const isSet = (v) => v != null && v !== '';

/**
 * そのシフトの給与の決まり方
 * { kind: 'daily', daily, why } または { kind: 'hourly', base, premium, hourly, why }
 * why: 'oneoff' | 'shiftDaily' | 'shiftHourly' | 'workplace'
 */
export function payBasis(shift, wp) {
  if (isSet(shift.dailyOverride)) return { kind: 'daily', daily: Number(shift.dailyOverride), why: 'shiftDaily' };
  if (!wp) return { kind: 'daily', daily: Number(shift.oneOff?.daily) || 0, why: 'oneoff' };
  if (isSet(shift.hourlyOverride)) {
    const h = Number(shift.hourlyOverride);
    return { kind: 'hourly', base: h, premium: 0, hourly: h, why: 'shiftHourly' };
  }
  const rate = rateFor(wp, shift.date);
  if (!rate) return { kind: 'daily', daily: 0, why: 'workplace' };
  if (rate.payType === 'daily') return { kind: 'daily', daily: Number(rate.amount) || 0, why: 'workplace' };
  const base = Number(rate.amount) || 0;
  const premium = premiumFor(wp, shift.date);
  return { kind: 'hourly', base, premium, hourly: base + premium, why: 'workplace' };
}

/** 1シフトの見込み給与（交通費は含まない） */
export function shiftWage(shift, wp) {
  const b = payBasis(shift, wp);
  if (b.kind === 'daily') return Math.floor(b.daily);
  const { paidMin, nightMin } = shiftMinutes(shift);
  const night = wp?.nightPremium ? b.hourly * 0.25 * nightMin / 60 : 0;
  return Math.floor(b.hourly * paidMin / 60 + night);
}

/** 給料日の年月 'YYYY-MM'。closingDay: 0=末日, payDay: 0=末日, payMonthOffset: 締めた月から何か月後に支払うか */
export function payDateFor(shift, wp) {
  if (!wp) return shift.oneOff?.payDate || shift.date;
  const [y, m, d] = parseYmd(shift.date);
  const c = Number(wp.closingDay) || 0;
  let [cy, cm] = [y, m];
  if (c !== 0 && d > c) [cy, cm] = addMonths(y, m, 1);
  const [py, pm] = addMonths(cy, cm, Number(wp.payMonthOffset ?? 1));
  const p = Number(wp.payDay) || 0;
  const pd = p === 0 ? daysInMonth(py, pm) : Math.min(p, daysInMonth(py, pm));
  return ymd(py, pm, pd);
}

export const ONEOFF = 'oneoff';
export const sourceOf = (shift) => shift.workplaceId || ONEOFF;

/**
 * 月ごとの見込みを集計する。basis: 'pay'（給料日基準）| 'work'（勤務日基準）
 * 戻り値: { 'YYYY-MM': { [sourceId]: {count, minutes, wage, transport} } }
 */
export function aggregate(state, basis = 'pay') {
  const wpById = Object.fromEntries(state.workplaces.map((w) => [w.id, w]));
  const out = {};
  for (const sh of state.shifts) {
    const wp = sh.workplaceId ? wpById[sh.workplaceId] : null;
    if (sh.workplaceId && !wp) continue;
    const month = (basis === 'pay' ? payDateFor(sh, wp) : sh.date).slice(0, 7);
    const src = sourceOf(sh);
    const bucket = ((out[month] ||= {})[src] ||= { count: 0, minutes: 0, wage: 0, transport: 0 });
    bucket.count += 1;
    bucket.minutes += shiftMinutes(sh).paidMin;
    bucket.wage += shiftWage(sh, wp);
    bucket.transport += Math.floor(Number(sh.transport) || 0);
  }
  return out;
}

/** 実績（振込）の集計: { 'YYYY-MM': { [sourceId]: payment } } */
export function paymentsByMonth(state) {
  const out = {};
  for (const p of state.payments) (out[p.month] ||= {})[p.source] = p;
  return out;
}

/** 振込実績1件から 総支給・給与部分を出す */
export function paymentBreakdown(p) {
  const amount = Number(p.amount) || 0;       // 振込額（手取り）
  const transport = Number(p.transport) || 0; // うち交通費
  const deduction = Number(p.deduction) || 0; // 源泉所得税などの控除額（任意）
  const gross = amount + deduction;            // 総支給額（交通費込み）
  return { amount, transport, deduction, gross, wageGross: gross - transport };
}
