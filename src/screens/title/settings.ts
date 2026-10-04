import "./settings.css";
import { $ } from "../../shared/dom";
import { loadConfig, saveConfig } from "../../shared/config";

// 設定ダイアログ。変更は即保存
export function initSettings() {
  const dlg = $("config-dialog") as HTMLDialogElement;
  const cd = $("cfg-countdown") as HTMLInputElement;
  $("btn-config").addEventListener("click", () => {
    cd.checked = loadConfig().showCountdown;
    dlg.showModal();
  });
  cd.addEventListener("change", () => saveConfig({ ...loadConfig(), showCountdown: cd.checked }));
}
