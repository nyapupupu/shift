// シフトを iCalendar（.ics）形式に変換する。Apple カレンダーなどに読み込ませるためのもの。
import { pad, parseYmd, addMonths, daysInMonth, shiftWage } from './calc.js';

const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// 1行75オクテットを超える行は折り返す（RFC 5545）。マルチバイト文字の途中では切らない。
function fold(line) {
  const enc = new TextEncoder();
  const out = [];
  let cur = '', bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    const limit = out.length ? 74 : 75; // 継続行は先頭の空白1バイトぶん短くする
    if (bytes + b > limit) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const nextDay = (date) => {
  const [y, m, d] = parseYmd(date);
  if (d < daysInMonth(y, m)) return `${y}-${pad(m)}-${pad(d + 1)}`;
  const [ny, nm] = addMonths(y, m, 1);
  return `${ny}-${pad(nm)}-01`;
};
const dt = (date, hhmm) => date.replace(/-/g, '') + 'T' + hhmm.replace(':', '') + '00';
const yen = (n) => '¥' + Math.round(Number(n) || 0).toLocaleString('ja-JP');

/** stamp は 'YYYYMMDDTHHMMSSZ' 形式（テストで固定できるよう引数にしている） */
export function shiftsToIcs(shifts, workplaces, stamp) {
  const wpById = Object.fromEntries(workplaces.map((w) => [w.id, w]));
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//shiftpay//JA', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:バイト'];
  for (const sh of shifts) {
    const wp = sh.workplaceId ? wpById[sh.workplaceId] : null;
    if (sh.workplaceId && !wp) continue;
    const name = wp ? wp.name : sh.oneOff?.name || '単発';
    const desc = [`見込み給与 ${yen(shiftWage(sh, wp))}`, `交通費 ${yen(sh.transport)}`];
    if (sh.breakMin) desc.push(`休憩 ${sh.breakMin}分`);
    if (sh.memo) desc.push(sh.memo);
    lines.push('BEGIN:VEVENT', `UID:${sh.id}@shiftpay`, `DTSTAMP:${stamp}`);
    if (sh.start && sh.end) {
      const endDate = sh.end <= sh.start ? nextDay(sh.date) : sh.date; // 日付をまたぐ勤務
      lines.push(`DTSTART:${dt(sh.date, sh.start)}`, `DTEND:${dt(endDate, sh.end)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${sh.date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${nextDay(sh.date).replace(/-/g, '')}`);
    }
    lines.push(`SUMMARY:${esc(name)}`, `DESCRIPTION:${esc(desc.join('\n'))}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

