import { appendFileSync } from "node:fs";
import { FIXED_TIME } from "./cases.ts";
import { installFetchGuard } from "./fetch-guard.ts";

const allowedOrigin = process.env.VISUAL_CORE_ORIGIN;
const networkLog = process.env.VISUAL_NETWORK_LOG;
if (!allowedOrigin || !networkLog) throw new Error("Capture preload requires VISUAL_CORE_ORIGIN and VISUAL_NETWORK_LOG");
installFetchGuard(allowedOrigin, (message) => {
  // Synchronous recording survives app catch blocks and asynchronous log drains.
  appendFileSync(networkLog, `${JSON.stringify(message)}\n`);
  console.error(message);
});

// Loaded ONLY into the capture driver child servers with bun --preload.
// Preserve elapsed timers, Date parsing and explicit timestamps while fixing
// new Date()/Date.now() for mock data creation and session expiry calculations.
const NativeDate = Date;
const timestamp = NativeDate.parse(FIXED_TIME);
globalThis.Date = new Proxy(NativeDate, {
  construct(target, args) { return Reflect.construct(target, args.length ? args : [timestamp]); },
  apply() { return new NativeDate(timestamp).toString(); },
  get(target, property, receiver) {
    return property === "now" ? () => timestamp : Reflect.get(target, property, receiver);
  },
});
