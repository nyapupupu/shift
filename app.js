import {
  pad, ymd, ym, parseYmd, daysInMonth, addMonths, rateFor, shiftMinutes, shiftWage, payDateFor,
  aggregate, paymentsByMonth, paymentBreakdown, ONEOFF, payBasis,
  ONEOFF_CONTRACT, CONTRACTOR, contractOf, contractOfSource, shiftTransport, taxSummary,
} from './calc.js';
import { holidayName } from './holidays.js';
import { migrate, NewerDataError, CURRENT_VERSION } from './migrate.js';
import { shiftsToIcs } from './ics.js';

/* ========== データ ========== */
const KEY = 'shiftpay.v1';
const COLORS = ['#22a06b', '#2f6fed', '#f08c00', '#e5484d', '#8e4ec6', '#12a5b8', '#d6409f', '#7a5a3a', '#5b6b7f'];
const ONEOFF_COLOR = '#8a94a6';

// 保存場所の名前。データを引き継ぐため、この値は今後も変えないこと（形式の変更は migrate.js で行う）
let loadProblem = null; // 読み込めなかったときの情報 { kind: 'newer' | 'broken', message }

function load() {
  const fresh = { version: CURRENT_VERSION, workplaces: [], shifts: [], payments: [] };
  const raw = localStorage.getItem(KEY);
  if (raw == null) return fresh;
  try {
    const parsed = JSON.parse(raw);
    const d = migrate(parsed);
    if ((Number(parsed.version) || 1) !== d.version) {
      localStorage.setItem(`shiftpay.before-v${d.version}`, raw); // 変換前の控え
      localStorage.setItem(KEY, JSON.stringify(d));
    }
    return d;
  } catch (err) {
    if (err instanceof NewerDataError) {
      // 古いプログラムが新しい形式のデータを上書きしないよう、保存を止める
      loadProblem = { kind: 'newer', message: err.message };
    } else {
      // 読めなかったデータは消さずに別の場所へ退避する
      localStorage.setItem('shiftpay.unreadable', raw);
      loadProblem = { kind: 'broken', message: err.message };
    }
    return fresh;
  }
}
let state = load();
function save() {
  if (loadProblem?.kind === 'newer') { alert('アプリが古いまま開かれているため、保存できません。ページを再読み込みしてください。'); return; }
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (err) { alert('保存できませんでした：' + err.message); }
}
// 端末の容量が少なくなったときなどに、ブラウザがデータを消さないよう頼む
navigator.storage?.persist?.().catch(() => {});
const LAST_BACKUP = 'shiftpay.lastBackup';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ========== ユーティリティ ========== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const yen = (n) => '¥' + Math.round(Number(n) || 0).toLocaleString('ja-JP');
const hm = (min) => `${Math.floor(min / 60)}時間${min % 60 ? pad(min % 60) + '分' : ''}`;
const today = () => { const d = new Date(); return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
const DOW = ['日', '月', '火', '水', '木', '金', '土'];
const dowOf = (date) => { const [y, m, d] = parseYmd(date); return new Date(y, m - 1, d).getDay(); };
const fmtDate = (date) => { const [, m, d] = parseYmd(date); return `${m}/${d}(${DOW[dowOf(date)]})`; };
const PREMIUM_DAYS = ['日', '月', '火', '水', '木', '金', '土'];
/** 上乗せ設定の説明（例：土日祝 +¥50/時） */
const premiumText = (r) => `${[...(r.days || []).slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => PREMIUM_DAYS[d]), r.holiday ? '祝' : ''].join('') || '（曜日未選択）'} +${yen(r.amount)}/時`;
/** 時給・日給の内訳の説明 */
function basisText(b) {
  if (b.kind === 'daily') return { oneoff: '日給', shiftDaily: '日給（この日だけ）', workplace: '日給' }[b.why] + ' ' + yen(b.daily);
  if (b.why === 'shiftHourly') return `時給 ${yen(b.hourly)}（この日だけ）`;
  return b.premium ? `時給 ${yen(b.base)} ＋ 上乗せ ${yen(b.premium)}` : `時給 ${yen(b.base)}`;
}
const wpById = (id) => state.workplaces.find((w) => w.id === id);
const sourceName = (src) => (src === ONEOFF ? '単発' : src === ONEOFF_CONTRACT ? '単発（業務委託）' : wpById(src)?.name ?? '(削除済み)');
const sourceColor = (src) => (src === ONEOFF || src === ONEOFF_CONTRACT ? ONEOFF_COLOR : wpById(src)?.color ?? ONEOFF_COLOR);
const isContractSrc = (src) => contractOfSource(state, src) === CONTRACTOR;
const contractTag = (isContract) => (isContract ? ' <span class="tag ct">業務委託</span>' : '');
const shiftColor = (sh) => (sh.workplaceId ? wpById(sh.workplaceId)?.color : sh.oneOff?.color) || ONEOFF_COLOR;
const shiftName = (sh) => (sh.workplaceId ? wpById(sh.workplaceId)?.name : sh.oneOff?.name || '単発');
const num = (v) => (v === '' || v == null ? 0 : Number(v));

/* ========== 画面状態 ========== */
const now = new Date();
const ui = {
  tab: 'calendar',
  calY: now.getFullYear(), calM: now.getMonth() + 1, sel: today(),
  monY: now.getFullYear(), monM: now.getMonth() + 1,
  year: now.getFullYear(),
  basis: localStorage.getItem('shiftpay.basis') || 'pay',
};
const TITLES = { calendar: 'カレンダー', month: '月収', year: '年収', settings: '設定' };

function render() {
  $('#title').textContent = TITLES[ui.tab];
  $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
  const view = $('#view');
  view.innerHTML = banners() + { calendar: viewCalendar, month: viewMonth, year: viewYear, settings: viewSettings }[ui.tab]();
  bindView(view);
}

/* ========== カレンダー ========== */
function viewCalendar() {
  const { calY: y, calM: m } = ui;
  const first = new Date(y, m - 1, 1).getDay();
  const [py, pm] = addMonths(y, m, -1);
  const cells = [];
  for (let i = 0; i < first; i++) cells.push(ymd(py, pm, daysInMonth(py, pm) - first + 1 + i));
  for (let d = 1; d <= daysInMonth(y, m); d++) cells.push(ymd(y, m, d));
  const [ny, nm] = addMonths(y, m, 1);
  for (let d = 1; cells.length % 7; d++) cells.push(ymd(ny, nm, d));

  const byDate = {};
  for (const sh of state.shifts) (byDate[sh.date] ||= []).push(sh);
  for (const k in byDate) byDate[k].sort((a, b) => (a.start || '').localeCompare(b.start || ''));

  // 勤務日基準でのこの月の見込み
  let wage = 0, transport = 0, count = 0, minutes = 0;
  for (const sh of state.shifts) {
    if (!sh.date.startsWith(ym(y, m))) continue;
    const wp = sh.workplaceId ? wpById(sh.workplaceId) : null;
    if (sh.workplaceId && !wp) continue;
    wage += shiftWage(sh, wp); transport += shiftTransport(sh, wp).paid; count++; minutes += shiftMinutes(sh).paidMin;
  }

  const t = today();
  const daysHtml = cells.map((date) => {
    const dw = dowOf(date);
    const cls = ['day', date.slice(0, 7) !== ym(y, m) && 'other', date === t && 'today', date === ui.sel && 'sel', (dw === 0 || holidayName(date)) && 'sun', dw === 6 && !holidayName(date) && 'sat'].filter(Boolean).join(' ');
    const dots = (byDate[date] || []).map((sh) => `<i class="dot" style="background:${shiftColor(sh)}"></i>`).join('');
    return `<button class="${cls}" data-date="${date}"><span class="d">${parseYmd(date)[2]}</span><span class="dots">${dots}</span></button>`;
  }).join('');

  const legendItems = state.workplaces.map((w) => `<span><i class="dot" style="background:${w.color}"></i>${esc(w.name)}</span>`);
  if (state.shifts.some((s) => !s.workplaceId)) legendItems.push(`<span><i class="dot" style="background:${ONEOFF_COLOR}"></i>単発</span>`);

  const dayShifts = byDate[ui.sel] || [];
  const list = dayShifts.length ? dayShifts.map(shiftItemHtml).join('') : '<div class="empty">シフトはありません</div>';

  return `
    <div class="monthnav">
      <button class="iconbtn" data-act="cal-prev">‹</button>
      <button class="label" data-act="cal-today" style="border:0;background:none;cursor:pointer">${y}年${m}月</button>
      <button class="iconbtn" data-act="cal-next">›</button>
    </div>
    <div class="cal">
      ${DOW.map((d, i) => `<div class="dow ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${d}</div>`).join('')}
      ${daysHtml}
    </div>
    <div class="legend">${legendItems.join('')}</div>
    <div class="card">
      ${!state.workplaces.length && !state.shifts.length ? `<div class="banner" style="margin:0 0 10px;padding:10px;border:1px solid var(--accent);border-radius:10px">
        <div class="small" style="margin-bottom:6px">以前のデータがある場合は、バックアップから戻せます。</div>
        <button class="btn sm sub block" data-act="import">バックアップから復元</button></div>` : ''}
      <div class="row between"><h2>${fmtDate(ui.sel)}${holidayName(ui.sel) ? ` <span class="small danger">${holidayName(ui.sel)}</span>` : ''}</h2><button class="btn sm sub" data-act="add-shift">＋ シフト追加</button></div>
      ${list}
    </div>
    <div class="card">
      <h2>${m}月に働いた分の見込み <span class="muted small">（勤務日ベース）</span></h2>
      <div class="stat-grid">
        <div class="stat"><div class="k">給与</div><div class="v">${yen(wage)}</div></div>
        <div class="stat"><div class="k">交通費</div><div class="v">${yen(transport)}</div></div>
      </div>
      <div class="muted small" style="margin-top:6px">${count}回・${hm(minutes)}　合計 ${yen(wage + transport)}</div>
      <button class="btn sm ghost block" data-act="ics-month" style="margin-top:10px" ${count ? '' : 'disabled'}>📆 ${m}月のシフトを Apple カレンダーに追加</button>
    </div>
    <button class="fab" data-act="add-shift" aria-label="シフト追加">＋</button>`;
}

function shiftItemHtml(sh) {
  const wp = sh.workplaceId ? wpById(sh.workplaceId) : null;
  const time = sh.start && sh.end ? `${sh.start}〜${sh.end}` : '時間指定なし';
  const { paidMin } = shiftMinutes(sh);
  const b = payBasis(sh, wp);
  const tag = b.kind === 'daily' ? '日給' : b.why === 'shiftHourly' ? `時給${yen(b.hourly)}` : b.premium ? `+${yen(b.premium)}` : '';
  return `<div class="shift-item" data-shift="${sh.id}">
    <span class="bar" style="background:${shiftColor(sh)}"></span>
    <div class="grow">
      <div><b>${esc(shiftName(sh))}</b> ${tag ? `<span class="tag">${tag}</span>` : ''}</div>
      <div class="muted small">${time}${paidMin ? `（${hm(paidMin)}${sh.breakMin ? `・休憩${sh.breakMin}分` : ''}）` : ''}${sh.memo ? '　' + esc(sh.memo) : ''}</div>
    </div>
    <div class="num"><div>${yen(shiftWage(sh, wp))}</div><div class="muted small">交通費 ${yen(sh.transport)}</div></div>
  </div>`;
}

/* ========== 月収 ========== */
function basisSeg() {
  return `<div class="seg">
    <button data-basis="pay" class="${ui.basis === 'pay' ? 'on' : ''}">給料日ベース</button>
    <button data-basis="work" class="${ui.basis === 'work' ? 'on' : ''}">勤務日ベース</button>
  </div>`;
}

function viewMonth() {
  const { monY: y, monM: m } = ui;
  const key = ym(y, m);
  const est = aggregate(state, ui.basis)[key] || {};
  const pays = paymentsByMonth(state)[key] || {};
  const sources = [...new Set([...state.workplaces.map((w) => w.id), ...Object.keys(est), ...Object.keys(pays)])]
    .filter((s) => est[s] || pays[s] || (s !== ONEOFF && s !== ONEOFF_CONTRACT && wpById(s)));

  let eW = 0, eT = 0, aAmt = 0, aT = 0;
  const cards = sources.map((src) => {
    const e = est[src] || { count: 0, minutes: 0, wage: 0, transport: 0, expense: 0 };
    const ct = isContractSrc(src);
    const W = ct ? '報酬' : '給与';
    const p = pays[src];
    eW += e.wage; eT += e.transport;
    let actual = '';
    if (p) {
      const b = paymentBreakdown(p);
      aAmt += b.amount; aT += b.transport;
      actual = `
        <div class="sep"></div>
        <div class="row between"><span class="tag done">振込済み${p.date ? ' ' + fmtDate(p.date) : ''}</span><button class="btn sm ghost" data-act="edit-pay" data-src="${src}">編集</button></div>
        <div class="kv"><span class="k">振込額</span><b class="num">${yen(b.amount)}</b></div>
        <div class="kv"><span class="k">　うち交通費</span><span class="num">${yen(b.transport)}</span></div>
        <div class="kv"><span class="k">　うち${W}</span><span class="num">${yen(b.amount - b.transport)}</span></div>
        ${b.deduction ? `<div class="kv"><span class="k">${ct ? '源泉徴収税額' : '控除（源泉税など）'}</span><span class="num">${yen(b.deduction)}</span></div>` : ''}`;
    } else if (ui.basis === 'pay') {
      actual = `<div class="sep"></div><button class="btn sm sub block" data-act="edit-pay" data-src="${src}">振り込まれた金額を入力</button>`;
    }
    return `<div class="card">
      <div class="row"><i class="dot lg" style="background:${sourceColor(src)}"></i><h2 class="grow" style="margin:0">${esc(sourceName(src))}${contractTag(ct)}</h2><span class="muted small">${e.count}回・${hm(e.minutes)}</span></div>
      <div class="kv" style="margin-top:6px"><span class="k">見込み ${W}</span><span class="num">${yen(e.wage)}</span></div>
      <div class="kv"><span class="k">見込み 交通費${ct ? '（支払われる分）' : ''}</span><span class="num">${yen(e.transport)}</span></div>
      <div class="kv"><span class="k">見込み 合計</span><b class="num">${yen(e.wage + e.transport)}</b></div>
      ${ct ? `<div class="kv"><span class="k">経費になる交通費</span><span class="num">${yen(e.expense)}</span></div>` : ''}
      ${actual}
    </div>`;
  }).join('');

  const hasActual = Object.keys(pays).length > 0;
  return `
    <div class="monthnav">
      <button class="iconbtn" data-act="mon-prev">‹</button>
      <span class="label">${y}年${m}月</span>
      <button class="iconbtn" data-act="mon-next">›</button>
    </div>
    <div style="text-align:center;margin-bottom:10px">${basisSeg()}</div>
    <div class="card">
      <h2>${m}月の${ui.basis === 'pay' ? '支給' : '勤務'}分</h2>
      <div class="stat-grid">
        <div class="stat"><div class="k">見込み（給与・報酬＋交通費）</div><div class="v">${yen(eW + eT)}</div><div class="muted small">うち交通費 ${yen(eT)}</div></div>
        <div class="stat"><div class="k">実際の振込</div><div class="v">${hasActual ? yen(aAmt) : '—'}</div><div class="muted small">${hasActual ? 'うち交通費 ' + yen(aT) : '未入力'}</div></div>
      </div>
      <p class="note">${ui.basis === 'pay'
        ? '給料日ベース：各バイトの締め日・給料日の設定から、この月に振り込まれる分を集計しています。'
        : '勤務日ベース：この月に働いた分を集計しています（振込実績の入力は給料日ベースで行います）。'}</p>
    </div>
    ${cards || '<div class="card empty">設定タブからバイト先を登録するか、カレンダーからシフトを追加してください。</div>'}`;
}

/* ========== 年収 ========== */
function viewYear() {
  const y = ui.year;
  const agg = aggregate(state, ui.basis);
  const pays = paymentsByMonth(state);
  const rows = [];
  const tot = { eW: 0, eT: 0, amt: 0, aT: 0, ded: 0, gross: 0 };
  // 交通費の内訳（emp: アルバイト等の通勤手当、con: 業務委託で支払われた交通費）
  const split = { eTemp: 0, eTcon: 0, aTemp: 0, aTcon: 0 };
  const perSrc = {};
  for (let m = 1; m <= 12; m++) {
    const key = ym(y, m);
    let eW = 0, eT = 0, amt = 0, aT = 0, ded = 0, gross = 0, has = false;
    for (const [src, e] of Object.entries(agg[key] || {})) {
      eW += e.wage; eT += e.transport;
      if (isContractSrc(src)) split.eTcon += e.transport; else split.eTemp += e.transport;
      const ps = (perSrc[src] ||= { eW: 0, eT: 0, amt: 0, aT: 0, ded: 0, gross: 0 });
      ps.eW += e.wage; ps.eT += e.transport;
    }
    if (ui.basis === 'pay') {
      for (const [src, p] of Object.entries(pays[key] || {})) {
        const b = paymentBreakdown(p); has = true;
        amt += b.amount; aT += b.transport; ded += b.deduction; gross += b.gross;
        if (isContractSrc(src)) split.aTcon += b.transport; else split.aTemp += b.transport;
        const ps = (perSrc[src] ||= { eW: 0, eT: 0, amt: 0, aT: 0, ded: 0, gross: 0 });
        ps.amt += b.amount; ps.aT += b.transport; ps.ded += b.deduction; ps.gross += b.gross;
      }
    }
    Object.assign(tot, { eW: tot.eW + eW, eT: tot.eT + eT, amt: tot.amt + amt, aT: tot.aT + aT, ded: tot.ded + ded, gross: tot.gross + gross });
    rows.push({ m, eW, eT, amt, aT, has });
  }
  const showActual = ui.basis === 'pay';
  const tax = taxSummary(state, y);
  const hasEmp = tax.employee.est.count || tax.employee.actual.count;
  const hasCon = tax.contractor.est.count || tax.contractor.actual.count;
  const ea = tax.employee.actual, ca = tax.contractor.actual, ee = tax.employee.est, ce = tax.contractor.est;
  const taxCard = (hasEmp || hasCon) ? `
    <div class="card">
      <h2>${y}年 税金用のまとめ</h2>
      ${hasEmp ? `
      <div class="subhead">アルバイト・パート（給与）<span class="muted small">　給料日ベース</span></div>
      <div class="kv"><span class="k">見込み 給与（交通費を除く）</span><b class="num">${yen(ee.wage)}</b></div>
      <div class="kv"><span class="k">見込み 交通費（通勤手当・非課税）</span><span class="num">${yen(ee.transport)}</span></div>
      ${ea.count ? `
      <div class="kv"><span class="k">実績 総支給から交通費を除いた額</span><b class="num">${yen(ea.gross - ea.transport)}</b></div>
      <div class="kv"><span class="k">実績 交通費（通勤手当）</span><span class="num">${yen(ea.transport)}</span></div>
      <div class="kv"><span class="k">実績 控除（源泉所得税など）</span><span class="num">${yen(ea.deduction)}</span></div>` : ''}` : ''}
      ${hasEmp && hasCon ? '<div class="sep"></div>' : ''}
      ${hasCon ? `
      <div class="subhead">業務委託（報酬）<span class="muted small">　仕事をした日ベース</span></div>
      <div class="kv"><span class="k">見込み 報酬</span><span class="num">${yen(ce.wage)}</span></div>
      <div class="kv"><span class="k">見込み 支払われる交通費（収入に含む）</span><span class="num">${yen(ce.transport)}</span></div>
      <div class="kv"><span class="k">見込み 収入の合計</span><b class="num">${yen(ce.wage + ce.transport)}</b></div>
      <div class="kv"><span class="k">経費：交通費</span><b class="num">${yen(ce.expense)}</b></div>
      <div class="kv"><span class="k">収入 − 交通費</span><span class="num">${yen(ce.wage + ce.transport - ce.expense)}</span></div>
      ${ca.count ? `
      <div class="small muted" style="margin-top:6px">この年に振り込まれた分（実績）</div>
      <div class="kv"><span class="k">振込額</span><span class="num">${yen(ca.amount)}</span></div>
      <div class="kv"><span class="k">　うち交通費</span><span class="num">${yen(ca.transport)}</span></div>
      <div class="kv"><span class="k">源泉徴収税額</span><span class="num">${yen(ca.deduction)}</span></div>
      <div class="kv"><span class="k">支払金額（振込額＋源泉徴収税額）</span><span class="num">${yen(ca.gross)}</span></div>` : ''}` : ''}
    </div>` : '';
  const monthRows = rows.map((r) => `<tr>
      <td>${r.m}月</td><td class="num">${yen(r.eW)}</td><td class="num">${yen(r.eT)}</td>
      ${showActual ? `<td class="num">${r.has ? yen(r.amt) : '<span class="muted">—</span>'}</td><td class="num">${r.has ? yen(r.aT) : '<span class="muted">—</span>'}</td>` : ''}
    </tr>`).join('');
  const srcRows = Object.entries(perSrc).map(([src, s]) => `<tr>
      <td><i class="dot" style="background:${sourceColor(src)}"></i> ${esc(sourceName(src))}${contractTag(isContractSrc(src))}</td>
      <td class="num">${yen(s.eW)}</td><td class="num">${yen(s.eT)}</td>
      ${showActual ? `<td class="num">${yen(s.amt)}</td><td class="num">${yen(s.aT)}</td>` : ''}
    </tr>`).join('');
  const head = `<tr><th></th><th>見込み給与・報酬</th><th>見込み交通費</th>${showActual ? '<th>振込額</th><th>うち交通費</th>' : ''}</tr>`;

  const actualCard = showActual ? `
    <div class="card">
      <h2>${y}年 実際に振り込まれた額</h2>
      <div class="kv"><span class="k">振込額の合計</span><b class="num big">${yen(tot.amt)}</b></div>
      <div class="kv"><span class="k">　うち交通費</span><b class="num">${yen(tot.aT)}</b></div>
      ${split.aTemp && split.aTcon ? `<div class="kv small"><span class="k">　　アルバイト（通勤手当）</span><span class="num">${yen(split.aTemp)}</span></div>
      <div class="kv small"><span class="k">　　業務委託</span><span class="num">${yen(split.aTcon)}</span></div>` : ''}
      <div class="kv"><span class="k">　うち給与・報酬（手取り）</span><span class="num">${yen(tot.amt - tot.aT)}</span></div>
      <div class="sep"></div>
      <div class="kv"><span class="k">控除額の合計（源泉所得税など）</span><span class="num">${yen(tot.ded)}</span></div>
      <div class="kv"><span class="k">総支給額（交通費込み）</span><span class="num">${yen(tot.gross)}</span></div>
      <div class="kv"><span class="k">総支給額から交通費を除いた額</span><b class="num">${yen(tot.gross - tot.aT)}</b></div>
    </div>` : '';

  return `
    <div class="monthnav">
      <button class="iconbtn" data-act="year-prev">‹</button>
      <span class="label">${y}年</span>
      <button class="iconbtn" data-act="year-next">›</button>
    </div>
    ${taxCard}
    <div style="text-align:center;margin-bottom:10px">${basisSeg()}</div>
    <div class="card">
      <h2>${y}年 見込み</h2>
      <div class="stat-grid">
        <div class="stat"><div class="k">給与・報酬</div><div class="v">${yen(tot.eW)}</div></div>
        <div class="stat"><div class="k">交通費</div><div class="v">${yen(tot.eT)}</div>
          ${split.eTemp && split.eTcon ? `<div class="muted small">アルバイト ${yen(split.eTemp)}<br>業務委託 ${yen(split.eTcon)}</div>` : ''}</div>
      </div>
      <div class="kv" style="margin-top:8px"><span class="k">合計（給与・報酬＋交通費）</span><b class="num">${yen(tot.eW + tot.eT)}</b></div>
    </div>
    ${actualCard}
    <div class="card">
      <h2>月別</h2>
      <div class="table-wrap"><table><thead>${head}</thead><tbody>${monthRows}</tbody>
        <tfoot><tr><td>合計</td><td class="num">${yen(tot.eW)}</td><td class="num">${yen(tot.eT)}</td>${showActual ? `<td class="num">${yen(tot.amt)}</td><td class="num">${yen(tot.aT)}</td>` : ''}</tr></tfoot>
      </table></div>
    </div>
    <div class="card">
      <h2>バイト先別</h2>
      ${srcRows ? `<div class="table-wrap"><table><thead>${head}</thead><tbody>${srcRows}</tbody></table></div>` : '<div class="empty">データがありません</div>'}
    </div>
    <div class="card note">
      <p><b>税金用のまとめの見方</b></p>
      <p><b>アルバイト・パート（給与）</b>：給与の収入は、その年に<b>支払われた</b>分で数えます（12月に働いて1月に振り込まれる分は翌年）。通勤手当は一定の限度額まで非課税で、給与の収入には入りません。源泉徴収票と照らし合わせるときは「総支給から交通費を除いた額」を見てください（振込実績に控除額を入れておく必要があります）。</p>
      <p><b>業務委託（報酬）</b>：報酬と一緒に支払われた交通費も収入に入り、実際にかかった交通費は経費になります。収入は原則として仕事をした（終えた）年で数えるため、見込みは仕事をした日ベースで集計しています。一定の条件を満たす場合は、入金された日で数える方法も選べます。</p>
      <p>経費は交通費しか入っていません。ほかの経費や、確定申告が必要かどうかは、国税庁の案内や税務署で確認してください。</p>
    </div>`;
}

/* ========== 設定 ========== */
function viewSettings() {
  const list = state.workplaces.map((w) => {
    const r = rateFor(w, today());
    const cnt = state.shifts.filter((s) => s.workplaceId === w.id).length;
    return `<div class="shift-item" data-wp="${w.id}">
      <span class="bar" style="background:${w.color}"></span>
      <div class="grow"><b>${esc(w.name)}</b>${contractTag(w.contractType === CONTRACTOR)}
        <div class="muted small">${r ? (r.payType === 'daily' ? '日給 ' : '時給 ') + yen(r.amount) : '給与未設定'}${(w.premiums || []).map((p) => '・' + premiumText(p)).join('')}・交通費 ${yen(w.transport)}/回${w.contractType === CONTRACTOR && w.transportPaid === false ? '（自己負担）' : ''}・${closingText(w)}</div></div>
      <span class="muted small">${cnt}件 ›</span>
    </div>`;
  }).join('');
  return `
    <div class="card">
      <div class="row between"><h2>バイト先</h2><button class="btn sm sub" data-act="add-wp">＋ 追加</button></div>
      ${list || '<div class="empty">まだ登録されていません</div>'}
    </div>
    <div class="card">
      <h2>Apple カレンダーに追加</h2>
      <p class="note">シフトをカレンダー用のファイル（.ics）にして開きます。自動では同期しないため、iPhone に「バイト」専用のカレンダーを作り、シフトはそこにだけ入れる使い方をおすすめします。シフトを変えたり消したりしたときは、そのカレンダーを丸ごと消して入れ直します。</p>
      <details class="note" style="margin:6px 0 10px">
        <summary><b>はじめての設定と入れ直しの手順</b></summary>
        <p><b>はじめに（1回だけ）</b><br>
        ① iPhone の「カレンダー」アプリ →「カレンダー」→「カレンダーを追加」で「バイト」を作る<br>
        ② 下の「すべてのシフトを入れ直す」を押す →「すべてを追加」→ 入れ先に「バイト」を選ぶ</p>
        <p><b>シフトを追加しただけのとき</b><br>「まだ追加していないシフト」を押して、同じように「バイト」に追加します。</p>
        <p><b>シフトを変更・削除したとき</b><br>
        ①「カレンダー」アプリ →「カレンダー」→「バイト」の ⓘ →「カレンダーを削除」<br>
        ② もう一度「バイト」を作る<br>
        ③「すべてのシフトを入れ直す」を押して「バイト」に追加</p>
        <p>追加するときに入れ先を選べない場合は、iPhone の「設定」→「カレンダー」→「デフォルトカレンダー」を一時的に「バイト」にしてから追加してください。</p>
      </details>
      <button class="btn block" data-act="ics-all" ${state.shifts.length ? '' : 'disabled'}>すべてのシフトを入れ直す（${state.shifts.length}件）</button>
      <button class="btn sub block" data-act="ics-new" style="margin-top:8px" ${unexported().length ? '' : 'disabled'}>まだ追加していないシフトだけ（${unexported().length}件）</button>
    </div>
    <div class="card">
      <h2>バックアップ</h2>
      <p class="note">データはこの iPhone の中だけに保存されています。iPhone の故障・機種変更・アプリの削除に備えて、ときどきバックアップを iCloud Drive に保存してください。</p>
      <p class="small muted">最後のバックアップ：${localStorage.getItem(LAST_BACKUP) ? fmtDate(localStorage.getItem(LAST_BACKUP)) + `（${daysSinceBackup()}日前）` : 'まだありません'}</p>
      <button class="btn block" data-act="export">バックアップを保存</button>
      <button class="btn ghost block" data-act="import" style="margin-top:8px">バックアップから復元</button>
      <details class="note" style="margin-top:10px">
        <summary><b>保存と復元のやり方</b></summary>
        <p><b>保存</b>：「バックアップを保存」→ 出てきたメニューで「"ファイル"に保存」→「iCloud Drive」を選んで「保存」。</p>
        <p><b>復元</b>：「バックアップから復元」→ iCloud Drive から一番新しい日付の <code>shift-backup-…json</code> を選ぶ。</p>
        <p>機種変更のときは、新しい iPhone でこのアプリをホーム画面に追加してから、同じように復元してください。</p>
      </details>
    </div>
    <div class="card note">
      <p>シフト ${state.shifts.length}件 ／ 振込実績 ${state.payments.length}件</p>
    </div>`;
}

function closingText(w) {
  const c = Number(w.closingDay) || 0, p = Number(w.payDay) || 0;
  const off = ['当月', '翌月', '翌々月'][Number(w.payMonthOffset ?? 1)] || '翌月';
  return `${c ? c + '日' : '末日'}締め${off}${p ? p + '日' : '末日'}払い`;
}

/* ========== シート（入力画面） ========== */
function openSheet(html, bind) {
  $('#sheet-body').innerHTML = html;
  $('#sheet-backdrop').hidden = false;
  bind?.($('#sheet-body'));
}
function closeSheet() { $('#sheet-backdrop').hidden = true; $('#sheet-body').innerHTML = ''; }
$('#sheet-backdrop').addEventListener('click', (e) => { if (e.target.id === 'sheet-backdrop') closeSheet(); });

function colorPicker(current) {
  return `<div class="colors">${COLORS.map((c) => `<button type="button" data-color="${c}" class="${c === current ? 'on' : ''}" style="background:${c}"></button>`).join('')}
    <input type="color" name="color" value="${current}"></div>`;
}
function bindColorPicker(root) {
  const input = $('input[name=color]', root);
  $$('[data-color]', root).forEach((b) => b.addEventListener('click', () => {
    input.value = b.dataset.color;
    $$('[data-color]', root).forEach((x) => x.classList.toggle('on', x === b));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }));
  input.addEventListener('input', () => $$('[data-color]', root).forEach((x) => x.classList.toggle('on', x.dataset.color === input.value)));
}

/* --- シフト --- */
function openShift(sh) {
  const isNew = !sh;
  if (isNew) {
    const wp = state.workplaces[0];
    sh = { id: uid(), date: ui.sel, workplaceId: wp?.id ?? null, start: '', end: '', breakMin: 0, transport: wp?.transport ?? 0, dailyOverride: null, memo: '', oneOff: { name: '', daily: '', color: ONEOFF_COLOR, payDate: '' } };
    applyLastTimes(sh);
  }
  const oo = sh.oneOff || { name: '', daily: '', color: ONEOFF_COLOR, payDate: '' };
  const opts = state.workplaces.map((w) => `<option value="${w.id}" ${w.id === sh.workplaceId ? 'selected' : ''}>${esc(w.name)}</option>`).join('');
  const set = (v) => v != null && v !== '';
  const payMode = set(sh.dailyOverride) ? 'daily' : set(sh.hourlyOverride) ? 'hourly' : '';
  const overrideVal = payMode === 'daily' ? sh.dailyOverride : payMode === 'hourly' ? sh.hourlyOverride : '';
  openSheet(`
    <h2>${isNew ? 'シフトを追加' : 'シフトを編集'}</h2>
    <form id="f">
      <div class="field"><label>バイト先</label>
        <select name="wp">${opts}<option value="" ${sh.workplaceId ? '' : 'selected'}>単発（日給）</option></select></div>
      <div class="field"><label>日付</label><input type="date" name="date" value="${sh.date}" required></div>
      <div id="oneoff-fields">
        <div class="field"><label>名前</label><input name="ooName" value="${esc(oo.name)}" placeholder="例：イベント設営"></div>
        <div class="two">
          <div class="field"><label>日給（円）</label><input type="number" inputmode="numeric" name="ooDaily" value="${oo.daily ?? ''}" min="0"></div>
          <div class="field"><label>支払日</label><input type="date" name="ooPay" value="${oo.payDate || ''}"></div>
        </div>
        <div class="field"><label>契約の種類</label>
          <select name="ooType">
            <option value="employee" ${oo.contractType === CONTRACTOR ? '' : 'selected'}>アルバイト（給与）</option>
            <option value="contractor" ${oo.contractType === CONTRACTOR ? 'selected' : ''}>業務委託（報酬）</option>
          </select></div>
        <div class="field" id="oo-tp"><label class="check"><input type="checkbox" name="ooTP" ${oo.transportPaid === false ? '' : 'checked'}> 交通費は報酬とは別に支払われる</label></div>
        <div class="field"><span class="lbl">色</span>${colorPicker(oo.color || ONEOFF_COLOR)}</div>
      </div>
      <div class="field" id="time-hist-wrap"><span class="lbl">最近の時間から選ぶ</span><div class="chips" id="time-hist"></div></div>
      <div class="three">
        <div class="field"><label>開始</label><input type="time" name="start" value="${sh.start || ''}"></div>
        <div class="field"><label>終了</label><input type="time" name="end" value="${sh.end || ''}"></div>
        <div class="field"><label>休憩（分）</label><input type="number" inputmode="numeric" name="breakMin" value="${sh.breakMin || 0}" min="0" step="5"></div>
      </div>
      <div class="field"><label>交通費（円）</label><input type="number" inputmode="numeric" name="transport" value="${sh.transport ?? 0}" min="0"></div>
      <div id="override-fields" class="field">
        <label>この日の給与</label>
        <select name="payMode">
          <option value="" ${payMode === '' ? 'selected' : ''}>いつもどおり（バイト先の設定）</option>
          <option value="hourly" ${payMode === 'hourly' ? 'selected' : ''}>この日だけ時給を変える</option>
          <option value="daily" ${payMode === 'daily' ? 'selected' : ''}>この日だけ日給にする</option>
        </select>
        <input type="number" inputmode="numeric" name="override" value="${overrideVal}" min="0" style="margin-top:6px">
      </div>
      <div class="field"><label>メモ</label><input name="memo" value="${esc(sh.memo)}"></div>
      <div class="preview" id="pv"></div>
      <div class="actions">
        ${isNew ? '' : '<button type="button" class="btn del" data-act="del">削除</button>'}
        <button type="button" class="btn ghost" data-act="cancel">閉じる</button>
        <button type="submit" class="btn">保存</button>
      </div>
      ${isNew ? '' : '<button type="button" class="btn sub block" data-act="dup" style="margin-top:8px">この内容で別の日にもコピー</button>'}
    </form>`, (root) => {
    const f = $('#f', root);
    bindColorPicker(root);
    const read = () => {
      const fd = new FormData(f);
      const wid = fd.get('wp') || null;
      return {
        ...sh,
        workplaceId: wid,
        date: fd.get('date'),
        start: fd.get('start'), end: fd.get('end'),
        breakMin: num(fd.get('breakMin')),
        transport: num(fd.get('transport')),
        dailyOverride: wid && fd.get('payMode') === 'daily' ? num(fd.get('override')) : null,
        hourlyOverride: wid && fd.get('payMode') === 'hourly' ? num(fd.get('override')) : null,
        memo: fd.get('memo').trim(),
        oneOff: wid ? null : { name: fd.get('ooName').trim(), daily: num(fd.get('ooDaily')), color: fd.get('color'), payDate: fd.get('ooPay'), contractType: fd.get('ooType'), transportPaid: !!fd.get('ooTP') },
      };
    };
    const refresh = () => {
      const cur = read();
      const wp = cur.workplaceId ? wpById(cur.workplaceId) : null;
      $('#oneoff-fields', root).hidden = !!wp;
      $('#oo-tp', root).hidden = f.ooType.value !== CONTRACTOR;
      $('#override-fields', root).hidden = !wp;
      const curKey = `${f.start.value}|${f.end.value}|${num(f.breakMin.value)}`;
      $$('#time-hist [data-k]', root).forEach((c) => c.classList.toggle('on', c.dataset.k === curKey));
      f.override.hidden = !f.payMode.value;
      f.override.placeholder = f.payMode.value === 'daily' ? '日給（円）' : '時給（円）';
      const { paidMin, nightMin } = shiftMinutes(cur);
      const wage = shiftWage(cur, wp);
      const b = payBasis(cur, wp);
      const hol = cur.date && holidayName(cur.date);
      $('#pv', root).innerHTML = `${hol ? `<div class="small danger">${hol}</div>` : ''}
        <div class="kv"><span class="k">${basisText(b)}${paidMin ? '・' + hm(paidMin) : ''}${wp?.nightPremium && nightMin && b.kind === 'hourly' ? `（深夜${hm(nightMin)}）` : ''}</span><b>${yen(wage)}</b></div>
        ${(() => {
          const tr = shiftTransport(cur, wp);
          const ct = contractOf(cur, wp) === CONTRACTOR;
          return `<div class="kv"><span class="k">＋ 交通費${ct ? '（支払われる分）' : ''}</span><span>${yen(tr.paid)}</span></div>`
            + (ct ? `<div class="kv"><span class="k">業務委託：経費になる交通費</span><span>${yen(tr.expense)}</span></div>` : '');
        })()}
        <div class="kv"><span class="k">支給予定日</span><span>${cur.date ? fmtDate(payDateFor(cur, wp)) : '—'}</span></div>`;
    };
    const renderHist = () => {
      const hist = timeHistory(f.wp.value || null);
      $('#time-hist-wrap', root).hidden = !hist.length;
      $('#time-hist', root).innerHTML = hist.map((h) => `<button type="button" class="chip" data-k="${h.start}|${h.end}|${h.breakMin}" data-start="${h.start}" data-end="${h.end}" data-break="${h.breakMin}">${h.start}–${h.end}${h.breakMin ? `<small>休${h.breakMin}</small>` : ''}</button>`).join('');
    };
    $('#time-hist', root).addEventListener('click', (e) => {
      const c = e.target.closest('[data-start]');
      if (!c) return;
      f.start.value = c.dataset.start; f.end.value = c.dataset.end; f.breakMin.value = c.dataset.break;
      refresh();
    });
    renderHist();
    f.wp.addEventListener('change', () => {
      renderHist();
      const wp = wpById(f.wp.value);
      if (wp) {
        f.transport.value = wp.transport ?? 0;
        const tmp = { workplaceId: wp.id };
        applyLastTimes(tmp);
        if (isNew && tmp.start) { f.start.value = tmp.start; f.end.value = tmp.end; f.breakMin.value = tmp.breakMin; }
      }
      refresh();
    });
    f.addEventListener('input', refresh);
    f.addEventListener('change', refresh);
    refresh();
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const cur = read();
      if (!cur.date) return;
      cur.updatedAt = Date.now();
      const i = state.shifts.findIndex((s) => s.id === cur.id);
      if (i >= 0) state.shifts[i] = cur; else state.shifts.push(cur);
      save(); closeSheet(); ui.sel = cur.date; [ui.calY, ui.calM] = parseYmd(cur.date); render();
    });
    $('[data-act=cancel]', root).addEventListener('click', closeSheet);
    $('[data-act=del]', root)?.addEventListener('click', () => {
      if (!confirm('このシフトを削除しますか？')) return;
      state.shifts = state.shifts.filter((s) => s.id !== sh.id); save(); closeSheet(); render();
    });
    $('[data-act=dup]', root)?.addEventListener('click', () => {
      const date = prompt('コピー先の日付（例：2026-12-01）', sh.date);
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      state.shifts.push({ ...read(), id: uid(), date, icsExported: false, oneOff: read().oneOff ? { ...read().oneOff, payDate: '' } : null });
      save(); closeSheet(); ui.sel = date; [ui.calY, ui.calM] = parseYmd(date); render();
    });
  });
}

/** 入力した順番（新しいほど大きい）。古いシフトは id に含まれる作成時刻を使う */
const enteredAt = (sh) => sh.updatedAt || parseInt(String(sh.id).slice(0, 8), 36) || 0;

/** 職場ごとの勤務時間の履歴（最近入力した順・重複なし・最大 n 件）。workplaceId が null なら単発 */
function timeHistory(workplaceId, n = 5) {
  const seen = new Set();
  const out = [];
  const list = state.shifts
    .filter((s) => (s.workplaceId || null) === (workplaceId || null) && s.start && s.end)
    .sort((a, b) => enteredAt(b) - enteredAt(a));
  for (const s of list) {
    const k = `${s.start}|${s.end}|${Number(s.breakMin) || 0}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ start: s.start, end: s.end, breakMin: Number(s.breakMin) || 0 });
    if (out.length >= n) break;
  }
  return out;
}

