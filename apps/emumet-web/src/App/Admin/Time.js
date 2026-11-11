// 通知・確認時刻の表示: 当日なら HH:MM、それ以外は MM/DD (ブラウザーのローカル時刻)。
// SSR はデータを持たずに描画するため、この関数はクライアントでだけ呼ばれる。
const pad = (n) => String(n).padStart(2, "0");

export const formatEventTimeImpl = (iso) => () => {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const now = new Date();
  const sameDay = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
  return sameDay ? `${pad(at.getHours())}:${pad(at.getMinutes())}` : `${pad(at.getMonth() + 1)}/${pad(at.getDate())}`;
};

export const focusByIdImpl = (id) => () => {
  const element = document.getElementById(id);
  if (element) element.focus();
};

// モーダルの中で Tab / Shift+Tab を循環させる (最後の要素の次は最初へ、最初の前は最後へ)
export const trapFocusImpl = (event) => () => {
  if (event.key !== "Tab") return;
  // Flame はイベントを root に委譲するので、currentTarget ではなく target から dialog を辿る
  const dialog = event.target instanceof Element ? event.target.closest("[role=\"dialog\"]") : null;
  if (!dialog) return;
  const focusable = Array.from(dialog.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"))
    .filter((element) => !element.disabled && element.offsetParent !== null);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
};

export const eventKeyImpl = (event) => (typeof event.key === "string" ? event.key : "");
