import { CUSTOM_MODEL_ID } from "../../electron/account-config";
import type { AccountMethod, AppSettings } from "../../electron/shared";

export function settingsForAccountMethod(
  settings: AppSettings | null,
  method?: AccountMethod | null,
): AppSettings | null {
  if (!settings || method !== "oauth") return settings;
  const models = settings.models.filter((model) => model.id !== CUSTOM_MODEL_ID);
  return models.length === settings.models.length ? settings : { ...settings, models };
}
