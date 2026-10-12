import "./title.css";
import { $, press } from "../../shared/dom";
import { RULESETS, DEFAULT_ID } from "../../shared/rules";
import { loadBest, onBest } from "../../shared/storage";

export function initTitle(opt: { onStart: (id: string) => void }) {
  const root = $("screen-title");
  const sel = $("ruleset-select") as unknown as HTMLSelectElement;
  sel.replaceChildren(...Object.values(RULESETS).map((r) => new Option(r.name, r.id)));
  const start = () => {
    // console.log(sel.value);
    opt.onStart(sel.value);
  };
  $("btn-start").addEventListener("click", start);
  const refreshBest = () => ($("title-best").textContent = loadBest(sel.value).toLocaleString());
  sel.addEventListener("change", refreshBest);
  onBest(refreshBest);
  addEventListener("keydown", (e) => {
    if (document.querySelector("dialog[open]")) return;
    if (e.key === "Enter" && !root.hidden) {
      e.preventDefault();
      start();
    }
  });
  return {
    show() {
      refreshBest();
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    }
  };
}
