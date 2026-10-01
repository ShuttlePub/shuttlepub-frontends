import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { PNG_LIMITS, pngDimensions, sanitizeCaptures } from "./sanitize.ts";

async function fixture(fn: (dirs: { actual: string; expected: string; output: string }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "visual-sanitize-test-"));
  const dirs = { actual: join(root, "raw-actual"), expected: join(root, "raw-expected"), output: join(root, "trusted") };
  try {
    for (const side of [dirs.actual, dirs.expected]) {
      await mkdir(side);
      await Bun.write(join(side, "screen.png"), png());
    }
    await fn(dirs);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
function png() {
  const image = new PNG({ width: 2, height: 2 });
  image.data.fill(255);
  image.gamma = 0.45455;
  return PNG.sync.write(image);
}

test("re-encodes only pixels into a separate trusted tree, removing metadata and trailing payloads", async () => {
  await fixture(async (dirs) => {
    const original = png();
    await Bun.write(join(dirs.actual, "screen.png"), Buffer.concat([original, Buffer.from("<script>untrusted</script>")]));
    await sanitizeCaptures(dirs);
    const bytes = Buffer.from(await Bun.file(join(dirs.output, "actual/screen.png")).bytes());
    expect(bytes.includes(Buffer.from("untrusted"))).toBe(false);
    expect(bytes.includes(Buffer.from("gAMA"))).toBe(false);
    expect(PNG.sync.read(bytes).data).toEqual(PNG.sync.read(original).data);
    expect(await readdir(dirs.output)).toEqual(["actual", "expected"]);
  });
});

test("rejects links, nested directories, and incoming report/code files", async () => {
  for (const unsafe of ["link", "directory", "json", "html", "js"]) {
    await fixture(async (dirs) => {
      if (unsafe === "link") await symlink(join(dirs.expected, "screen.png"), join(dirs.actual, "link.png"));
      else if (unsafe === "directory") await mkdir(join(dirs.actual, "nested.png"));
      else await Bun.write(join(dirs.actual, `report.${unsafe}`), "untrusted");
      await expect(sanitizeCaptures(dirs)).rejects.toThrow();
      expect(await Bun.file(join(dirs.output, "actual/screen.png")).exists()).toBe(false);
    });
  }
});

test("rejects empty inputs and output overlap without modifying the source", async () => {
  await fixture(async (dirs) => {
    await rm(join(dirs.expected, "screen.png"));
    await expect(sanitizeCaptures(dirs)).rejects.toThrow("image count");
    await expect(sanitizeCaptures({ ...dirs, output: dirs.actual })).rejects.toThrow("separate");
    expect(await Bun.file(join(dirs.actual, "screen.png")).exists()).toBe(true);
  });
});

test("enforces file/count/aggregate limits", async () => {
  for (const override of [{ filesPerSide: 0 }, { fileBytes: 40 }, { totalBytes: 40 }, { totalPixels: 4 }]) {
    await fixture(async (dirs) => {
      await expect(sanitizeCaptures(dirs, { ...PNG_LIMITS, ...override })).rejects.toThrow();
    });
  }
});

test("rejects oversized dimensions and interlace before decoding even an invalid CRC", () => {
  const header = png().subarray(0, 33);
  header.writeUInt32BE(0xffff_ffff, 16);
  expect(() => pngDimensions(header)).toThrow("dimensions");
  header.writeUInt32BE(2, 16);
  header[28] = 1;
  expect(() => pngDimensions(header)).toThrow("Interlaced");
});

test("rejects corrupt compressed data and duplicate IHDR chunks", async () => {
  await fixture(async (dirs) => {
    const original = png();
    const duplicate = Buffer.concat([original.subarray(0, 33), original.subarray(8)]);
    await Bun.write(join(dirs.actual, "screen.png"), duplicate);
    await expect(sanitizeCaptures(dirs)).rejects.toThrow("Duplicate PNG header");
    original[original.length - 1] = original[original.length - 1]! ^ 0xff;
    await Bun.write(join(dirs.actual, "screen.png"), original);
    await expect(sanitizeCaptures(dirs)).rejects.toThrow();
  });
});
