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

export const ONEOFF = 'oneoff';                 // 単発（アルバイト）
export const ONEOFF_CONTRACT = 'oneoff-contract'; // 単発（業務委託）
export const EMPLOYEE = 'employee';
export const CONTRACTOR = 'contractor';

/** 契約の種類：アルバイト等（給与）か業務委託（報酬）か */
export const contractOf = (shift, wp) =>
  ((wp ? wp.contractType : shift.oneOff?.contractType) === CONTRACTOR ? CONTRACTOR : EMPLOYEE);

/** 集計の単位（バイト先のID、または単発の区分） */
export const sourceOf = (shift, wp) =>
  shift.workplaceId || (contractOf(shift, wp) === CONTRACTOR ? ONEOFF_CONTRACT : ONEOFF);

/** 集計単位の契約の種類 */
export function contractOfSource(state, src) {
  if (src === ONEOFF_CONTRACT) return CONTRACTOR;
  if (src === ONEOFF) return EMPLOYEE;
  return state.workplaces.find((w) => w.id === src)?.contractType === CONTRACTOR ? CONTRACTOR : EMPLOYEE;
}

/**
 * 1シフトの交通費の内訳
 * paid: 支払われる交通費（見込みの振込額に含める）
 * expense: 業務委託で経費になる交通費（実際にかかった額）
 * アルバイトは交通費＝通勤手当として扱い、paid に入れる（経費にはならない）。
 */
export function shiftTransport(shift, wp) {
  const t = Math.floor(Number(shift.transport) || 0);
  if (contractOf(shift, wp) === EMPLOYEE) return { paid: t, expense: 0 };
  const paidFlag = wp ? wp.transportPaid : shift.oneOff?.transportPaid;
  return { paid: paidFlag === false ? 0 : t, expense: t };
}

/**
 * 月ごとの見込みを集計する。basis: 'pay'（給料日基準）| 'work'（勤務日基準）
 * 戻り値: { 'YYYY-MM': { [sourceId]: {count, minutes, wage, transport, expense} } }
 * transport は支払われる交通費、expense は業務委託の経費になる交通費。
 */
export function aggregate(state, basis = 'pay') {
  const wpById = Object.fromEntries(state.workplaces.map((w) => [w.id, w]));
  const out = {};
  for (const sh of state.shifts) {
    const wp = sh.workplaceId ? wpById[sh.workplaceId] : null;
    if (sh.workplaceId && !wp) continue;
    const month = (basis === 'pay' ? payDateFor(sh, wp) : sh.date).slice(0, 7);
    const src = sourceOf(sh, wp);
    const bucket = ((out[month] ||= {})[src] ||= { count: 0, minutes: 0, wage: 0, transport: 0, expense: 0 });
    const tr = shiftTransport(sh, wp);
    bucket.count += 1;
    bucket.minutes += shiftMinutes(sh).paidMin;
    bucket.wage += shiftWage(sh, wp);
    bucket.transport += tr.paid;
    bucket.expense += tr.expense;
  }
  return out;
}

/**
 * 税金用の年間まとめ
 * - 給与（アルバイト等）：支給日の年で数える。交通費（通勤手当）は収入から分ける。
 * - 業務委託：見込みは仕事をした日の年で数える。支払われた交通費は収入、かかった交通費は経費。
 * - 実績（振込）はどちらも振り込まれた月の年で数える。
 */
export function taxSummary(state, year) {
  const y = String(year);
  const empty = () => ({ wage: 0, transport: 0, expense: 0, count: 0 });
  const emptyActual = () => ({ count: 0, amount: 0, transport: 0, deduction: 0, gross: 0 });
  const res = {
    employee: { est: empty(), actual: emptyActual() },
    contractor: { est: empty(), actual: emptyActual() },
  };
  const add = (t, e) => { t.wage += e.wage; t.transport += e.transport; t.expense += e.expense; t.count += e.count; };
  for (const [month, bySrc] of Object.entries(aggregate(state, 'pay'))) {
    if (!month.startsWith(y)) continue;
    for (const [src, e] of Object.entries(bySrc)) if (contractOfSource(state, src) === EMPLOYEE) add(res.employee.est, e);
  }
  for (const [month, bySrc] of Object.entries(aggregate(state, 'work'))) {
    if (!month.startsWith(y)) continue;
    for (const [src, e] of Object.entries(bySrc)) if (contractOfSource(state, src) === CONTRACTOR) add(res.contractor.est, e);
  }
  for (const p of state.payments) {
    if (!p.month.startsWith(y)) continue;
    const b = paymentBreakdown(p);
    const a = res[contractOfSource(state, p.source)].actual;
    a.count += 1; a.amount += b.amount; a.transport += b.transport; a.deduction += b.deduction; a.gross += b.gross;
  }
  return res;
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
