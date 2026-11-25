import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// 画面側（app.js など）はブラウザでしか動かないため、少なくとも構文エラーがないことを確かめる
for (const f of ['app.js', 'calc.js', 'holidays.js', 'ics.js', 'migrate.js', 'sw.js']) {
  test(`構文チェック: ${f}`, () => {
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }));
  });
}
