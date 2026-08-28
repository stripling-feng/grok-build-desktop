const GROK_EXTENSION_METHOD = /^x\.ai\/(?:mcp|skills)\//;

/**
 * Grok documents extension names without a leading underscore, while ACP sends
 * unstable extension requests with the `_` namespace marker on the wire.
 * Keep the documented name as a fallback for older/newer CLI builds.
 */
export function grokExtensionMethodCandidates(method: string): string[] {
  const logicalMethod = method.startsWith("_") ? method.slice(1) : method;
  if (!GROK_EXTENSION_METHOD.test(logicalMethod)) {
    throw new Error(`不允许的扩展方法：${method}`);
  }
  return [`_${logicalMethod}`, logicalMethod];
}

/** Normalize unstable ACP wire notifications to the documented extension name. */
export function grokExtensionNotificationMethod(method: string): string | null {
  const logicalMethod = method.startsWith("_") ? method.slice(1) : method;
  return GROK_EXTENSION_METHOD.test(logicalMethod) ? logicalMethod : null;
}

export function isMethodNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /method not found|unknown method|not found.*(?:_?x\.ai\/)/i.test(message);
}
