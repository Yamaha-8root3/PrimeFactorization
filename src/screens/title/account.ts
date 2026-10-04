import "./auth.css";
import { $ } from "../../shared/dom";
import { signup, login, logout, fetchMe, type User } from "../../shared/api";

const ERRORS: Record<string, string> = {
  invalid_username: "ユーザー名は英数字と _ の 3〜16 文字です",
  invalid_password: "パスワードは 8〜128 文字です",
  username_taken: "このユーザー名は使われています",
  invalid_credentials: "ユーザー名またはパスワードが違います",
  network: "通信に失敗しました",
  invalid_display_name: "表示名は 1〜16 文字で、制御文字は使えません"
};

export let currentUser: User | null = null;

export function initAccount() {
  const dlg = $("auth-dialog") as HTMLDialogElement;
  const form = $("auth-form") as HTMLFormElement;
  const user = $("auth-user") as HTMLInputElement;
  const pass = $("auth-pass") as HTMLInputElement;
  const display = $("auth-display") as HTMLInputElement;
  let mode: "login" | "signup" = "login";

  const refresh = () => {
    if (currentUser) {
      $("account-name").textContent = currentUser.displayName || currentUser.username;
    } else {
      $("account-name").textContent = "Guest";
    }
    $("btn-account").hidden = !!currentUser;
    $("btn-logout").hidden = !currentUser;
  };
  const setMode = (m: typeof mode) => {
    mode = m;
    $("auth-title").textContent = m === "login" ? "ログイン" : "アカウント作成";
    $("auth-submit").textContent = m === "login" ? "ログイン" : "作成する";
    $("auth-switch").textContent = m === "login" ? "アカウントを作成する" : "ログインに戻る";
    $("auth-display-wrap").hidden = m === "login";
    pass.autocomplete = m === "login" ? "current-password" : "new-password";
    $("auth-error").textContent = "";
  };

  $("btn-account").addEventListener("click", () => {
    setMode("login");
    dlg.showModal();
    user.focus();
  });
  $("auth-close").addEventListener("click", () => dlg.close());
  $("auth-switch").addEventListener("click", () => setMode(mode === "login" ? "signup" : "login"));
  $("btn-logout").addEventListener("click", async () => {
    await logout();
    currentUser = null;
    refresh();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const r = await (mode === "login" ? login(user.value.trim(), pass.value) : signup(user.value.trim(), pass.value, display.value.trim()));
    if (r.user) {
      currentUser = r.user;
      pass.value = "";
      dlg.close();
      refresh();
    } else $("auth-error").textContent = ERRORS[r.error ?? ""] ?? "エラーが発生しました";
  });

  refresh();
  fetchMe().then((u) => {
    currentUser = u;
    refresh();
  });
}
