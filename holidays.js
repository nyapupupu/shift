// 日本の祝日判定（「国民の祝日に関する法律」に基づく。振替休日・国民の休日を含む）
// 2000年以降を対象とする。春分・秋分は計算式による推定（2099年まで有効）。
// calc.js から読み込まれるため、循環しないよう他のファイルには依存しない
const pad = (n) => String(n).padStart(2, '0');
const parseYmd = (s) => s.split('-').map(Number);
const daysInMonth = (y, m) => new Date(y, m, 0).getDate();

const key = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const dow = (y, m, d) => new Date(y, m - 1, d).getDay();
/** m月の第n月曜日 */
const nthMonday = (y, m, n) => { const first = dow(y, m, 1); return 1 + ((8 - first) % 7) + (n - 1) * 7; };
const shiftYear = (y) => y - 1980;
const vernal = (y) => Math.floor(20.8431 + 0.242194 * shiftYear(y) - Math.floor(shiftYear(y) / 4));
const autumnal = (y) => Math.floor(23.2488 + 0.242194 * shiftYear(y) - Math.floor(shiftYear(y) / 4));

function baseHolidays(y) {
  const h = {};
  const add = (m, d, name) => { h[key(y, m, d)] = name; };
  add(1, 1, '元日');
  add(1, nthMonday(y, 1, 2), '成人の日');
  add(2, 11, '建国記念の日');
  if (y >= 2020) add(2, 23, '天皇誕生日');
  add(3, vernal(y), '春分の日');
  add(4, 29, y >= 2007 ? '昭和の日' : 'みどりの日');
  add(5, 3, '憲法記念日');
  if (y >= 2007) add(5, 4, 'みどりの日');
  add(5, 5, 'こどもの日');
  if (y === 2020) add(7, 23, '海の日');
  else if (y === 2021) add(7, 22, '海の日');
  else if (y >= 2003) add(7, nthMonday(y, 7, 3), '海の日');
  else add(7, 20, '海の日');
  if (y === 2020) add(8, 10, '山の日');
  else if (y === 2021) add(8, 8, '山の日');
  else if (y >= 2016) add(8, 11, '山の日');
  if (y >= 2003) add(9, nthMonday(y, 9, 3), '敬老の日'); else add(9, 15, '敬老の日');
  add(9, autumnal(y), '秋分の日');
  const sports = y >= 2020 ? 'スポーツの日' : '体育の日';
  if (y === 2020) add(7, 24, sports);
  else if (y === 2021) add(7, 23, sports);
  else add(10, nthMonday(y, 10, 2), sports);
  add(11, 3, '文化の日');
  add(11, 23, '勤労感謝の日');
  if (y <= 2018) add(12, 23, '天皇誕生日');
  if (y === 2019) { add(5, 1, '天皇の即位の日'); add(10, 22, '即位礼正殿の儀の行われる日'); }
  return h;
}

const cache = {};
/** その年の祝日一覧 { 'YYYY-MM-DD': 名前 } */
export function holidaysOf(y) {
  if (cache[y]) return cache[y];
  const base = baseHolidays(y);
  const all = { ...base };
  // 国民の休日：前日と翌日が祝日である平日
  for (let m = 1; m <= 12; m++) {
    for (let d = 1; d <= daysInMonth(y, m); d++) {
      const prev = new Date(y, m - 1, d - 1), next = new Date(y, m - 1, d + 1);
      const k = (dt) => key(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
      if (!all[key(y, m, d)] && base[k(prev)] && base[k(next)] && dow(y, m, d) !== 0) all[key(y, m, d)] = '国民の休日';
    }
  }
  // 振替休日：祝日が日曜日なら、その後の最初の祝日でない日
  for (const k of Object.keys(base)) {
    const [yy, mm, dd] = parseYmd(k);
    if (dow(yy, mm, dd) !== 0) continue;
    const t = new Date(yy, mm - 1, dd + 1);
    while (all[key(t.getFullYear(), t.getMonth() + 1, t.getDate())]) t.setDate(t.getDate() + 1);
    all[key(t.getFullYear(), t.getMonth() + 1, t.getDate())] = '振替休日';
  }
  return (cache[y] = all);
}

/** 祝日なら名前、そうでなければ null */
export function holidayName(date) {
  const y = parseYmd(date)[0];
  return holidaysOf(y)[date] || null;
}
