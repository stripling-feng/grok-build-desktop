import os from "node:os";
import path from "node:path";

export const app = {
  getPath: (_name: string) => path.join(os.tmpdir(), "grok-build-desktop-tests"),
};

const defaultSession = {
  setProxy: async (_config: unknown) => undefined,
  resolveProxy: async (_url: string) => "DIRECT",
};

export const session = {
  defaultSession,
  fromPartition: (_name: string, _options?: unknown) => defaultSession,
};

export const net = {
  request: (_options: unknown) => {
    throw new Error("Electron networking is unavailable in unit tests");
  },
};
