import type { ScreenCase, ScreenFeature } from "./cases.ts";

/** Which checkout a capture run photographs. Only the baseline may lack a feature. */
export type CaptureSide = "branch" | "baseline";

export function captureSide(value: string | undefined): CaptureSide {
  if (value === undefined || value === "" || value === "branch") return "branch";
  if (value === "baseline") return "baseline";
  throw new Error(`CAPTURE_SIDE must be "branch" or "baseline", got ${JSON.stringify(value)}`);
}

/** SSR markers proving a feature exists in the running app (see cases.ts ScreenFeature). Pass the HTML of `/` and `/login`. */
export function featuresInShuttlePubHtml(html: string): Set<ScreenFeature> {
  const features = new Set<ScreenFeature>();
  if (html.includes('data-testid="app-shell"')) features.add("sns-shell");
  if (html.includes('class="sp-reaction-layer"')) features.add("quick-reaction");
  if (html.includes('data-testid="login-page"')) features.add("sns-login");
  return features;
}

/** SSR marker of the Emumet username dialog on /accounts/new (the create modal is part of the SSR page). */
export function featuresInEmumetHtml(html: string): Set<ScreenFeature> {
  const features = new Set<ScreenFeature>();
  if (html.includes("data-username-dialog")) features.add("emumet-username-ui");
  return features;
}

/** The Emumet mock knows the E15x Webhook destination scenarios (probe: POST /__mock/registration-gate/scenario). */
export const EMUMET_WEBHOOK_PROBE_SCENARIO = "webhook-multiple";

export function featuresFromEmumetScenarioProbe(status: number): Set<ScreenFeature> {
  return new Set<ScreenFeature>(status >= 200 && status < 300 ? ["emumet-webhook-endpoints"] : []);
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
