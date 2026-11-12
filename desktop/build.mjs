import { resolve } from "node:path";
import { build } from "esbuild";
import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
await mkdir("dist/editor", { recursive: true });
for (const name of ["index.html", "app.css"])
  await copyFile("src/" + name, "dist/" + name);
for (const name of ["editor.js", "editor.css"])
  await copyFile("../vscode-extension/media/" + name, "dist/editor/" + name);
await copyFile("../assets/schedule-core.js", "dist/editor/schedule-core.js");
await copyFile("../assets/vendor/marked.min.js", "dist/editor/marked.min.js");
await copyFile("src/editor.html", "dist/editor/index.html");
await copyFile("src/editor-bridge.js", "dist/editor/bridge.js");
await copyFile("src/editor-theme.css", "dist/editor/theme.css");
await build({
  entryPoints: ["src/app.js"],
  bundle: true,
  nodePaths: [resolve("node_modules")],
  outfile: "dist/app.js",
  sourcemap: true,
  plugins: [
    {
      name: "shared-calendar",
      setup(b) {
        b.onResolve({ filter: /\.\/media\/schedule-core$/ }, () => ({
          path: new URL("../assets/schedule-core.js", import.meta.url).pathname,
        }));
      },
    },
  ],
});
