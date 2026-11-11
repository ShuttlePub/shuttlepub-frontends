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
