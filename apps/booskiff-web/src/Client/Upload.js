// A session-scoped serial queue. Only serializable snapshots cross the FFI.
// File objects are retained solely while queued, sending, or safely retryable.
let generation = 0;
let sequence = 0;
let jobs = [];
let active = null;
let onChange = null;
let onCommit = null;
let limit = 0;
let removeListeners = null;
const pending = (job) => ["queued", "sending", "saving"].includes(job.status);
const snapshot = (job) => ({
  id: job.id, name: job.name, destinationId: job.destinationId,
  destinationName: job.destinationName, status: job.status,
  loaded: job.loaded, total: job.total, error: job.error, retryable: job.retryable,
});
const emit = () => onChange?.(jobs.map(snapshot))();
const message = (body, status) => {
  try {
    const error = JSON.parse(body).error;
    if (error?.code === "payload_too_large") return "ファイルのサイズ上限を超えています (size limit)";
    if (error?.code === "insufficient_storage") return "ストレージ容量が不足しています";
    if (status === 401) return "認証が切れました。再度ログインしてください";
    return error?.message || `アップロードが拒否されました (HTTP ${status})`;
  } catch { return `アップロードが拒否されました (HTTP ${status})`; }
};
function pump() {
  if (active || !onChange) return;
  const job = jobs.find((candidate) => candidate.status === "queued");
  if (!job) return;
  const epoch = generation;
  const xhr = new XMLHttpRequest();
  active = xhr;
  job.status = "sending";
  emit();
  const params = new URLSearchParams({ name: job.name });
  if (job.file.type) params.set("mime", job.file.type);
  if (job.destinationId) params.set("folder_id", job.destinationId);
  const current = () => epoch === generation && active === xhr;
  const finish = (status, error = "", retryable = false) => {
    if (!current()) return;
    job.status = status;
    job.error = error;
    job.retryable = retryable;
    if (!retryable) job.file = null;
    active = null;
    emit();
    pump();
  };
  xhr.open("POST", `/api/files?${params}`);
  xhr.responseType = "text";
  xhr.setRequestHeader("Content-Type", job.file.type || "application/octet-stream");
  xhr.upload.onprogress = (event) => {
    if (!current()) return;
    job.loaded = event.loaded;
    if (event.lengthComputable) job.total = event.total;
    if (event.lengthComputable && event.loaded >= event.total) job.status = "saving";
    emit();
  };
  xhr.upload.onload = () => {
    if (!current()) return;
    job.loaded = job.total;
    job.status = "saving";
    emit();
  };
  xhr.onload = () => {
    if (!current()) return;
    if (xhr.status >= 200 && xhr.status < 300) {
      // An unreadable successful response could already have persisted the file.
      // Never offer a blind retry for an ambiguous result.
      try {
        const file = JSON.parse(xhr.responseText);
        if (!file || typeof file.id !== "string" || !file.id || typeof file.name !== "string"
          || typeof file.mimeType !== "string" || typeof file.sizeBytes !== "number" || !Number.isFinite(file.sizeBytes)
          || file.sizeBytes < 0 || typeof file.isPublic !== "boolean" || typeof file.createdAt !== "string"
          || (file.folderId != null && typeof file.folderId !== "string")) throw new Error("invalid file");
        job.loaded = job.total;
        onCommit?.(xhr.responseText)();
        finish("completed");
      } catch { finish("uncertain", "保存結果を確認できません。保存先を開き、再送前にファイルを確認してください"); }
    } else if ([400, 401, 403, 404, 409, 413, 415, 422, 429, 507].includes(xhr.status)) {
      finish("failed", message(xhr.responseText, xhr.status), [409, 429, 507].includes(xhr.status));
    } else {
      finish("uncertain", "保存結果を確認できません。保存先を開き、再送前にファイルを確認してください");
    }
  };
  xhr.onerror = () => finish("uncertain", "通信が途切れました。保存先を開き、再送前にファイルを確認してください");
  xhr.onabort = () => finish("uncertain", "送信が中断されました。保存先で結果を確認してください");
  try { xhr.send(job.file); }
  catch { finish("failed", "ファイルを送信できませんでした。もう一度選択してください"); }
}
function enqueue(files, destinationId, destinationName) {
  if (!onChange) return;
  for (const file of files) {
    if (!(file instanceof File)) continue;
    const tooLarge = limit > 0 && file.size > limit;
    jobs.push({ id: `upload-${++sequence}`, name: file.name, file: tooLarge ? null : file,
      destinationId, destinationName, loaded: 0, total: file.size,
      status: tooLarge ? "failed" : "queued", retryable: false,
      error: tooLarge ? "ファイルのサイズ上限を超えています (size limit)" : "" });
  }
  emit();
  pump();
}
export const initializeImpl = (change) => (commit) => () => {
  onChange = change;
  onCommit = commit;
  if (removeListeners) return;
  const beforeUnload = (event) => {
    if (!jobs.some(pending)) return;
    event.preventDefault();
    event.returnValue = "";
  };
  const dragOver = (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    const zone = event.target.closest?.("[data-upload-dropzone]");
    document.querySelectorAll(".is-dragging").forEach((node) => { if (node !== zone) node.classList.remove("is-dragging"); });
    zone?.classList.add("is-dragging");
    event.dataTransfer.dropEffect = zone ? "copy" : "none";
  };
  const dragLeave = (event) => {
    const zone = event.target.closest?.("[data-upload-dropzone]");
    if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove("is-dragging");
  };
  const drop = (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    document.querySelectorAll(".is-dragging").forEach((node) => node.classList.remove("is-dragging"));
    const zone = event.target.closest?.("[data-upload-dropzone]");
    if (!zone) return;
    // Browsers expose directories inconsistently; do not turn them into empty files.
    const files = Array.from(event.dataTransfer.items || []).filter((item) => item.kind === "file")
      .filter((item) => !item.webkitGetAsEntry?.()?.isDirectory).map((item) => item.getAsFile()).filter(Boolean);
    enqueue(files, zone.dataset.folderId || "", zone.dataset.folderName || "マイドライブ");
  };
  window.addEventListener("beforeunload", beforeUnload);
  document.addEventListener("dragover", dragOver);
  document.addEventListener("dragleave", dragLeave);
  document.addEventListener("drop", drop);
  removeListeners = () => {
    window.removeEventListener("beforeunload", beforeUnload);
    document.removeEventListener("dragover", dragOver);
    document.removeEventListener("dragleave", dragLeave);
    document.removeEventListener("drop", drop);
  };
};
export const configureLimit = (bytes) => () => { limit = bytes; };
export const chooseFiles = () => document.querySelector("[data-testid='upload-input']")?.click();
export const enqueueInput = () => {
  const input = document.querySelector("[data-testid='upload-input']");
  if (!input) return;
  enqueue(Array.from(input.files || []), input.dataset.folderId || "", input.dataset.folderName || "マイドライブ");
  input.value = "";
};
export const retry = (id) => () => {
  const job = jobs.find((candidate) => candidate.id === id);
  if (!job?.retryable || !job.file || job.status !== "failed") return;
  job.status = "queued";
  job.loaded = 0;
  job.error = "";
  job.retryable = false;
  emit();
  pump();
};
export const clearFinished = () => {
  jobs = jobs.filter((job) => pending(job) || job.status === "failed" || job.status === "uncertain");
  emit();
};
export const dismiss = (id) => () => {
  // History-only removal; queued and active transfers cannot be cancelled here.
  jobs = jobs.filter((job) => job.id !== id || pending(job));
  emit();
};
export const reset = () => {
  generation++;
  const xhr = active;
  active = null;
  jobs = [];
  onChange = null;
  onCommit = null;
  limit = 0;
  xhr?.abort();
  removeListeners?.();
  removeListeners = null;
};
export const confirmAction = (text) => () => window.confirm(text);
export const confirmLogout = () => !jobs.some(pending) || window.confirm("転送が進行中です。ログアウトすると待機中の転送は破棄され、送信中の保存結果が確認できなくなることがあります。ログアウトしますか？");
