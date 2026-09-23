import type { PluginClientContext } from "@getpaseo/plugin/client";
import { AgentKitScreen, APP_NAME } from "./client/dashboard";
import { detectLocale, translate } from "./shared/i18n";

export default function contribute(client: PluginClientContext) {
  client.addSurface("agent-kit", AgentKitScreen);
  client.addSidebarItem({
    id: "agent-kit",
    title: APP_NAME,
    icon: "Blocks",
    surface: "agent-kit",
  });
  client.addCommandCenterItem({
    id: "agent-kit-open",
    title: translate(detectLocale(), "openApp", { app: APP_NAME }),
    icon: "Blocks",
    keywords: ["mcp", "skill", "agent", "kit", "mount", "sync", "挂载", "同步"],
    context: "global",
    onSelect(context) {
      context.openSurface("agent-kit");
    },
  });
  return () => {};
}
