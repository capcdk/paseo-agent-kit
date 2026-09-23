import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import {
  kitStatusRpc,
  importRpc,
  localeRpc,
  mountRpc,
  probeRpc,
  trustRpc,
  userLevelRpc,
  type CatalogItem,
  type HarnessColumn,
  type KitStatus,
  type LoadState,
  type ProjectBoard,
} from "../shared/api";
import { detectLocale, LOCALE_PREFS, resolveLocale, translate, type LocalePref, type MessageKey, type Vars } from "../shared/i18n";

export const APP_NAME = "Agent Kit";

type Theme = PluginSurfaceProps["theme"];
type Kind = "mcp" | "skill";
type DotState = LoadState | "pending";
type Cell = { state: LoadState; detail: string };
type ProbeState = { status: "loading" } | { status: "done"; cells: Record<string, Cell> } | { status: "error"; message: string };
type Tr = (key: MessageKey, vars?: Vars) => string;

const STATE_KEY: Record<DotState, MessageKey> = {
  loaded: "stateLoaded",
  approval: "stateApproval",
  auth: "stateAuth",
  failed: "stateFailed",
  unknown: "stateUnknown",
  pending: "statePending",
};

const KIND_KEY: Record<Kind, MessageKey> = { mcp: "kindMcp", skill: "kindSkill" };

function cellKey(kind: Kind, name: string, harness: string): string {
  return `${kind}:${name}:${harness}`;
}

function stateColor(state: DotState, theme: Theme): string {
  switch (state) {
    case "loaded":
      return theme.colors.statusSuccess;
    case "approval":
    case "auth":
      return theme.colors.statusWarning;
    case "failed":
      return theme.colors.statusDanger;
    default:
      return theme.colors.foregroundMuted;
  }
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function Dot({ state, theme, size = 8 }: { state: DotState; theme: Theme; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: stateColor(state, theme),
        opacity: state === "pending" || state === "unknown" ? 0.45 : 1,
      }}
    />
  );
}

function Button({
  label,
  icon,
  theme,
  onPress,
  disabled,
  primary,
}: {
  label: string;
  icon?: string;
  theme: Theme;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  const color = primary ? theme.colors.accentForeground : theme.colors.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 8,
        borderWidth: primary ? 0 : 1,
        borderColor: theme.colors.border,
        backgroundColor: primary ? theme.colors.accent : theme.colors.surface1,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {icon ? <Icon name={icon} size={14} color={color} /> : null}
      <Text style={{ color, fontSize: 12, fontWeight: "500" }}>{label}</Text>
    </Pressable>
  );
}

