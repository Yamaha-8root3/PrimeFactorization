export const factorBase = (p: number) => Math.round(10 * (p / 2) ** 1.6);

// コンボ倍率（combo = 判定後のコンボ数）。
export const comboMul = (combo: number) => (100 + combo) / 100;

export const PERFECT_MUL = 1.5;

export function factorPoints(p: number, combo: number, perfect: boolean): number {
  return Math.round(factorBase(p) * comboMul(combo) * (perfect ? PERFECT_MUL : 1));
}
