import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { PNG } from "pngjs";
import { imageName } from "./report.ts";

export const PNG_LIMITS = {
  filesPerSide: 250,
  fileBytes: 10 * 1024 * 1024,
  totalBytes: 256 * 1024 * 1024,
  dimension: 16_384,
  pixels: 25_000_000,
  totalPixels: 500_000_000,
} as const;
type Limits = { [K in keyof typeof PNG_LIMITS]: number };
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Inspect IHDR before allowing pngjs to allocate or inflate image data. */
export function pngDimensions(header: Buffer, limits: Limits = PNG_LIMITS): { width: number; height: number } {
  if (header.length < 33 || !header.subarray(0, 8).equals(signature) ||
    header.readUInt32BE(8) !== 13 || header.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("Invalid PNG header");
  }
  const width = header.readUInt32BE(16);
  const height = header.readUInt32BE(20);
  // pngjs bounds inflation for ordinary screenshots, but not interlaced PNGs.
  if (header[28] !== 0) throw new Error("Interlaced PNG captures are not supported");
  if (!width || !height || width > limits.dimension || height > limits.dimension || width * height > limits.pixels) {
    throw new Error(`PNG dimensions exceed limits: ${width}x${height}`);
  }
  return { width, height };
}

function validateChunks(bytes: Buffer): number {
  let offset = 8;
  let chunks = 0;
  let hasPalette = false;
  while (offset < bytes.length) {
    if (++chunks > 4096) throw new Error("Excessive PNG chunk count");
    if (offset + 12 > bytes.length) throw new Error("Truncated PNG chunk");
    const size = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (offset + size + 12 > bytes.length) throw new Error("Truncated PNG chunk");
    if (type === "IHDR" && offset !== 8) throw new Error("Duplicate PNG header");
    if (type === "PLTE") {
      if (hasPalette || size === 0 || size > 768 || size % 3 !== 0) throw new Error("Invalid PNG palette");
      hasPalette = true;
    }
    if (type === "tRNS" && size > 256) throw new Error("Excessive PNG transparency metadata");
    if (type === "gAMA" && size !== 4) throw new Error("Invalid PNG gamma metadata");
    offset += size + 12;
    if (type === "IEND") {
      if (size !== 0) throw new Error("Invalid PNG end chunk");
      return offset; // Any trailing bytes are removed on re-encoding.
    }
  }
  throw new Error("Missing PNG end chunk");
}

function contains(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !path.startsWith(sep));
}

/** Copy only decoded PNG pixels to a new directory. Never trust artifact code or reports. */
export async function sanitizeCaptures(options: {
  actual: string; expected: string; output: string;
}, limits: Limits = PNG_LIMITS): Promise<void> {
  const output = resolve(options.output);
  const inputs = { actual: resolve(options.actual), expected: resolve(options.expected) };
  for (const input of Object.values(inputs)) {
    if (contains(input, output) || contains(output, input)) throw new Error("Sanitized output must be separate from inputs");
    if (!(await lstat(input)).isDirectory()) throw new Error("Capture input must be a real directory");
  }
  try {
    await lstat(output);
    throw new Error("Sanitized output already exists");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(dirname(output), { recursive: true });
  const staging = await mkdtemp(join(dirname(output), ".visual-sanitize-"));
  let totalBytes = 0;
  let outputBytes = 0;
  let totalPixels = 0;
  try {
    for (const side of ["actual", "expected"] as const) {
      const entries = (await readdir(inputs[side], { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"));
      if (!entries.length || entries.length > limits.filesPerSide) throw new Error(`Invalid ${side} image count: ${entries.length}`);
      await mkdir(join(staging, side));
      for (const entry of entries) {
        imageName.parse(entry.name);
        if (entry.name.length > 180 || !entry.isFile()) throw new Error(`Unsafe capture file: ${entry.name}`);
        const handle = await open(join(inputs[side], entry.name), constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const stat = await handle.stat();
          totalBytes += stat.size;
          if (!stat.isFile() || stat.size < 33 || stat.size > limits.fileBytes || totalBytes > limits.totalBytes) {
            throw new Error(`Capture file exceeds byte limits: ${entry.name}`);
          }
          const header = Buffer.alloc(33);
          await handle.read(header, 0, header.length, 0);
          const { width, height } = pngDimensions(header, limits);
          totalPixels += width * height;
          if (totalPixels > limits.totalPixels) throw new Error("Capture set exceeds total pixel limit");
          const bytes = Buffer.alloc(stat.size);
          let offset = 0;
          while (offset < bytes.length) {
            const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
            if (!bytesRead) throw new Error(`Truncated capture: ${entry.name}`);
            offset += bytesRead;
          }
          if ((await handle.stat()).size !== stat.size) throw new Error(`Capture changed while reading: ${entry.name}`);
          if (!bytes.subarray(0, 33).equals(header)) throw new Error(`Capture header changed while reading: ${entry.name}`);
          const pngLength = validateChunks(bytes);
          const decoded = PNG.sync.read(bytes.subarray(0, pngLength), { checkCRC: true });
          if (decoded.width !== width || decoded.height !== height) throw new Error("PNG dimensions changed during decoding");
          // Construct fresh output from pixels so metadata, trailing payloads, and animation are discarded.
          const safe = PNG.sync.write({ width, height, data: decoded.data } as PNG, { colorType: 6 });
          outputBytes += safe.length;
          if (safe.length > limits.fileBytes || outputBytes > limits.totalBytes) {
            throw new Error(`Re-encoded capture exceeds byte limit: ${entry.name}`);
          }
          await Bun.write(join(staging, side, entry.name), safe);
        } finally {
          await handle.close();
        }
      }
    }
    await rename(staging, output);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const actual = process.env.VISUAL_INPUT_ACTUAL_DIR;
  const expected = process.env.VISUAL_INPUT_EXPECTED_DIR;
  const output = process.env.VISUAL_DIR;
  if (!actual || !expected || !output) throw new Error("VISUAL_INPUT_ACTUAL_DIR, VISUAL_INPUT_EXPECTED_DIR, and VISUAL_DIR are required");
  await sanitizeCaptures({ actual, expected, output });
  console.info("Visual capture PNGs sanitized.");
}
