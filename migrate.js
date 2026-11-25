// 保存データの形式（version）を最新に変換する。
// データの形を変える修正をしたときは、CURRENT_VERSION を1つ上げ、MIGRATIONS に変換処理を足す。
// 例: MIGRATIONS[1] = (d) => { ...version 1 → 2 の変換...; return d; };

export const CURRENT_VERSION = 1;

export const MIGRATIONS = {
  // 1: (d) => d,
};

export class NewerDataError extends Error {}

/** 読み込んだデータを最新形式にする。元のオブジェクトは変更しない。 */
export function migrate(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.workplaces) || !Array.isArray(input.shifts)) {
    throw new Error('このアプリのデータではありません');
  }
  let d = structuredClone(input);
  let v = Number(d.version) || 1;
  if (v > CURRENT_VERSION) throw new NewerDataError(`新しいバージョンのアプリで保存されたデータです（v${v}）`);
  while (v < CURRENT_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`v${v} からの変換処理がありません`);
    d = step(d);
    v += 1;
  }
  return { ...d, version: CURRENT_VERSION, workplaces: d.workplaces, shifts: d.shifts, payments: Array.isArray(d.payments) ? d.payments : [] };
}
