import { app, type BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";

// Development helper: VYBE_CAPTURE_DIR=<dir> VYBE_CAPTURE_ROUTES=/,/studio,...
// visits each route, saves a screenshot, mirrors renderer console errors to
// stdout and then quits. Used for smoke-testing builds without clicking around.

export function maybeRunCapture(win: BrowserWindow) {
  const dir = process.env.VYBE_CAPTURE_DIR;
  if (!dir) return;
  const routes = (process.env.VYBE_CAPTURE_ROUTES ?? "/").split(",").filter(Boolean);
  const delay = Number(process.env.VYBE_CAPTURE_DELAY_MS ?? 3000);
  fs.mkdirSync(dir, { recursive: true });

  win.webContents.on("console-message", (event) => {
    const { level, message } = event as unknown as { level: string; message: string };
    if (level === "error" || level === "warning") console.log(`[renderer:${level}] ${message}`);
  });

  win.webContents.once("did-finish-load", async () => {
    // Optional scripted flow (VYBE_CAPTURE_SCRIPT=<file>) run in the page before
    // capturing. It may return { routes: [...] } to choose what to capture next.
    const script = process.env.VYBE_CAPTURE_SCRIPT;
    if (script) {
      try {
        const result = await win.webContents.executeJavaScript(
          `(async () => { ${fs.readFileSync(script, "utf8")} })()`,
        );
        console.log(`[capture] script result: ${JSON.stringify(result)}`);
        if (result?.routes) routes.splice(0, routes.length, ...result.routes);
      } catch (e) {
        console.log(`[capture] script failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    for (const route of routes) {
      // "." captures the current view as-is (e.g. after a script scrolled it).
      if (route !== ".") {
        await win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(route)}`);
        await new Promise((r) => setTimeout(r, delay));
      }
      const image = await win.webContents.capturePage();
      const name =
        route === "."
          ? `view-${Date.now()}`
          : route.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home";
      fs.writeFileSync(path.join(dir, `${name}.png`), image.toPNG());
      console.log(`[capture] ${route} -> ${name}.png`);
    }
    app.quit();
  });
}
