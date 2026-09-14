import { z } from "zod";

export const imageName = z.string().regex(/^[A-Za-z0-9-]+\.png$/);
export const resultSchema = z.object({
  failedItems: z.array(imageName), newItems: z.array(imageName),
  deletedItems: z.array(imageName), passedItems: z.array(imageName),
});
export type VisualResult = z.infer<typeof resultSchema>;

export function commentBody(result: VisualResult, reportRoot: string, revision: string): string {
  const lines = [
    "<!-- ui-catalog-visual-diff -->", "## UI catalog visual diff", `Revision: \`${revision}\``,
    `Changed: ${result.failedItems.length} / New: ${result.newItems.length} / Deleted: ${result.deletedItems.length} / Passed: ${result.passedItems.length}`,
    `[HTML report](${reportRoot}/index.html) · Images expire after 30 days.`,
  ];
  for (const name of result.failedItems) {
    lines.push(`### ${name}`, `![expected](${reportRoot}/expected/${name})`, `![actual](${reportRoot}/actual/${name})`, `![diff](${reportRoot}/diff/${name})`);
  }
  for (const name of result.newItems) lines.push(`### New: ${name}`, `![actual](${reportRoot}/actual/${name})`);
  for (const name of result.deletedItems) lines.push(`### Deleted: ${name}`, `![expected](${reportRoot}/expected/${name})`);
  return lines.join("\n\n");
}
