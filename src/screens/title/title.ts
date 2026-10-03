import "./title.css";
import { $, press } from "../../shared/dom";
import { loadBest } from "../../shared/storage";

export function initTitle(opt: { onStart: () => void }) {
  const root = $("screen-title");
  press($("btn-start"), opt.onStart);
  addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !root.hidden) {
      e.preventDefault();
      opt.onStart();
    }
  });
  return {
    show() {
      $("title-best").textContent = loadBest().toLocaleString();
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    }
  };
}