function applyLastTimes(sh) {
  if (!sh.workplaceId) return;
  const last = timeHistory(sh.workplaceId, 1)[0];
  if (last) Object.assign(sh, last);
}

/* --- バイト先 --- */
function openWorkplace(w) {
  const isNew = !w;
  w = w ? structuredClone(w) : {
    id: uid(), name: '', color: COLORS[state.workplaces.length % COLORS.length],
    rates: [{ from: '2000-01-01', payType: 'hourly', amount: '' }],
    transport: 0, closingDay: 0, payMonthOffset: 1, payDay: 25, nightPremium: true,
    contractType: 'employee', transportPaid: true,
  };
  const dayOpts = (sel, label0) => [`<option value="0" ${!Number(sel) ? 'selected' : ''}>${label0}</option>`]
    .concat(Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}" ${Number(sel) === i + 1 ? 'selected' : ''}>${i + 1}日</option>`)).join('');
  const rateRow = (r, i) => `<div class="rate-row" data-i="${i}">
      <input type="date" name="rFrom" value="${i === 0 && r.from === '2000-01-01' ? '' : r.from}" ${i === 0 ? 'placeholder="最初から"' : ''}>
      <select name="rType"><option value="hourly" ${r.payType === 'hourly' ? 'selected' : ''}>時給</option><option value="daily" ${r.payType === 'daily' ? 'selected' : ''}>日給</option></select>
      <input type="number" inputmode="numeric" name="rAmt" value="${r.amount}" min="0" placeholder="円">
      ${i === 0 ? '<span></span>' : '<button type="button" class="x" data-rm>×</button>'}
    </div>`;
  const premRow = (r) => `<div class="prem-row">
      <div class="days">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<label class="daychk"><input type="checkbox" value="${d}" ${(r.days || []).includes(d) ? 'checked' : ''}><span>${PREMIUM_DAYS[d]}</span></label>`).join('')}
        <label class="daychk"><input type="checkbox" value="holiday" ${r.holiday ? 'checked' : ''}><span>祝</span></label></div>
      <div class="row"><span class="small muted">時給に</span><input type="number" inputmode="numeric" name="pAmt" value="${r.amount ?? ''}" min="0" placeholder="円" style="width:90px"><span class="small muted">円 上乗せ</span>
        <button type="button" class="x" data-rm-prem style="margin-left:auto">×</button></div>
    </div>`;
  const cnt = state.shifts.filter((s) => s.workplaceId === w.id).length;
  openSheet(`
    <h2>${isNew ? 'バイト先を追加' : 'バイト先を編集'}</h2>
    <form id="f">
      <div class="field"><label>名前</label><input name="name" value="${esc(w.name)}" placeholder="例：カフェ" required></div>
      <div class="field"><label>契約の種類</label>
        <select name="contractType">
          <option value="employee" ${w.contractType === CONTRACTOR ? '' : 'selected'}>アルバイト・パート（給与）</option>
          <option value="contractor" ${w.contractType === CONTRACTOR ? 'selected' : ''}>業務委託（報酬）</option>
        </select>
        <p class="note">雇用契約なら「アルバイト・パート」、業務委託契約・請負なら「業務委託」です。インターンは契約書で確認してください。年収画面で交通費の扱いを分けて集計します。</p></div>
      <div class="field"><span class="lbl">カレンダーの色</span>${colorPicker(w.color)}</div>
      <div class="field"><span class="lbl">給与（いつから・時給か日給か・金額）</span>
        <div id="rates">${[...w.rates].sort((a, b) => a.from.localeCompare(b.from)).map(rateRow).join('')}</div>
        <button type="button" class="btn sm sub" data-act="add-rate">＋ 時給の改定・日給への変更を追加</button>
        <p class="note">時給が変わったら、ここに「変わった日」と新しい金額を追加してください。その日より前のシフトは前の時給のまま計算されます。1行目の日付は空欄なら最初から適用です。</p>
      </div>
      <div class="field"><span class="lbl">曜日・祝日の上乗せ</span>
        <div id="prems">${(w.premiums || []).map(premRow).join('')}</div>
        <button type="button" class="btn sm sub" data-act="add-prem">＋ 土日祝などの時給アップを追加</button>
        <p class="note">選んだ曜日・祝日（振替休日を含む）のシフトは、時給に上乗せして計算します。複数当てはまるときは高いほうを使います。年末年始など特定の日だけ時給が違うときは、シフトの入力画面で「この日だけ時給を変える」を選んでください。</p>
      </div>
      <div class="field"><label>交通費（1回あたり・円）</label><input type="number" inputmode="numeric" name="transport" value="${w.transport ?? 0}" min="0">
        <label class="check" id="tp-field" style="margin-top:8px"><input type="checkbox" name="transportPaid" ${w.transportPaid === false ? '' : 'checked'}> 交通費は報酬とは別に支払われる</label>
        <p class="note" id="tp-note">業務委託では、支払われない（自己負担の）交通費も経費として記録します。その場合はチェックを外して、実際にかかる交通費を入れてください。</p>
        <p class="note">シフト追加時の初期値になります。日ごとにシフト側で変更できます。</p></div>
      <div class="three">
        <div class="field"><label>締め日</label><select name="closingDay">${dayOpts(w.closingDay, '末日')}</select></div>
        <div class="field"><label>支払月</label><select name="payMonthOffset">
          ${['当月', '翌月', '翌々月'].map((t, i) => `<option value="${i}" ${Number(w.payMonthOffset) === i ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field"><label>給料日</label><select name="payDay">${dayOpts(w.payDay, '末日')}</select></div>
      </div>
      <div class="field"><label class="check"><input type="checkbox" name="nightPremium" ${w.nightPremium ? 'checked' : ''}> 深夜手当（22時〜翌5時は時給1.25倍）</label></div>
      <div class="actions">
        ${isNew ? '' : '<button type="button" class="btn del" data-act="del">削除</button>'}
        <button type="button" class="btn ghost" data-act="cancel">閉じる</button>
        <button type="submit" class="btn">保存</button>
      </div>
    </form>`, (root) => {
    const f = $('#f', root);
    bindColorPicker(root);
    const rates = $('#rates', root);
    rates.addEventListener('click', (e) => { if (e.target.matches('[data-rm]')) e.target.closest('.rate-row').remove(); });
    $('[data-act=add-rate]', root).addEventListener('click', () => {
      const lastRow = $$('.rate-row', rates).at(-1);
      const r = { from: today(), payType: lastRow ? $('[name=rType]', lastRow).value : 'hourly', amount: '' };
      rates.insertAdjacentHTML('beforeend', rateRow(r, $$('.rate-row', rates).length));
    });
    const syncContract = () => {
      const ct = f.contractType.value === CONTRACTOR;
      $('#tp-field', root).hidden = !ct; $('#tp-note', root).hidden = !ct;
    };
    f.contractType.addEventListener('change', syncContract);
    syncContract();
    const prems = $('#prems', root);
    prems.addEventListener('click', (e) => { if (e.target.matches('[data-rm-prem]')) e.target.closest('.prem-row').remove(); });
    $('[data-act=add-prem]', root).addEventListener('click', () => prems.insertAdjacentHTML('beforeend', premRow({ days: [0, 6], holiday: true, amount: '' })));
    $('[data-act=cancel]', root).addEventListener('click', closeSheet);
    $('[data-act=del]', root)?.addEventListener('click', () => {
      if (!confirm(`「${w.name}」を削除しますか？${cnt ? `\nこのバイト先のシフト${cnt}件と振込実績も一緒に削除されます。` : ''}`)) return;
      state.workplaces = state.workplaces.filter((x) => x.id !== w.id);
      state.shifts = state.shifts.filter((s) => s.workplaceId !== w.id);
      state.payments = state.payments.filter((p) => p.source !== w.id);
      save(); closeSheet(); render();
    });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      const newRates = $$('.rate-row', rates).map((row, i) => ({
        from: $('[name=rFrom]', row).value || (i === 0 ? '2000-01-01' : ''),
        payType: $('[name=rType]', row).value,
        amount: num($('[name=rAmt]', row).value),
      })).filter((r) => r.from);
      const out = {
        ...w, name: fd.get('name').trim(), color: fd.get('color'), rates: newRates,
        transport: num(fd.get('transport')), closingDay: num(fd.get('closingDay')),
        payMonthOffset: num(fd.get('payMonthOffset')), payDay: num(fd.get('payDay')),
        nightPremium: !!fd.get('nightPremium'),
        contractType: fd.get('contractType'),
        transportPaid: fd.get('contractType') === CONTRACTOR ? !!fd.get('transportPaid') : true,
        premiums: $$('.prem-row', prems).map((row) => {
          const checked = $$('input[type=checkbox]:checked', row).map((c) => c.value);
          return { days: checked.filter((v) => v !== 'holiday').map(Number), holiday: checked.includes('holiday'), amount: num($('[name=pAmt]', row).value) };
        }).filter((p) => p.amount > 0 && (p.days.length || p.holiday)),
      };
      if (!out.name) return;
      const i = state.workplaces.findIndex((x) => x.id === out.id);
      if (i >= 0) state.workplaces[i] = out; else state.workplaces.push(out);
      save(); closeSheet(); render();
    });
  });
}

