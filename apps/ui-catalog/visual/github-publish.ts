import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  attachmentComments, captureRevisionsSchema, invocationMarker, partMarker, publicationSchema, REPORT_MARKER,
} from "./attachments.ts";
import type { Publication } from "./attachments.ts";
import { PNG_LIMITS } from "./sanitize.ts";

export interface GhResult { code: number; stdout: string; stderr: string }
export type GhRunner = (args: string[], input?: string) => Promise<GhResult>;
export class StaleReportError extends Error {}

const actorSchema = z.object({ id: z.number().int().positive(), login: z.string().min(1) });
const commentSchema = z.object({
  id: z.number().int().positive(), body: z.string(), user: actorSchema.nullable(),
});
type Comment = z.infer<typeof commentSchema>;
const prSchema = z.object({
  state: z.string(),
  head: z.object({ sha: z.string(), repo: z.object({ full_name: z.string() }).nullable() }),
  base: z.object({ sha: z.string(), ref: z.string(), repo: z.object({ full_name: z.string() }) }),
});

function failure(result: GhResult): Error {
  return new Error(`gh failed (${result.code}): ${result.stderr.trim().slice(0, 2000) || "no error details"}`);
}

/** Fresh comments are published first. Old report comments are retired only after every upload succeeds. */
export async function publishToGitHub(input: unknown, publication: Publication, gh: GhRunner): Promise<void> {
  const p = publicationSchema.parse(publication);
  const chunks = attachmentComments(input, p);
  const marker = invocationMarker(p);
  const endpoint = `repos/${p.repo}`;
  const call = async (args: string[], body?: string): Promise<string> => {
    const result = await gh(args, body);
    if (result.code !== 0) throw failure(result);
    return result.stdout;
  };
  const actor = actorSchema.parse(JSON.parse(await call(["api", "user"])));
  const comments = async (): Promise<Comment[]> => {
    const json: unknown = JSON.parse(await call(["api", `${endpoint}/issues/${p.pr}/comments?per_page=100`, "--paginate", "--slurp"]));
    return z.array(z.array(commentSchema)).parse(json).flat();
  };
  const ownedReport = (comment: Comment) => comment.user?.id === actor.id && comment.body.startsWith(`${REPORT_MARKER}\n`);
  const ownedNew = (comment: Comment) => ownedReport(comment) && comment.body.includes(`\n${marker}\n`);
  const fresh = async () => {
    const pr = prSchema.parse(JSON.parse(await call(["api", `${endpoint}/pulls/${p.pr}`])));
    const main = z.object({ object: z.object({ sha: z.string() }) }).parse(
      JSON.parse(await call(["api", `${endpoint}/git/ref/heads/main`])),
    );
    if (pr.state !== "open" || pr.head.sha !== p.head || main.object.sha !== p.base ||
      pr.base.ref !== "main" || pr.base.repo.full_name.toLowerCase() !== p.repo.toLowerCase() ||
      pr.head.repo?.full_name.toLowerCase() !== p.repo.toLowerCase()) {
      throw new StaleReportError("Visual report is stale: PR must be open, from this repository, and match the captured head and current main");
    }
  };
  const remove = (comment: Comment) => call(["api", "--method", "DELETE", `${endpoint}/issues/comments/${comment.id}`]);
  await fresh();
  const old = (await comments()).filter(ownedReport);
  let uploadsStarted = false;
  let retiringOld = false;
  try {
    for (const chunk of chunks) {
      await fresh();
      uploadsStarted = true;
      // Body goes through stdin and every attachment is a separate argument: no shell evaluation.
      await call([
        "pr", "comment", p.pr, "--repo", p.repo, "--body-file", "-",
        ...chunk.files.flatMap((file) => ["--attach", file]),
      ], chunk.body);
      await fresh();
    }
    const created = (await comments()).filter(ownedNew);
    if (created.length !== chunks.length || !chunks.every((_, index) =>
      created.filter((comment) => comment.body.includes(partMarker(index + 1, chunks.length))).length === 1)) {
      throw new Error("Could not verify all newly published visual report comments");
    }
    await fresh();
    retiringOld = true;
    for (const comment of old) {
      await fresh();
      await remove(comment);
    }
    await fresh();
  } catch (error) {
    // gh can create a comment before returning nonzero (for example an upload failure).
    // Rediscover by this invocation's nonce; never rely on its exit status or delete-last.
    if (uploadsStarted && (!retiringOld || error instanceof StaleReportError)) {
      try {
        const partial = (await comments()).filter(ownedNew);
        for (const comment of partial) await remove(comment);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Visual publication failed; cleanup of this attempt also failed. Only this invocation's comments were selected for rollback.");
      }
    }
    if (retiringOld && !(error instanceof StaleReportError)) {
      throw new Error("New visual report is published, but retiring old comments failed; the new report was preserved", { cause: error });
    }
    throw error;
  }
}

export function realGhRunner(root: string): GhRunner {
  return async (args, input) => {
    const child = Bun.spawn(["gh", ...args], {
      cwd: root, stdin: input === undefined ? "ignore" : new Blob([input]), stdout: "pipe", stderr: "pipe",
      env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_HOST: "github.com" },
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    return { code, stdout, stderr };
  };
}

async function readTrustedResult(root: string, publication: Publication): Promise<unknown> {
  const resultPath = resolve(root, "result.json");
  const stat = await lstat(resultPath);
  if (!stat.isFile() || stat.size > 256 * 1024) throw new Error("Invalid comparison result file");
  const result: unknown = await Bun.file(resultPath).json();
  const chunks = attachmentComments(result, publication);
  if (!(await lstat(root)).isDirectory() || !(await lstat(resolve(root, "report"))).isDirectory()) {
    throw new Error("Visual report must use real directories");
  }
  for (const file of new Set(chunks.flatMap((chunk) => chunk.files))) {
    const side = file.split("/")[2];
    if (!side || !(await lstat(resolve(root, "report", side))).isDirectory()) throw new Error("Invalid report image directory");
    const info = await lstat(resolve(root, file));
    if (!info.isFile() || info.size === 0 || info.size > PNG_LIMITS.fileBytes) throw new Error(`Invalid report image: ${file}`);
  }
  return result;
}

if (import.meta.main) {
  if (!process.env.GH_TOKEN) throw new Error("VISUAL_DIFF_GH_TOKEN is not configured: gh --attach requires a PAT with repository write access");
  let base = process.env.VISUAL_BASE_REVISION;
  if (process.env.VISUAL_REVISIONS_FILE) {
    const evidenceFile = resolve(process.env.VISUAL_REVISIONS_FILE);
    const evidenceStat = await lstat(evidenceFile);
    if (!evidenceStat.isFile() || evidenceStat.size > 4096) throw new Error("Invalid capture revision evidence file");
    const evidence = captureRevisionsSchema.parse(await Bun.file(evidenceFile).json());
    if (evidence.head !== process.env.VISUAL_REVISION) throw new Error("Capture evidence does not match workflow run head");
    base = evidence.base;
  }
  const p = publicationSchema.parse({
    repo: process.env.GH_REPO, pr: process.env.PR_NUMBER,
    head: process.env.VISUAL_REVISION, base,
    runId: process.env.VISUAL_RUN_ID, runAttempt: process.env.VISUAL_RUN_ATTEMPT,
    invocation: randomUUID(),
  });
  const root = resolve(process.env.VISUAL_DIR ?? ".visual");
  const result = await readTrustedResult(root, p);
  await publishToGitHub(result, p, realGhRunner(root));
  console.info("Frontend visual diff attached to PR.");
}
