import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".otf": "font/otf",
  ".yaml": "text/plain",
  ".md": "text/plain",
};
http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const site = url.pathname.startsWith("/site/");
      const base = path.resolve(site ? ".." : "dist");
      let rel =
        decodeURIComponent(url.pathname).replace(site ? "/site/" : "/", "") ||
        "index.html";
      const p = path.resolve(base, rel);
      if (!p.startsWith(base + path.sep)) throw Error();
      let data = await readFile(p);
      if (site && p.endsWith(".html"))
        data = Buffer.from(
          data
            .toString()
            .replace(
              "</body>",
              `<script>${await readFile("src/preview.js", "utf8")}</script></body>`,
            ),
        );
      res.writeHead(200, {
        "Content-Type": types[path.extname(p)] || "application/octet-stream",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(data);
    } catch {
      res.writeHead(404, { "Access-Control-Allow-Origin": "*" });
      res.end();
    }
  })
  .listen(4318, "127.0.0.1");
