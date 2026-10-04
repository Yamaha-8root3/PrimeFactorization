import { DEFAULT_CONFIG, type Config } from "./rules";

const KEY = "pf.config";

// 保存値を既定値にマージして返す（項目の追加・型の不一致に強い）
export function loadConfig(): Config {
  const out: Record<string, unknown> = { ...DEFAULT_CONFIG };
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    for (const k of Object.keys(out)) if (typeof o?.[k] === typeof out[k]) out[k] = o[k];
  } catch {}
  return out as Config;
}

export function saveConfig(c: Config) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {}
}
