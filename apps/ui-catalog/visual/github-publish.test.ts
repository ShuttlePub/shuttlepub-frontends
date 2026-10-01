import { expect, test } from "bun:test";
import { invocationMarker, REPORT_MARKER } from "./attachments.ts";
import type { Publication } from "./attachments.ts";
import { publishToGitHub, StaleReportError } from "./github-publish.ts";
import type { GhRunner } from "./github-publish.ts";

const publication: Publication = {
  repo: "ShuttlePub/shuttlepub-frontends", pr: "42", head: "a".repeat(40), base: "b".repeat(40),
  runId: "12345", runAttempt: "2", invocation: "c7657185-5e44-4a2f-b014-4d274901f05c",
};
const result = { failedItems: ["changed.png"], newItems: ["added.png"], deletedItems: ["gone.png"], passedItems: ["same.png"] };
type StoredComment = { id: number; body: string; user: { id: number; login: string } };

function fakeGitHub(options: {
  failedUpload?: number; partialOnFailure?: boolean; staleAfterUpload?: number;
  deleteFails?: boolean; advanceMainOnCheck?: number; concurrentReport?: boolean;
} = {}) {
  const actor = { id: 7, login: "visual-bot" };
  let comments: StoredComment[] = [
    { id: 1, body: `${REPORT_MARKER}\nOld report`, user: actor },
    { id: 2, body: "An unrelated discussion", user: actor },
    { id: 3, body: `${REPORT_MARKER}\nSomeone else's report`, user: { id: 8, login: "someone" } },
  ];
  let uploads = 0;
  let nextId = 100;
  let checks = 0;
  const calls: { args: string[]; input?: string }[] = [];
  const pr = {
    state: "open", head: { sha: publication.head, repo: { full_name: publication.repo } },
    base: { sha: publication.base, ref: "main", repo: { full_name: publication.repo } },
  };
  let main = publication.base;
  const run: GhRunner = async (args, input) => {
    calls.push(input === undefined ? { args } : { args, input });
    const ok = (value: unknown) => ({ code: 0, stdout: JSON.stringify(value), stderr: "" });
    if (args[0] === "pr") {
      uploads++;
      expect(args.slice(0, 7)).toEqual(["pr", "comment", "42", "--repo", publication.repo, "--body-file", "-"]);
      const failed = uploads === options.failedUpload;
      if (!failed || options.partialOnFailure) comments.push({ id: nextId++, body: input!, user: actor });
      if (options.concurrentReport && uploads === 1) comments.push({ id: 500, body: `${REPORT_MARKER}\nConcurrent report`, user: actor });
      if (uploads === options.staleAfterUpload) pr.head.sha = "c".repeat(40);
      return failed ? { code: 1, stdout: "", stderr: "Upload failed after request" } : ok("comment URL");
    }
    if (args[1] === "user") return ok(actor);
    if (args.includes("DELETE")) {
      if (options.deleteFails) return { code: 1, stdout: "", stderr: "Delete forbidden" };
      const id = Number(args.at(-1)!.split("/").at(-1));
      comments = comments.filter((comment) => comment.id !== id);
      return ok(null);
    }
    if (args[1]?.endsWith("/pulls/42")) {
      if (++checks === options.advanceMainOnCheck) main = "d".repeat(40);
      return ok(pr);
    }
    if (args[1]?.endsWith("/git/ref/heads/main")) return ok({ object: { sha: main } });
    if (args[1]?.endsWith("comments?per_page=100")) {
      expect(args.slice(-2)).toEqual(["--paginate", "--slurp"]);
      return ok([comments.slice(0, 2), comments.slice(2)]);
    }
    throw new Error(`Unexpected gh call: ${args.join(" ")}`);
  };
  return { run, calls, comments: () => comments, pr, advanceMain: () => { main = "d".repeat(40); } };
}

