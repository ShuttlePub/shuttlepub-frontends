import type { BillingStatus, FileItem, Folder } from "../../../booskiff-web/bff/booskiff/client.ts";

// Typed against the real BFF DTOs. The stub converts these to the snake_case
// Core HTTP contract; contract tests exercise the production REST client.
export const FILES = [
  { id: "file-design", name: "design-notes.pdf", mimeType: "application/pdf", sizeBytes: 262144, folderId: "folder-projects", isPublic: false, createdAt: "2026-01-10T09:30:00Z" },
  { id: "file-cover", name: "project-cover.png", mimeType: "image/png", sizeBytes: 1048576, folderId: "folder-projects", isPublic: true, createdAt: "2026-01-11T14:00:00Z" },
  { id: "file-readme", name: "README.txt", mimeType: "text/plain", sizeBytes: 2048, folderId: null, isPublic: false, createdAt: "2026-01-12T08:15:00Z" },
] as const satisfies readonly FileItem[];

export const FOLDERS = [
  { id: "folder-projects", name: "Projects", parentId: null, createdAt: "2026-01-08T10:00:00Z" },
  { id: "folder-archive", name: "Archive", parentId: null, createdAt: "2026-01-09T10:00:00Z" },
] as const satisfies readonly Folder[];

export const BILLING = {
  usedBytes: FILES.reduce((sum, file) => sum + file.sizeBytes, 0),
  storageQuotaBytes: 10737418240,
  maxFileBytes: 104857600,
  rateLimitRpm: 120,
} satisfies BillingStatus;

export const AVATAR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><rect width="80" height="80" rx="18" fill="#b4befe"/><circle cx="40" cy="30" r="14" fill="#313244"/><path d="M14 74c0-20 12-29 26-29s26 9 26 29" fill="#313244"/></svg>';
export const BANNER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="200" viewBox="0 0 800 200"><rect width="800" height="200" fill="#313244"/><circle cx="130" cy="190" r="160" fill="#585b70"/><circle cx="660" cy="30" r="160" fill="#b4befe"/><path d="M0 170L280 50l270 150H0" fill="#89b4fa"/></svg>';

/** Only the checked-in Emumet mock profile images may bypass the network. */
export function localImage(url: string): string | undefined {
  const parsed = new URL(url);
  if (parsed.origin === "https://api.dicebear.com" && parsed.pathname === "/9.x/thumbs/svg"
    && ["alice", "bob", "bot"].includes(parsed.searchParams.get("seed") ?? "")
    && [...parsed.searchParams.keys()].every((key) => key === "seed")) return AVATAR_SVG;
  if (url === "https://picsum.photos/seed/alice/800/200") return BANNER_SVG;
  return undefined;
}
