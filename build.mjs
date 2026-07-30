import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const outputRoot = resolve(projectRoot, "dist");
const serverRoot = resolve(outputRoot, "server");

const textFiles = [
  "index.html",
  "ollamasetuptutorial.html",
  "privacy.html",
  "styles.css",
  "localization.js",
];

const languageFiles = (await readdir(resolve(projectRoot, "i18n")))
  .filter((fileName) => fileName.endsWith(".json"))
  .sort()
  .map((fileName) => `i18n/${fileName}`);

textFiles.push(...languageFiles);

const binaryFiles = [
  "assets/app-icon.png",
  "assets/apple-touch-icon.png",
  "assets/favicon.png",
  "assets/og.png",
];

const textAssets = {};
const binaryAssets = {};

for (const relativePath of textFiles) {
  textAssets[`/${relativePath}`] = await readFile(
    resolve(projectRoot, relativePath),
    "utf8",
  );
}

for (const relativePath of binaryFiles) {
  binaryAssets[`/${relativePath}`] = (
    await readFile(resolve(projectRoot, relativePath))
  ).toString("base64");
}

const workerSource = `
const TEXT_ASSETS = ${JSON.stringify(textAssets)};
const BINARY_ASSETS = ${JSON.stringify(binaryAssets)};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
};

function extension(pathname) {
  const dotIndex = pathname.lastIndexOf(".");
  return dotIndex === -1 ? "" : pathname.slice(dotIndex);
}

function decodeBase64(encoded) {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function responseHeaders(pathname) {
  const headers = new Headers({
    "Content-Type": MIME_TYPES[extension(pathname)] ?? "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  });

  if (pathname.startsWith("/assets/")) {
    headers.set("Cache-Control", "public, max-age=604800, immutable");
  } else {
    headers.set("Cache-Control", "public, max-age=300");
  }

  return headers;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);

    if (pathname === "/") {
      pathname = "/index.html";
    }

    if (Object.hasOwn(TEXT_ASSETS, pathname)) {
      let content = TEXT_ASSETS[pathname];
      if (pathname === "/index.html") {
        content = content.replaceAll(
          "./assets/og.png",
          new URL("/assets/og.png", url).href,
        );
      }

      return new Response(content, {
        headers: responseHeaders(pathname),
      });
    }

    if (Object.hasOwn(BINARY_ASSETS, pathname)) {
      return new Response(decodeBase64(BINARY_ASSETS[pathname]), {
        headers: responseHeaders(pathname),
      });
    }

    return new Response("Page not found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
};
`;

await rm(outputRoot, { recursive: true, force: true });
await mkdir(serverRoot, { recursive: true });
await writeFile(resolve(serverRoot, "index.js"), workerSource, "utf8");

console.log(
  `Built ${textFiles.length + binaryFiles.length} static assets for deployment.`,
);