/* --- 振込実績 --- */
function openPayment(src) {
  const key = ym(ui.monY, ui.monM);
  const existing = state.payments.find((p) => p.month === key && p.source === src);
  const est = aggregate(state, 'pay')[key]?.[src] || { wage: 0, transport: 0 };
  const wp = wpById(src);
  const ct = isContractSrc(src);
  const defDate = wp ? ymd(ui.monY, ui.monM, Number(wp.payDay) ? Math.min(Number(wp.payDay), daysInMonth(ui.monY, ui.monM)) : daysInMonth(ui.monY, ui.monM)) : '';
  const p = existing || { id: uid(), month: key, source: src, date: defDate, amount: '', transport: est.transport, deduction: '', memo: '' };
  openSheet(`
    <h2>${esc(sourceName(src))}　${ui.monY}年${ui.monM}月の振込</h2>
    <form id="f">
      <div class="preview small">見込み：${ct ? '報酬' : '給与'} ${yen(est.wage)} ＋ 交通費 ${yen(est.transport)} ＝ <b>${yen(est.wage + est.transport)}</b></div>
      <div class="field"><label>振込日</label><input type="date" name="date" value="${p.date || ''}"></div>
      <div class="field"><label>振り込まれた金額（円）</label><input type="number" inputmode="numeric" name="amount" value="${p.amount}" min="0" required></div>
      <div class="field"><label>そのうち交通費（円）</label><input type="number" inputmode="numeric" name="transport" value="${p.transport}" min="0">
        <p class="note">${ct ? '報酬と一緒に支払われた交通費を入れてください。' : '給与明細に書かれた交通費（通勤手当）を入れてください。'}初期値はシフトから計算した見込み額です。</p></div>
      <div class="field"><label>${ct ? '源泉徴収税額（任意）' : '控除額（源泉所得税など・任意）'}</label><input type="number" inputmode="numeric" name="deduction" value="${p.deduction}" min="0">
        <p class="note">${ct ? '報酬から差し引かれた源泉徴収税額を入れると、支払金額（振込額＋源泉徴収税額）も年収画面に出ます。' : '給与明細の控除合計を入れると、総支給額（振込額＋控除額）も年収画面に出ます。'}</p></div>
      <div class="field"><label>メモ</label><input name="memo" value="${esc(p.memo)}"></div>
      <div class="actions">
        ${existing ? '<button type="button" class="btn del" data-act="del">削除</button>' : ''}
        <button type="button" class="btn ghost" data-act="cancel">閉じる</button>
        <button type="submit" class="btn">保存</button>
      </div>
    </form>`, (root) => {
    const f = $('#f', root);
    $('[data-act=cancel]', root).addEventListener('click', closeSheet);
    $('[data-act=del]', root)?.addEventListener('click', () => {
      if (!confirm('この振込実績を削除しますか？')) return;
      state.payments = state.payments.filter((x) => x.id !== p.id); save(); closeSheet(); render();
    });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      const out = { ...p, date: fd.get('date'), amount: num(fd.get('amount')), transport: num(fd.get('transport')), deduction: num(fd.get('deduction')), memo: fd.get('memo').trim() };
      const i = state.payments.findIndex((x) => x.id === out.id);
      if (i >= 0) state.payments[i] = out; else state.payments.push(out);
      save(); closeSheet(); render();
    });
  });
}

