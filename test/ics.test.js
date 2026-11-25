import test from 'node:test';
import assert from 'node:assert/strict';
import { shiftsToIcs } from '../ics.js';

const wps = [{ id: 'w1', name: 'カフェ', rates: [{ from: '2000-01-01', payType: 'hourly', amount: 1100 }], nightPremium: false }];

test('通常・日付またぎ・時間なし単発', () => {
  const ics = shiftsToIcs([
    { id: 'a', workplaceId: 'w1', date: '2026-11-30', start: '20:00', end: '02:00', breakMin: 0, transport: 420, memo: 'レジ, 締め' },
    { id: 'b', workplaceId: null, date: '2026-12-31', oneOff: { name: 'イベント', daily: 7000 }, transport: 0 },
  ], wps, '20261125T000000Z');
  assert.match(ics, /DTSTART:20261130T200000\r\nDTEND:20261201T020000/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101/);
  assert.match(ics, /SUMMARY:カフェ/);
  assert.match(ics, /レジ\\, 締め/);
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line);
});
