import { initTitle } from "./screens/title/title";
import { initGame } from "./screens/game/game";
import { initAccount } from "./screens/title/account";
import { initRanking } from "./screens/title/ranking";
import { makeSetup } from "./shared/rules";
import { initSettings } from "./screens/title/settings";
import { loadConfig } from "./shared/config";

// import "./style.css";
declare const __APP_VERSION__: string;
document.querySelector(".version")!.textContent = `v${__APP_VERSION__}`;

const title = initTitle({
  onStart: (id) => {
    title.hide();
    game.start(makeSetup(id, loadConfig()));
  }
});
initAccount(); // 追加
initRanking();
initSettings();

const game = initGame({ onExit: () => title.show() });
title.show();