/* ========== イベント ========== */
function bindView(view) {
  view.onclick = (e) => {
    const t = e.target.closest('[data-act],[data-date],[data-shift],[data-wp],[data-basis]');
    if (!t) return;
    if (t.dataset.date) { ui.sel = t.dataset.date; const [y, m] = parseYmd(t.dataset.date); ui.calY = y; ui.calM = m; return render(); }
    if (t.dataset.shift) return openShift(state.shifts.find((s) => s.id === t.dataset.shift));
    if (t.dataset.wp) return openWorkplace(wpById(t.dataset.wp));
    if (t.dataset.basis) { ui.basis = t.dataset.basis; localStorage.setItem('shiftpay.basis', ui.basis); return render(); }
    const act = t.dataset.act;
    const moves = {
      'cal-prev': () => ([ui.calY, ui.calM] = addMonths(ui.calY, ui.calM, -1)),
      'cal-next': () => ([ui.calY, ui.calM] = addMonths(ui.calY, ui.calM, 1)),
      'cal-today': () => { const d = new Date(); ui.calY = d.getFullYear(); ui.calM = d.getMonth() + 1; ui.sel = today(); },
      'mon-prev': () => ([ui.monY, ui.monM] = addMonths(ui.monY, ui.monM, -1)),
      'mon-next': () => ([ui.monY, ui.monM] = addMonths(ui.monY, ui.monM, 1)),
      'year-prev': () => ui.year--,
      'year-next': () => ui.year++,
    };
    if (moves[act]) { moves[act](); return render(); }
    if (act === 'add-shift') return openShift(null);
    if (act === 'add-wp') return openWorkplace(null);
    if (act === 'edit-pay') return openPayment(t.dataset.src);
    if (act === 'export') return exportData();
    if (act === 'reload') return location.reload();
    if (act === 'export-unreadable') return download(localStorage.getItem('shiftpay.unreadable') || '', `shift-unreadable-${today()}.json`, 'application/json');
    if (act === 'ics-month') return exportIcs(state.shifts.filter((s) => s.date.startsWith(ym(ui.calY, ui.calM))), `shift-${ym(ui.calY, ui.calM)}.ics`);
    if (act === 'ics-new') return exportIcs(unexported(), `shift-new-${today()}.ics`);
    if (act === 'ics-all') {
      if (!confirm('iPhone の「バイト」カレンダーを先に削除して、作り直しましたか？\n（残ったままだと、同じ予定が2つずつ入ります）')) return;
      return exportIcs(state.shifts, `shift-all-${today()}.ics`, { skipWarning: true });
    }
    if (act === 'import') return $('#import-file').click();
  };
}

