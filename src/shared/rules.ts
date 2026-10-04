export type Rules = {
  limitMs: number;
  perfectOnly?: boolean;
};

export type Config = {
  showCountdown: boolean;
};

export type RuleSet = { id: string; name: string; ver: number; ranked: RankedRules; rules: Rules };

const STANDARD: Rules = {
  limitMs: 100_000,
  perfectOnly: false
};
const DEV: Rules = {
  limitMs: 10_000,
  perfectOnly: false
};

export enum RankedRules {
  Unranked = 0,
  RandomSeedOnly = 1
}

// 公式ルールセット。ranked のものだけランキング対象
export const RULESETS: Record<string, RuleSet> = {
  "normal-100s": { id: "normal-100s", name: "Normal 100s", ver: 2, ranked: RankedRules.RandomSeedOnly, rules: STANDARD }
  // dev: { id: "dev", name: "Dev", ver: 1, ranked: RankedRules.RandomSeedOnly, rules: DEV }
};
export const DEFAULT_ID = "normal-100s";
export const DEFAULT_RULES = RULESETS[DEFAULT_ID].rules;
export const DEFAULT_CONFIG: Config = { showCountdown: false };

export type GameSetup = { ruleset: RuleSet; config: Config; seed: number };
export const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];

// リザルト（クライアント→サーバー）。申告値は score / solved のみ
export type Decision = { t: number; v: number[] }; // t: GOからの経過ms、v: その決定で判定に出した素数列
export type ProblemLog = { n: number; dec: Decision[] };
export type RunResult = { mode: string; rulesVer: number; seed: number; score: number; solved: number; problems: ProblemLog[] };

export function makeSetup(id: string, config: Config = DEFAULT_CONFIG): GameSetup {
  const ruleset = RULESETS[id] ?? RULESETS[DEFAULT_ID];
  return { ruleset, config, seed: newSeed() };
}
