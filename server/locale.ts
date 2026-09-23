import { detectLocale, resolveLocale, translate, type Locale, type MessageKey, type Vars } from "../shared/i18n";
import { loadKitStore } from "./kit-store";

/** The daemon's own environment rarely carries the user's language, so "auto" follows the last client that asked. */
let deviceLocale: Locale | null = null;

export function setDeviceLocale(locale: Locale): void {
  deviceLocale = locale;
}

export function t(key: MessageKey, vars?: Vars): string {
  return translate(resolveLocale(loadKitStore().locale, deviceLocale ?? detectLocale()), key, vars);
}

export function joinList(items: readonly string[]): string {
  return items.join(t("listSep"));
}