function unexported() { return state.shifts.filter((s) => !s.icsExported); }

function exportIcs(shifts, filename, { skipWarning = false } = {}) {
  if (!shifts.length) return alert('書き出すシフトがありません');
  const already = shifts.filter((s) => s.icsExported).length;
  if (already && !skipWarning && !confirm(`${shifts.length}件のうち${already}件は、以前カレンダーに追加済みです。もう一度追加すると、カレンダーに同じ予定が2つ入ることがあります。続けますか？`)) return;
  const d = new Date();
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  const file = new File([shiftsToIcs(shifts, state.workplaces, stamp)], filename, { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  const ids = new Set(shifts.map((s) => s.id));
  state.shifts.forEach((s) => { if (ids.has(s.id)) s.icsExported = true; });
  save(); render();
}

function download(text, filename, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
function exportData() {
  const name = `shift-backup-${today()}.json`;
  const text = JSON.stringify({ ...state, backupAt: new Date().toISOString() }, null, 2);
  const done = () => { localStorage.setItem(LAST_BACKUP, today()); render(); };
  const file = new File([text], name, { type: 'application/json' });
  // iPhone では共有メニューを開き、「"ファイル"に保存」で iCloud Drive に保存できるようにする
  if (navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file] }).then(done).catch((err) => {
      if (err.name !== 'AbortError') { download(text, name, 'application/json'); done(); }
    });
    return;
  }
  download(text, name, 'application/json');
  done();
}
function daysSinceBackup() {
  const last = localStorage.getItem(LAST_BACKUP);
  if (!last) return null;
  const [y, m, d] = parseYmd(last);
  return Math.floor((Date.now() - new Date(y, m - 1, d).getTime()) / 86400000);
}

