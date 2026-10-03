const SCORE_VERSION = 1.1;

const HS_KEY = `pf${SCORE_VERSION}.best`;
export const loadBest = () => {
  try {
    return Number(localStorage.getItem(HS_KEY)) || 0;
  } catch {
    return 0;
  }
};

export const saveBest = (v: number) => {
  try {
    localStorage.setItem(HS_KEY, String(v));
  } catch {}
};
