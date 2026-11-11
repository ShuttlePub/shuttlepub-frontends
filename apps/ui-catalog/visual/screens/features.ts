import type { ScreenCase, ScreenFeature } from "./cases.ts";

/** Which checkout a capture run photographs. Only the baseline may lack a feature. */
export type CaptureSide = "branch" | "baseline";

export function captureSide(value: string | undefined): CaptureSide {
  if (value === undefined || value === "" || value === "branch") return "branch";
  if (value === "baseline") return "baseline";
  throw new Error(`CAPTURE_SIDE must be "branch" or "baseline", got ${JSON.stringify(value)}`);
}

/** Where each feature's SSR marker is looked for (see cases.ts ScreenFeature). */
export const SHUTTLEPUB_FEATURE_PROBES: readonly { feature: ScreenFeature; path: string; marker: string }[] = [
  { feature: "sns-shell", path: "/", marker: 'data-testid="app-shell"' },
  { feature: "mute-block-settings", path: "/settings/mute-block/domains", marker: 'data-testid="mute-block"' },
];

/** SSR markers proving a feature exists in the running app, for the HTML served at `path`. */
export function featuresInShuttlePubHtml(html: string, path = "/"): Set<ScreenFeature> {
  const features = new Set<ScreenFeature>();
  for (const probe of SHUTTLEPUB_FEATURE_PROBES) {
    if (probe.path === path && html.includes(probe.marker)) features.add(probe.feature);
  }
  return features;
}

/**
 * Splits cases into those to capture and those the checkout cannot serve yet.
 * Skipping is an explicit baseline-only policy: the skipped images show up as New in
 * the comparison report. On the branch side a missing feature is a failure, so a
 * broken screen can never pass by being skipped.
 */
export function selectCases(
  cases: readonly ScreenCase[],
  features: ReadonlySet<ScreenFeature>,
  side: CaptureSide,
): { capture: ScreenCase[]; skipped: ScreenCase[] } {
  const capture: ScreenCase[] = [];
  const skipped: ScreenCase[] = [];
  for (const item of cases) {
    const required = "requires" in item ? item.requires : undefined;
    if (required === undefined || features.has(required)) capture.push(item);
    else if (side === "baseline") skipped.push(item);
    else throw new Error(`${item.filename}: the branch checkout lacks the required screen feature "${required}"`);
  }
  return { capture, skipped };
}
