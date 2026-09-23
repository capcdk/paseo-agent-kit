import type { PluginClientContext } from "@getpaseo/plugin/client";
import { AgentKitScreen, APP_NAME } from "./client/dashboard";

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
    title: `打开 ${APP_NAME}`,
    icon: "Blocks",
    keywords: ["mcp", "skill", "agent", "kit", "挂载", "同步"],
    context: "global",
    onSelect(context) {
      context.openSurface("agent-kit");
    },
  });
  return () => {};
}
