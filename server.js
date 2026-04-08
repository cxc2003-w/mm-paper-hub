const http = require("http");
const https = require("https");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const FAVORITES_FILE = path.join(DATA_DIR, "favorites.json");

async function ensureDataFile() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FAVORITES_FILE)) {
    await fsp.writeFile(FAVORITES_FILE, "[]", "utf8");
  }
}

async function readFavorites() {
  await ensureDataFile();
  const content = await fsp.readFile(FAVORITES_FILE, "utf8");
  try {
    return JSON.parse(content);
  } catch {
    return [];
  }
}

async function writeFavorites(items) {
  await ensureDataFile();
  await fsp.writeFile(FAVORITES_FILE, JSON.stringify(items, null, 2), "utf8");
}

function sendJson(res, status, payload) {
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(payload));
}

function decodeXml(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function getTagText(block, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "i");
  const match = block.match(regex);
  return match ? decodeXml(match[1].trim().replace(/\s+/g, " ")) : "";
}

function getAuthors(block) {
  const result = [];
  const regex = /<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/gi;
  let match;
  while ((match = regex.exec(block)) !== null) {
    result.push(decodeXml(match[1].trim().replace(/\s+/g, " ")));
  }
  return result;
}

function getPdfLink(block) {
  const pdfMatch = block.match(/<link[^>]*title="pdf"[^>]*href="([^"]+)"[^>]*\/?>/i);
  if (pdfMatch) return pdfMatch[1];
  const id = getTagText(block, "id");
  return id ? id.replace("/abs/", "/pdf/") + ".pdf" : "";
}

function parseArxivAtom(xml) {
  const entries = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
  let match;

  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];
    entries.push({
      id: getTagText(block, "id"),
      title: getTagText(block, "title"),
      summary: getTagText(block, "summary"),
      published: getTagText(block, "published"),
      updated: getTagText(block, "updated"),
      authors: getAuthors(block),
      pdfLink: getPdfLink(block)
    });
  }

  return entries;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (data.length > 1e6) {
        req.socket.destroy();
        reject(new Error("Body too large"));
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function contentTypeFor(ext) {
  const map = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon"
  };
  return map[ext] || "application/octet-stream";
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https://") ? https : http;
    const req = client.get(
      url,
      {
        headers: {
          "User-Agent": "MM-Paper-Hub/1.0 (+http://localhost)"
        }
      },
      res => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", chunk => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${String(data).slice(0, 200)}`));
          }
        });
      }
    );

    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error("请求超时"));
    });
  });
}

async function handleApi(req, res, urlObj) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    res.end();
    return true;
  }

  if (urlObj.pathname === "/api/search" && req.method === "GET") {
    try {
      const q = (urlObj.searchParams.get("q") || "multimodal").trim();
      const start = Number(urlObj.searchParams.get("start") || 0);
      const max = Math.min(Number(urlObj.searchParams.get("max") || 20), 50);

      const arxivUrl =
        "https://export.arxiv.org/api/query?search_query=all:" +
        encodeURIComponent(q) +
        `&start=${start}&max_results=${max}&sortBy=submittedDate&sortOrder=descending`;

      const xml = await fetchText(arxivUrl);
      const papers = parseArxivAtom(xml);
      sendJson(res, 200, { q, count: papers.length, papers });
      return true;
    } catch (error) {
      sendJson(res, 500, { error: "搜索失败", detail: String(error.message || error) });
      return true;
    }
  }

  if (urlObj.pathname === "/api/favorites" && req.method === "GET") {
    const items = await readFavorites();
    sendJson(res, 200, { count: items.length, items });
    return true;
  }

  if (urlObj.pathname === "/api/favorites" && req.method === "POST") {
    try {
      const raw = await readRequestBody(req);
      const body = JSON.parse(raw || "{}");
      if (!body || !body.id || !body.title) {
        sendJson(res, 400, { error: "参数不完整，需要 id/title" });
        return true;
      }

      const items = await readFavorites();
      if (!items.some(item => item.id === body.id)) {
        items.unshift({
          id: body.id,
          title: body.title,
          pdfLink: body.pdfLink || "",
          authors: Array.isArray(body.authors) ? body.authors : [],
          published: body.published || "",
          savedAt: new Date().toISOString()
        });
        await writeFavorites(items);
      }
      sendJson(res, 200, { ok: true });
      return true;
    } catch (error) {
      sendJson(res, 400, { error: "无法解析 JSON", detail: String(error.message || error) });
      return true;
    }
  }

  if (urlObj.pathname.startsWith("/api/favorites/") && req.method === "DELETE") {
    const id = decodeURIComponent(urlObj.pathname.replace("/api/favorites/", ""));
    const items = await readFavorites();
    const next = items.filter(item => item.id !== id);
    await writeFavorites(next);
    sendJson(res, 200, { ok: true, count: next.length });
    return true;
  }

  return false;
}

async function serveStatic(req, res, urlObj) {
  let filePath = urlObj.pathname === "/" ? "/index.html" : urlObj.pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const fullPath = path.join(PUBLIC_DIR, filePath);

  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const stat = await fsp.stat(fullPath);
    if (stat.isDirectory()) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }
    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, { "Content-Type": contentTypeFor(ext) });
    fs.createReadStream(fullPath).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  }
}

const server = http.createServer(async (req, res) => {
  const host = req.headers.host || `localhost:${PORT}`;
  const urlObj = new URL(req.url || "/", `http://${host}`);

  try {
    const handled = await handleApi(req, res, urlObj);
    if (!handled) {
      await serveStatic(req, res, urlObj);
    }
  } catch (error) {
    if (!res.headersSent && !res.writableEnded) {
      sendJson(res, 500, { error: "服务器错误", detail: String(error.message || error) });
    }
  }
});

ensureDataFile().then(() => {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`MM Paper Hub running on 0.0.0.0:${PORT}`);
  });
});