/** 画面上部に出すお知らせ（読み込み失敗・バックアップの催促） */
function banners() {
  if (loadProblem?.kind === 'newer') {
    return `<div class="card banner warn"><b>アプリが古いまま開かれています</b><p class="note">データを守るため、保存を止めています。再読み込みすると最新のアプリになります。</p>
      <button class="btn sm block" data-act="reload">再読み込み</button></div>`;
  }
  if (loadProblem?.kind === 'broken') {
    return `<div class="card banner warn"><b>保存されていたデータを読み込めませんでした</b><p class="note">${esc(loadProblem.message)}。元のデータは消さずに残してあります。書き出して、開発者に送ってください。</p>
      <button class="btn sm block" data-act="export-unreadable">読めなかったデータを書き出す</button></div>`;
  }
  if (ui.tab !== 'calendar' || state.shifts.length < 5) return '';
  const days = daysSinceBackup();
  if (days != null && days < 30) return '';
  return `<div class="card banner"><div class="row between"><span class="small">${days == null ? 'まだバックアップしていません' : `最後のバックアップから${days}日たちました`}</span>
    <button class="btn sm sub" data-act="export">バックアップ</button></div></div>`;
}
async function importData(file) {
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    const data = migrate(raw);
    delete data.backupAt;
    const when = raw.backupAt ? new Date(raw.backupAt).toLocaleString('ja-JP') : file.name;
    const isEmpty = !state.workplaces.length && !state.shifts.length && !state.payments.length;
    const msg = `${when} のバックアップ\nバイト先 ${data.workplaces.length}件・シフト ${data.shifts.length}件・振込実績 ${data.payments.length}件\n\n`
      + (isEmpty ? 'このデータを復元します。' : '今のデータは消えて、このバックアップの内容に置き換わります。復元しますか？');
    if (!confirm(msg)) return;
    if (loadProblem?.kind === 'broken') loadProblem = null;
    state = data;
    save(); render(); alert('復元しました');
  } catch (err) { alert('読み込めませんでした：' + err.message); }
  finally { $('#import-file').value = ''; }
}
$('#import-file').addEventListener('change', (e) => importData(e.target.files[0]));

$$('.tabbar button').forEach((b) => b.addEventListener('click', () => {
  ui.tab = b.dataset.tab;
  if (ui.tab === 'month') { ui.monY = ui.calY; ui.monM = ui.calM; }
  window.scrollTo(0, 0); render();
}));

if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
render();
