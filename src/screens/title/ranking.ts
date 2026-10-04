import "./rank.css";
import { $ } from "../../shared/dom";
import { fetchRanking } from "../../shared/api";
import { DEFAULT_ID } from "../../shared/rules";
import { loadBest } from "../../shared/storage";

import { currentUser } from "./account";

// ランキングダイアログの開閉と描画（表示名は textContent で入れる）
export function initRanking() {
  const dlg = $("rank-dialog") as HTMLDialogElement;
  $("btn-ranking").addEventListener("click", async () => {
    $("rank-list").replaceChildren();
    $("rank-me").textContent = "";
    $("rank-error").textContent = "";
    dlg.showModal();
    const sel = $("ruleset-select") as unknown as HTMLSelectElement;
    console.log(sel.value);
    const mode = sel.value || DEFAULT_ID;
    const r = await fetchRanking(mode, 20);
    if (!("entries" in r)) {
      $("rank-error").textContent = "Failed to load";
      return;
    }
    for (const e of r.entries) {
      const li = document.createElement("li");
      if (e.mine) li.className = "mine";
      for (const t of [String(e.rank), e.displayName, e.score.toLocaleString()]) {
        const s = document.createElement("span");
        s.textContent = t;
        li.appendChild(s);
      }
      $("rank-list").appendChild(li);
    }
    $("rank-me").textContent = r.me ? `You: ${r.me.rank}位 ${r.me.score.toLocaleString()}` : currentUser ? "記録なし" : "ログインするとランキングに登録されます";
  });
  $("rank-close").addEventListener("click", () => dlg.close());
}
