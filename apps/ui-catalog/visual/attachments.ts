import { z } from "zod";
import { resultSchema } from "./report.ts";

export const REPORT_MARKER = "<!-- frontend-visual-diff -->";
export const MAX_ATTACHMENTS = 50;
export const MAX_COMMENT_BYTES = 60_000;

export const captureRevisionsSchema = z.object({
  version: z.literal(1),
  head: z.string().regex(/^[a-f0-9]{40}$/),
  base: z.string().regex(/^[a-f0-9]{40}$/),
}).strict();

export const publicationSchema = z.object({
  repo: z.string().max(200).regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  pr: z.string().max(20).regex(/^[1-9][0-9]*$/),
  head: z.string().regex(/^[a-f0-9]{40}$/),
  base: z.string().regex(/^[a-f0-9]{40}$/),
  runId: z.string().max(20).regex(/^[1-9][0-9]*$/),
  runAttempt: z.string().max(20).regex(/^[1-9][0-9]*$/),
  invocation: z.string().uuid(),
}).strict();
export type Publication = z.infer<typeof publicationSchema>;
export interface AttachmentComment { body: string; files: string[] }

export function invocationMarker(publication: Publication): string {
  const p = publicationSchema.parse(publication);
  return `<!-- frontend-visual-diff-run:${p.runId}:${p.runAttempt}:${p.invocation} -->`;
}

export function partMarker(part: number, total: number): string {
  return `<!-- frontend-visual-diff-part:${part}/${total} -->`;
}

/** Only trusted comparison output is accepted; artifact-provided text is never rendered. */
export function attachmentComments(input: unknown, publication: Publication): AttachmentComment[] {
  const result = resultSchema.parse(input);
  const p = publicationSchema.parse(publication);
  const items = Object.values(result).flat();
  if (items.length > 500 || items.some((name) => name.length > 180) || new Set(items).size !== items.length) {
    throw new Error("Invalid or excessive visual result items");
  }
  const header = [
    REPORT_MARKER, invocationMarker(p), "## Frontend visual diff",
    `Head: \`${p.head}\` · Main: \`${p.base}\``,
    `[Workflow run ${p.runId}, attempt ${p.runAttempt}](https://github.com/${p.repo}/actions/runs/${p.runId}/attempts/${p.runAttempt})`,
    `Changed: ${result.failedItems.length} / New: ${result.newItems.length} / Deleted: ${result.deletedItems.length} / Passed: ${result.passedItems.length}`,
  ].join("\n\n");
  const rows: AttachmentComment[] = [];
  for (const name of [...result.failedItems].sort()) {
    const files = ["expected", "actual", "diff"].map((side) => `./report/${side}/${name}`);
    rows.push({
      body: `### ${name}\n\n| Main | PR | Difference |\n| --- | --- | --- |\n| ![Main](${files[0]}) | ![PR](${files[1]}) | ![Difference](${files[2]}) |`, files,
    });
  }
  for (const [label, side, names] of [
    ["New", "actual", result.newItems], ["Deleted", "expected", result.deletedItems],
  ] as const) {
    for (const name of [...names].sort()) {
      const file = `./report/${side}/${name}`;
      rows.push({ body: `### ${label}: ${name}\n\n![${label === "New" ? "PR" : "Main"}](${file})`, files: [file] });
    }
  }
  const chunks: AttachmentComment[] = [];
  let chunk: AttachmentComment = { body: header, files: [] };
  // Reserve room for part marker/title (the total is unknown until all chunks exist).
  const fits = (row: AttachmentComment) => chunk.files.length + row.files.length <= MAX_ATTACHMENTS &&
    Buffer.byteLength(`${chunk.body}\n\n${row.body}`) <= MAX_COMMENT_BYTES - 150;
  for (const row of rows) {
    if (!fits(row)) {
      if (chunk.files.length === 0) throw new Error("Visual result row exceeds comment limits");
      chunks.push(chunk);
      chunk = { body: header, files: [] };
      if (!fits(row)) throw new Error("Visual result row exceeds comment limits");
    }
    chunk.body += `\n\n${row.body}`;
    chunk.files.push(...row.files);
  }
  if (rows.length === 0) chunk.body += "\n\nNo visual changes detected.";
  chunks.push(chunk);
  return chunks.map((item, index) => ({
    ...item, body: `${item.body}\n\n${partMarker(index + 1, chunks.length)}\nPart ${index + 1}/${chunks.length}`,
  }));
}
