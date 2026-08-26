function splitNullTerminated(value: string): string[] {
  return value
    .split("\0")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
function decodeFileDrop(buffer: Buffer): string[] {
  if (buffer.length < 20) return [];
  const offset = buffer.readUInt32LE(0);
  if (offset < 20 || offset >= buffer.length) return [];
  const wide = buffer.readUInt32LE(16) !== 0;
  return splitNullTerminated(buffer.subarray(offset).toString(wide ? "utf16le" : "latin1"));
}

export function pathsFromClipboardBuffer(format: string, buffer: Buffer): string[] {
  if (!buffer.length) return [];
  const normalized = format.toLowerCase();
  if (normalized.includes("cf_hdrop") || normalized.includes("filedrop")) {
    return decodeFileDrop(buffer);
  }
  if (normalized.includes("filenamew")) {
    return splitNullTerminated(buffer.toString("utf16le"));
  }
  if (normalized.includes("filename")) {
    return splitNullTerminated(buffer.toString("latin1"));
  }
  if (normalized.includes("file-url") || normalized.includes("uri-list")) {
    return buffer
      .toString("utf8")
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.startsWith("file://"))
      .map((entry) => {
        try {
          return decodeURIComponent(new URL(entry).pathname).replace(/^\/(?:([A-Za-z]:))/, "$1");
        } catch {
          return "";
        }
      })
      .filter(Boolean);
  }
  return [];
}
