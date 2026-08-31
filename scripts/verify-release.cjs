const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const { version } = require(path.join(root, "package.json"));
const releaseDir = path.join(root, "release");
const installerName = `Grok-Build-Setup-${version}.exe`;
const installerPath = path.join(releaseDir, installerName);
const blockmapPath = `${installerPath}.blockmap`;
const metadataPath = path.join(releaseDir, "latest.yml");

for (const file of [installerPath, blockmapPath, metadataPath]) {
  if (!fs.existsSync(file)) throw new Error(`Missing release artifact: ${path.relative(root, file)}`);
}

const metadata = fs.readFileSync(metadataPath, "utf8");
const fieldValues = (name) =>
  [...metadata.matchAll(new RegExp(`^\\s*(?:-\\s*)?${name}:\\s*['\"]?([^'\"\\r\\n]+)['\"]?\\s*$`, "gm"))].map(
    (match) => match[1].trim(),
  );

const urls = fieldValues("url");
const paths = fieldValues("path");
if (!urls.includes(installerName) || !paths.includes(installerName)) {
  throw new Error(`latest.yml must reference ${installerName} in both url and path`);
}

const installer = fs.readFileSync(installerPath);
const actualHash = crypto.createHash("sha512").update(installer).digest("base64");
const hashes = fieldValues("sha512");
if (hashes.length < 2 || hashes.some((hash) => hash !== actualHash)) {
  throw new Error("latest.yml SHA-512 does not match the installer");
}

const sizes = fieldValues("size").map(Number);
if (!sizes.includes(installer.length)) {
  throw new Error("latest.yml size does not match the installer");
}

console.log(`Verified ${installerName}, its blockmap, and latest.yml`);