function Toggle({
  value,
  disabled,
  label,
  theme,
  onChange,
}: {
  value: boolean;
  disabled: boolean;
  label: string;
  theme: Theme;
  onChange: (value: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      hitSlop={8}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        padding: 2,
        justifyContent: "center",
        alignItems: value ? "flex-end" : "flex-start",
        backgroundColor: value ? theme.colors.accent : theme.colors.surface2,
        borderWidth: value ? 0 : 1,
        borderColor: theme.colors.border,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <View
        style={{
          width: 14,
          height: 14,
          borderRadius: 7,
          backgroundColor: value ? theme.colors.accentForeground : theme.colors.foregroundMuted,
        }}
      />
    </Pressable>
  );
}

/** Explains a locked control on hover (or tap on touch devices); a disabled Pressable gets no hover events itself. */
function LockHint({ reason, theme, children }: { reason: string | null; theme: Theme; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!reason) {
    return <>{children}</>;
  }
  return (
    <Pressable
      accessibilityHint={reason}
      onHoverIn={() => setOpen(true)}
      onHoverOut={() => setOpen(false)}
      onPress={() => setOpen((current) => !current)}
      style={{ position: "relative", zIndex: open ? 10 : 0 }}
    >
      {children}
      {open ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            right: "100%",
            top: -4,
            marginRight: 8,
            width: 220,
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface2,
          }}
        >
          <Text style={{ color: theme.colors.foreground, fontSize: 11, lineHeight: 15 }}>{reason}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function Segmented<Value extends string>({
  options,
  value,
  theme,
  onChange,
}: {
  options: readonly { value: Value; label: string; count?: string }[];
  value: Value;
  theme: Theme;
  onChange: (value: Value) => void;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        padding: 3,
        gap: 2,
        borderRadius: 9,
        backgroundColor: theme.colors.surface1,
        borderWidth: 1,
        borderColor: theme.colors.border,
        alignSelf: "flex-start",
      }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 14,
              paddingVertical: 6,
              borderRadius: 7,
              backgroundColor: active ? theme.colors.surface2 : "transparent",
            }}
          >
            <Text style={{ color: active ? theme.colors.foreground : theme.colors.foregroundMuted, fontSize: 13, fontWeight: "600" }}>
              {option.label}
            </Text>
            {option.count ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{option.count}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function ProjectChips({
  projects,
  selectedId,
  theme,
  tr,
  onSelect,
}: {
  projects: readonly ProjectBoard[];
  selectedId: string | null;
  theme: Theme;
  tr: Tr;
  onSelect: (projectId: string) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {projects.map((project) => {
        const active = project.projectId === selectedId;
        const mounted = project.mountedMcp.length + project.mountedSkills.length;
        return (
          <Pressable
            key={project.projectId}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={tr("projectChip", { name: project.name, count: mounted })}
            onPress={() => onSelect(project.projectId)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: active ? theme.colors.accent : theme.colors.border,
              backgroundColor: active ? theme.colors.accent : theme.colors.surface1,
            }}
          >
            <Text style={{ color: active ? theme.colors.accentForeground : theme.colors.foreground, fontSize: 12, fontWeight: "600" }}>
              {project.name}
            </Text>
            {mounted > 0 ? (
              <Text style={{ color: active ? theme.colors.accentForeground : theme.colors.foregroundMuted, fontSize: 11, opacity: 0.85 }}>
                {mounted}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function HarnessBadge({ harness, state, theme }: { harness: HarnessColumn; state: DotState; theme: Theme }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 7,
        paddingVertical: 3,
        borderRadius: 6,
        backgroundColor: theme.colors.surface2,
      }}
    >
      <Dot state={state} theme={theme} size={6} />
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{harness.label}</Text>
    </View>
  );
}

function ItemRow({
  item,
  kind,
  mounted,
  harnesses,
  cells,
  probe,
  expanded,
  busy,
  compact,
  last,
  theme,
  tr,
  onToggleExpand,
  onMount,
  onUserLevel,
  onTrust,
}: {
  item: CatalogItem;
  kind: Kind;
  mounted: boolean;
  harnesses: readonly HarnessColumn[];
  cells: Readonly<Record<string, Cell>>;
  probe: ProbeState | undefined;
  expanded: boolean;
  busy: boolean;
  compact: boolean;
  last: boolean;
  theme: Theme;
  tr: Tr;
  onToggleExpand: () => void;
  onMount: (mount: boolean) => void;
  onUserLevel: (userLevel: boolean) => void;
  onTrust: (harness: HarnessColumn) => void;
}) {
  const states = harnesses.map((harness) => {
    const cell = cells[cellKey(kind, item.name, harness.id)];
    const state: DotState = cell?.state ?? (probe?.status === "loading" || !probe ? "pending" : "failed");
    return { harness, state, detail: cell?.detail ?? (probe?.status === "error" ? probe.message : "") };
  });
  const global = item.userLevel;
  const blind = kind === "skill" && !item.userLevel ? harnesses.filter((harness) => !harness.projectSkills) : [];
  const needsTrust = states.filter(({ harness, state }) => harness.canApprove && state === "approval").map(({ harness }) => harness);
  const badges = (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
      {states.map(({ harness, state }) => (
        <HarnessBadge key={harness.id} harness={harness} state={state} theme={theme} />
      ))}
    </View>
  );
  return (
    <View style={{ borderBottomWidth: last ? 0 : 1, borderBottomColor: theme.colors.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr(expanded ? "rowCollapse" : "rowExpand", { name: item.name })}
          onPress={onToggleExpand}
          style={{ flex: 1, flexDirection: compact ? "column" : "row", alignItems: compact ? "flex-start" : "center", gap: compact ? 6 : 12 }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: compact ? undefined : 1, minWidth: 0 }}>
            <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={14} color={theme.colors.foregroundMuted} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontFamily: "Menlo" }} numberOfLines={1}>
                {item.summary}
              </Text>
              {blind.length > 0 ? (
                <Text style={{ color: theme.colors.statusWarning, fontSize: 11 }} numberOfLines={1}>
                  {tr("projectOnlyBlind", { harnesses: blind.map((harness) => harness.label).join(tr("listSep")) })}
                </Text>
              ) : null}
            </View>
          </View>
          {compact ? <View style={{ paddingLeft: 20 }}>{badges}</View> : badges}
        </Pressable>
        {needsTrust.map((harness) => (
          <Button
            key={harness.id}
            label={tr("trust", { harness: harness.label })}
            icon="ShieldCheck"
            theme={theme}
            disabled={busy}
            onPress={() => onTrust(harness)}
          />
        ))}
        <View style={{ alignItems: "center", gap: 3 }}>
          <LockHint reason={item.globalLock ? tr("globalLockHint", { reason: item.globalLock }) : null} theme={theme}>
            <Toggle
              value={item.userLevel}
              disabled={busy || item.globalLock !== null}
              label={
                item.globalLock
                  ? tr("a11yGlobalLocked", { name: item.name, reason: item.globalLock })
                  : tr(item.userLevel ? "a11yGlobalOff" : "a11yGlobalOn", { name: item.name })
              }
              theme={theme}
              onChange={onUserLevel}
            />
          </LockHint>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10 }}>{tr("global")}</Text>
        </View>
        <View style={{ alignItems: "center", gap: 3 }}>
          <LockHint reason={global ? tr("projectLockHint") : null} theme={theme}>
            <Toggle
              value={global || mounted}
              disabled={busy || global}
              label={
                tr(global ? "a11yMountLocked" : mounted ? "a11yUnmount" : "a11yMount", { name: item.name })
              }
              theme={theme}
              onChange={onMount}
            />
          </LockHint>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10 }}>{tr("project")}</Text>
        </View>
      </View>
      {expanded ? (
        <View style={{ paddingLeft: 34, paddingRight: 14, paddingBottom: 12, gap: 6 }}>
          {states.map(({ harness, state, detail }) => (
            <View key={harness.id} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
              <View style={{ width: 64, flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 1 }}>
                <Dot state={state} theme={theme} size={6} />
                <Text style={{ color: theme.colors.foreground, fontSize: 11 }}>{harness.label}</Text>
              </View>
              <Text style={{ width: 72, color: stateColor(state, theme), fontSize: 11 }}>{tr(STATE_KEY[state])}</Text>
              <Text style={{ flex: 1, color: theme.colors.foregroundMuted, fontSize: 11, fontFamily: "Menlo" }} numberOfLines={3}>
                {detail || "—"}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Legend({ theme, tr }: { theme: Theme; tr: Tr }) {
  const items: LoadState[] = ["loaded", "approval", "auth", "failed", "unknown"];
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
      {items.map((state) => (
        <View key={state} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Dot state={state} theme={theme} size={6} />
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{tr(STATE_KEY[state])}</Text>
        </View>
      ))}
    </View>
  );
}

function EmptyState({ icon, title, hint, theme, children }: { icon: string; title: string; hint: string; theme: Theme; children?: ReactNode }) {
  return (
    <View
      style={{
        alignItems: "center",
        gap: 8,
        paddingVertical: 40,
        paddingHorizontal: 20,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      }}
    >
      <Icon name={icon} size={24} color={theme.colors.foregroundMuted} />
      <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "600" }}>{title}</Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, textAlign: "center" }}>{hint}</Text>
      {children}
    </View>
  );
}

export function AgentKitScreen({ theme, layout }: PluginSurfaceProps) {
  const requestStatus = useRpc(kitStatusRpc);
  const requestImport = useRpc(importRpc);
  const requestProbe = useRpc(probeRpc);
  const requestMount = useRpc(mountRpc);
  const requestUserLevel = useRpc(userLevelRpc);
  const requestTrust = useRpc(trustRpc);
  const requestLocale = useRpc(localeRpc);
  const toast = useToast();
  const deviceLocale = useMemo(() => detectLocale(), []);
  const [status, setStatus] = useState<KitStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>("mcp");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [probes, setProbes] = useState<Record<string, ProbeState>>({});
  const generation = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await requestStatus({ deviceLocale });
      generation.current += 1;
      setProbes({});
      setStatus(next);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, [requestStatus, deviceLocale]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!status) {
      return;
    }
    if (!selectedId || !status.projects.some((project) => project.projectId === selectedId)) {
      setSelectedId(status.projects[0]?.projectId ?? null);
    }
  }, [status, selectedId]);

  useEffect(() => {
    if (!selectedId || probes[selectedId]) {
      return;
    }
    const gen = generation.current;
    const projectId = selectedId;
    setProbes((current) => ({ ...current, [projectId]: { status: "loading" } }));
    requestProbe({ projectId })
      .then((result) => {
        if (gen !== generation.current) {
          return;
        }
        const cells: Record<string, Cell> = {};
        for (const cell of result.cells) {
          cells[cellKey(cell.kind, cell.name, cell.harness)] = { state: cell.state, detail: cell.detail };
        }
        setProbes((current) => ({ ...current, [projectId]: { status: "done", cells } }));
      })
      .catch((cause: unknown) => {
        if (gen !== generation.current) {
          return;
        }
        setProbes((current) => ({ ...current, [projectId]: { status: "error", message: errorText(cause) } }));
      });
  }, [probes, requestProbe, selectedId]);

  const localePref: LocalePref = status?.locale ?? "auto";
  const locale = resolveLocale(localePref, deviceLocale);
  const tr = useCallback<Tr>((key, vars) => translate(locale, key, vars), [locale]);

  const run = useCallback(
    async <Result,>(action: () => Promise<Result>, done: (result: Result) => string) => {
      setBusy(true);
      try {
        const result = await action();
        const message = done(result);
        if (message) {
          toast.show(message, { variant: "success" });
        }
        await load();
      } catch (cause) {
        toast.error(errorText(cause));
      } finally {
        setBusy(false);
      }
    },
    [load, toast],
  );

  const project = status?.projects.find((entry) => entry.projectId === selectedId) ?? null;
  const probe = selectedId ? probes[selectedId] : undefined;
  const cells = probe?.status === "done" ? probe.cells : {};
  const allItems = status ? (kind === "mcp" ? status.mcp : status.skills) : [];
  const mountedSet = useMemo(
    () => new Set(project ? (kind === "mcp" ? project.mountedMcp : project.mountedSkills) : []),
    [project, kind],
  );
  const skillBlind = status ? status.harnesses.filter((harness) => !harness.projectSkills) : [];
  const needle = query.trim().toLowerCase();
  const items = needle
    ? allItems.filter((item) => item.name.toLowerCase().includes(needle) || item.summary.toLowerCase().includes(needle))
    : allItems;

  const pad = layout.compact ? 14 : 24;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <ScrollView contentContainerStyle={{ padding: pad, gap: 18, paddingBottom: pad * 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 200 }}>
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 9,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme.colors.surface2,
              }}
            >
              <Icon name="Blocks" size={18} color={theme.colors.foreground} />
            </View>
            <View style={{ gap: 2, flex: 1 }}>
              <Text style={{ color: theme.colors.foreground, fontSize: 18, fontWeight: "700" }}>{APP_NAME}</Text>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }} numberOfLines={1}>
                {status
                  ? tr("counts", { mcp: status.mcp.length, skills: status.skills.length, projects: status.projects.length })
                  : tr("tagline")}
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Segmented
              value={localePref}
              theme={theme}
              onChange={(next) => void run(() => requestLocale({ locale: next }), () => "")}
              options={LOCALE_PREFS.map((value) => ({
                value,
                label: value === "auto" ? tr("langAuto") : value === "en" ? "English" : "中文",
              }))}
            />
            {status ? (
              <Button
                label={tr(status.importedAt ? "rescanButton" : "importButton")}
                icon="Download"
                primary={!status.importedAt}
                theme={theme}
                disabled={loading || busy}
                onPress={() =>
                  void run(
                    () => requestImport({}),
                    (result) => {
                      if (result.conflicts.length > 0) {
                        toast.show(tr("importConflicts", { count: result.conflicts.length, names: result.conflicts.join(tr("listSep")) }), {
                          variant: "warning",
                          durationMs: 12_000,
                        });
                      }
                      if (result.failed.length > 0) {
                        toast.error(tr("importFailed", { paths: result.failed.map((failure) => failure.path).join(tr("listSep")) }));
                      }
                      return tr("importDone", { servers: result.servers, skills: result.skills });
                    },
                  )
                }
              />
            ) : null}
            <Button label={tr(loading ? "refreshing" : "refresh")} icon="RefreshCw" theme={theme} disabled={loading} onPress={() => void load()} />
          </View>
        </View>

        {error ? (
          <View style={{ padding: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.statusDanger, backgroundColor: theme.colors.surface1 }}>
            <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>{error}</Text>
          </View>
        ) : null}

        {!status && !error ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{tr("loading")}</Text> : null}

        {status && !status.importedAt && status.mcp.length === 0 && status.skills.length === 0 ? (
          <EmptyState
            icon="Download"
            title={tr("emptyCatalogTitle")}
            hint={tr("emptyCatalogHint", { harnesses: status.importSources.join(tr("listSep")) })}
            theme={theme}
          />
        ) : null}

        {status && status.projects.length === 0 ? (
          <EmptyState icon="FolderGit2" title={tr("noProjectsTitle")} hint={tr("noProjectsHint")} theme={theme} />
        ) : null}

        {status && project ? (
          <>
            <View style={{ gap: 8 }}>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "600", letterSpacing: 0.5 }}>{tr("projects")}</Text>
              <ProjectChips projects={status.projects} selectedId={selectedId} theme={theme} tr={tr} onSelect={(id) => {
                setSelectedId(id);
                setExpanded(null);
              }} />
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontFamily: "Menlo" }} numberOfLines={1}>
                {project.rootPath}
              </Text>
            </View>

            <View style={{ flexDirection: layout.compact ? "column" : "row", alignItems: layout.compact ? "stretch" : "center", gap: 10 }}>
              <Segmented
                value={kind}
                theme={theme}
                onChange={(next) => {
                  setKind(next);
                  setExpanded(null);
                }}
                options={(["mcp", "skill"] as const).map((value) => ({
                  value,
                  label: tr(KIND_KEY[value]),
                  count: `${(value === "mcp" ? project.mountedMcp : project.mountedSkills).length}/${(value === "mcp" ? status.mcp : status.skills).length}`,
                }))}
              />
              <View
                style={{
                  flex: layout.compact ? undefined : 1,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingHorizontal: 10,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface1,
                }}
              >
                <Icon name="Search" size={14} color={theme.colors.foregroundMuted} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder={tr("search", { kind: tr(KIND_KEY[kind]) })}
                  placeholderTextColor={theme.colors.foregroundMuted}
                  style={{ flex: 1, color: theme.colors.foreground, fontSize: 12, paddingVertical: 7 }}
                />
              </View>
            </View>

            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
                  {tr(kind === "mcp" ? "helpMcp" : "helpSkill", { project: project.name })}
                </Text>
                <Legend theme={theme} tr={tr} />
              </View>
              {kind === "skill" && skillBlind.length > 0 ? (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: 8,
                    padding: 10,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: theme.colors.statusWarning,
                    backgroundColor: theme.colors.surface1,
                  }}
                >
                  <Icon name="TriangleAlert" size={14} color={theme.colors.statusWarning} />
                  <Text style={{ flex: 1, color: theme.colors.statusWarning, fontSize: 12 }}>
                    {tr("skillBlind", { harnesses: skillBlind.map((harness) => harness.label).join(tr("listSep")) })}
                  </Text>
                </View>
              ) : null}
              {probe?.status === "error" ? (
                <Text style={{ color: theme.colors.statusDanger, fontSize: 11 }}>{tr("probeFailed", { message: probe.message })}</Text>
              ) : null}
              {items.length === 0 ? (
                <EmptyState
                  icon={kind === "mcp" ? "Server" : "Sparkles"}
                  title={needle ? tr("noMatch") : tr("noneYet", { kind: tr(KIND_KEY[kind]) })}
                  hint={needle ? tr("noMatchHint", { kind: tr(KIND_KEY[kind]), query: query.trim() }) : tr("noneHint")}
                  theme={theme}
                />
              ) : (
                <View
                  style={{
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.surface1,
                    overflow: "hidden",
                  }}
                >
                  {items.map((item, index) => {
                    const mounted = mountedSet.has(item.name);
                    const rowKey = `${kind}:${item.name}`;
                    return (
                      <ItemRow
                        key={rowKey}
                        item={item}
                        kind={kind}
                        mounted={mounted}
                        harnesses={status.harnesses}
                        cells={cells}
                        probe={probe}
                        expanded={expanded === rowKey}
                        busy={busy}
                        compact={layout.compact}
                        last={index === items.length - 1}
                        theme={theme}
                        tr={tr}
                        onToggleExpand={() => setExpanded((current) => (current === rowKey ? null : rowKey))}
                        onMount={(mount) =>
                          void run(
                            () => requestMount({ kind, name: item.name, projectId: project.projectId, mount }),
                            () => tr(mount ? "mounted" : "unmounted", { name: item.name, project: project.name }),
                          )
                        }
                        onUserLevel={(userLevel) =>
                          void run(
                            () => requestUserLevel({ kind, name: item.name, userLevel }),
                            () => tr(userLevel ? "globalOn" : "globalOff", { name: item.name }),
                          )
                        }
                        onTrust={(harness) =>
                          void run(
                            () => requestTrust({ harness: harness.id, name: item.name, projectId: project.projectId }),
                            () => tr("trusted", { name: item.name, harness: harness.label, project: project.name }),
                          )
                        }
                      />
                    );
                  })}
                </View>
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
