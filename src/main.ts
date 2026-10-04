import { initTitle } from "./screens/title/title";
import { initGame } from "./screens/game/game";
import { initAccount } from "./screens/title/account";
// import "./style.css";
declare const __APP_VERSION__: string;
document.querySelector(".version")!.textContent = `v${__APP_VERSION__}`;

const title = initTitle({
  onStart: () => {
    title.hide();
    game.start();
  }
});
initAccount(); // 追加

const game = initGame({ onExit: () => title.show() });
title.show();