test("publishes safe attachment args then deletes only the authenticated actor's prior report", async () => {
  const gh = fakeGitHub();
  await publishToGitHub(result, publication, gh.run);
  expect(gh.comments().map((comment) => comment.id)).toEqual([2, 3, 100]);
  const post = gh.calls.find((call) => call.args[0] === "pr")!;
  expect(post.args.slice(7)).toEqual([
    "--attach", "./report/expected/changed.png", "--attach", "./report/actual/changed.png", "--attach", "./report/diff/changed.png",
    "--attach", "./report/actual/added.png", "--attach", "./report/expected/gone.png",
  ]);
  expect(post.args).not.toContain("--edit-last");
  expect(post.input).toContain(invocationMarker(publication));
  expect(gh.calls.findIndex((call) => call.args.includes("DELETE"))).toBeGreaterThan(gh.calls.indexOf(post));
});

test("keeps old reports and rolls back all new chunks when gh partially creates a comment before failing", async () => {
  const gh = fakeGitHub({ failedUpload: 2, partialOnFailure: true });
  const many = { ...result, failedItems: Array.from({ length: 20 }, (_, i) => `changed-${i}.png`) };
  await expect(publishToGitHub(many, publication, gh.run)).rejects.toThrow("Upload failed");
  expect(gh.comments().map((comment) => comment.id)).toEqual([1, 2, 3]);
  expect(gh.calls.filter((call) => call.args.includes("DELETE")).map((call) => call.args.at(-1))).toEqual([
    `repos/${publication.repo}/issues/comments/100`, `repos/${publication.repo}/issues/comments/101`,
  ]);
});

test("rolls back only this invocation after head changes during upload", async () => {
  const gh = fakeGitHub({ staleAfterUpload: 1 });
  await expect(publishToGitHub(result, publication, gh.run)).rejects.toBeInstanceOf(StaleReportError);
  expect(gh.comments().map((comment) => comment.id)).toEqual([1, 2, 3]);
});

test("checks main again after all chunks are verified and preserves concurrent reports on rollback", async () => {
  const gh = fakeGitHub({ advanceMainOnCheck: 4, concurrentReport: true });
  await expect(publishToGitHub(result, publication, gh.run)).rejects.toBeInstanceOf(StaleReportError);
  expect(gh.comments().map((comment) => comment.id)).toEqual([1, 2, 3, 500]);
});

test("rejects closed/forked/non-main/stale PRs before posting", async () => {
  const changes = [
    (gh: ReturnType<typeof fakeGitHub>) => { gh.pr.state = "closed"; },
    (gh: ReturnType<typeof fakeGitHub>) => { gh.pr.head.repo.full_name = "fork/repo"; },
    (gh: ReturnType<typeof fakeGitHub>) => { gh.pr.base.ref = "release"; },
    (gh: ReturnType<typeof fakeGitHub>) => gh.advanceMain(),
  ];
  for (const change of changes) {
    const gh = fakeGitHub();
    change(gh);
    await expect(publishToGitHub(result, publication, gh.run)).rejects.toBeInstanceOf(StaleReportError);
    expect(gh.calls.some((call) => call.args[0] === "pr")).toBe(false);
  }
});

test("uses captured live main even when the PR's historical base SHA differs", async () => {
  const gh = fakeGitHub();
  gh.pr.base.sha = "c".repeat(40);
  await publishToGitHub(result, publication, gh.run);
  expect(gh.comments().map((comment) => comment.id)).toEqual([2, 3, 100]);
});

test("preserves a complete new report when retiring an old comment fails", async () => {
  const gh = fakeGitHub({ deleteFails: true });
  await expect(publishToGitHub(result, publication, gh.run)).rejects.toThrow("new report was preserved");
  expect(gh.comments().map((comment) => comment.id)).toEqual([1, 2, 3, 100]);
});

test("publishes a no-difference summary without attachments and replaces the previous report", async () => {
  const gh = fakeGitHub();
  await publishToGitHub({ failedItems: [], newItems: [], deletedItems: [], passedItems: ["same.png"] }, publication, gh.run);
  const call = gh.calls.find((call) => call.args[0] === "pr")!;
  expect(call.args).not.toContain("--attach");
  expect(call.input).toContain("No visual changes detected.");
  expect(gh.comments().map((comment) => comment.id)).toEqual([2, 3, 100]);
});
