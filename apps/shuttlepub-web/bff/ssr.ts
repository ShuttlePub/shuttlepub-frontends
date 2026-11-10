// Loads the SSR bundle (dist/server.js, the `spago bundle` output) and re-loads it
// whenever the file changes. A plain `import()` is cached by the module loader for the
// life of the process, so without this a rebuilt bundle (scripts/dev.sh watcher) would
// keep rendering the old SSR while the freshly built client expects the new one, and
// hydration would fail. The version is part of the specifier: an unchanged file reuses
// the cached module, a rebuilt one is a new module.

import { join } from "node:path";

export type SsrModule = {
  renderPage: (path: string) => () => string;
};

export type SsrRenderer = {
  /** Resolves to null when no bundle has been built yet. */
  render(path: string): Promise<string | null>;
};

export function createSsrRenderer(distDir: string): SsrRenderer {
  const bundlePath = join(distDir, "server.js");
  let loaded: { version: string; module: SsrModule } | undefined;

  async function load(): Promise<SsrModule | null> {
    const file = Bun.file(bundlePath);
    if (!(await file.exists())) return null;
    const version = `${file.lastModified}-${file.size}`;
    if (loaded?.version !== version) {
      const module: SsrModule = await import(`${bundlePath}?v=${version}`);
      loaded = { version, module };
    }
    return loaded.module;
  }

  return {
    async render(path) {
      const module = await load();
      return module === null ? null : module.renderPage(path)();
    },
  };
}
