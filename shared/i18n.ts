export type Locale = "en" | "zh";
export type LocalePref = "auto" | Locale;

export const LOCALE_PREFS: readonly LocalePref[] = ["auto", "en", "zh"];

export function detectLocale(): Locale {
  try {
    return /^zh\b/i.test(Intl.DateTimeFormat().resolvedOptions().locale) ? "zh" : "en";
  } catch {
    return "en";
  }
}

export function resolveLocale(pref: LocalePref, device: Locale = detectLocale()): Locale {
  return pref === "auto" ? device : pref;
}

const en = {
  listSep: ", ",

  // server: errors
  unknownProject: "Unknown project: {id}",
  unknownMcp: "Unknown MCP server: {name}",
  unknownSkill: "Unknown skill: {name}",
  unknownHarness: "Unknown harness: {id}",
  alreadyGlobal: "{name} already loads globally; no per-project mount needed",
  cannotUnglobal: "{name} cannot stop loading globally: {reason}",
  paseoBundledLock: "Bundled Paseo skill. Paseo copies it back into the user skill directory",
  relocateTargetExists: "Relocation target already exists: {path}",
  linkOccupied: "A real directory is already there; left untouched",
  noApproval: "{harness} has no approval step",
  approveFailed: "{harness} approval of {name} failed: {detail}",

  // server: CLI runs and load checks
  exitCode: "exit code {code}",
  noPipes: "child process has no output pipes",
  timedOut: "(timed out)",
  notLoggedIn: "not logged in",
  commandFailed: "command failed",
  projectDirMissing: "Project directory does not exist",
  notListed: "Not listed by {harness}",
  kiroConfigured: "Configured in kiro_default. Kiro does not report connection status",
  kiroNotListed: "Not listed in kiro_default",
  skillNotReported: "{harness} does not report skill loading",

  // client: load states
  stateLoaded: "Loaded",
  stateApproval: "Needs trust",
  stateAuth: "Needs auth",
  stateFailed: "Not loaded",
  stateUnknown: "Not reported",
  statePending: "Checking",

  kindMcp: "MCP",
  kindSkill: "Skills",

  // client: header
  openApp: "Open {app}",
  tagline: "MCP servers and skills in one place",
  counts: "{mcp} MCP · {skills} skills · {projects} projects",
  importButton: "Import from harnesses",
  rescanButton: "Re-scan",
  refresh: "Refresh",
  refreshing: "Refreshing…",
  loading: "Loading…",
  langAuto: "Auto",
  langLabel: "Language",
  importDone: "Imported {servers} MCP servers and {skills} skills",
  importConflicts: "{count} name conflicts kept the first definition found: {names}",
  importFailed: "Import finished but some files could not be written: {paths}",

  // client: empty states
  emptyCatalogTitle: "Nothing managed yet",
  emptyCatalogHint:
    "Import the MCP servers and skills already configured in {harnesses}, at user and project level. After that, mount them onto projects here.",
  noProjectsTitle: "No projects",
  noProjectsHint: "Open a project in Paseo, then mount MCP servers and skills onto it here.",
  noMatch: "No matches",
  noneYet: "No {kind} yet",
  noMatchHint: "No {kind} has a name or path containing “{query}”.",
  noneHint: "Imported items show up here.",

  // client: board
  projects: "Projects",
  projectChip: "{name}, {count} mounted",
  search: "Search {kind}",
  helpMcp:
    "Global writes to user-level config, so every session loads it and the Project switch stays on. With Global off, the Project switch decides whether it is written to {project}'s project config. When a harness shows Needs trust, press Trust to approve it. Badges show what each harness actually loads; press a row for the raw output.",
  helpSkill:
    "Global links into user-level skill directories, so every session has it and the Project switch stays on. Turning Global off moves the source to ~/.paseo/agent-kit/skills; after that the Project switch decides whether it is linked into {project}.",
  skillBlind:
    "{harnesses} does not load project-level skills in Paseo sessions. Skills that are only mounted on projects are unavailable in those sessions.",
  probeFailed: "Load check failed: {message}",

  // client: rows
  rowExpand: "Show load details for {name}",
  rowCollapse: "Hide load details for {name}",
  projectOnlyBlind: "Project only: unavailable in {harnesses} sessions",
  trust: "Trust in {harness}",
  global: "Global",
  project: "Project",
  globalLockHint: "Can't turn off Global: {reason}",
  a11yGlobalLocked: "{name} is locked to global: {reason}",
  a11yGlobalOff: "Stop loading {name} in every session",
  a11yGlobalOn: "Load {name} in every session",
  projectLockHint: "Loads globally, so every project already has it. Turn off Global to mount it per project.",
  a11yMountLocked: "{name} loads globally; the project mount can't be changed",
  a11yUnmount: "Unmount {name} from this project",
  a11yMount: "Mount {name} on this project",

  // client: toasts
  mounted: "Mounted {name} on {project}",
  unmounted: "Unmounted {name} from {project}",
  globalOn: "{name} now loads in every session",
  globalOff: "{name} no longer loads globally; only mounted projects get it",
  trusted: "Trusted {name} in {harness} ({project})",
} as const;

export type MessageKey = keyof typeof en;

const zh: Record<MessageKey, string> = {
  listSep: "、",

  unknownProject: "未知项目：{id}",
  unknownMcp: "未知 MCP：{name}",
  unknownSkill: "未知 Skill：{name}",
  unknownHarness: "未知 harness：{id}",
  alreadyGlobal: "{name} 已全局加载，无需按项目挂载",
  cannotUnglobal: "{name} 无法取消全局：{reason}",
  paseoBundledLock: "Paseo 自带 Skill，会被 Paseo 重新同步到用户目录",
  relocateTargetExists: "迁移目标已存在：{path}",
  linkOccupied: "目标位置已被真实目录占用，未覆盖",
  noApproval: "{harness} 没有审批步骤",
  approveFailed: "{harness} 审批 {name} 失败：{detail}",

  exitCode: "退出码 {code}",
  noPipes: "子进程没有输出管道",
  timedOut: "(超时)",
  notLoggedIn: "未登录",
  commandFailed: "命令失败",
  projectDirMissing: "项目目录不存在",
  notListed: "未出现在 {harness} 列表",
  kiroConfigured: "已配置到 kiro_default，Kiro 不报告连接状态",
  kiroNotListed: "未出现在 kiro_default 列表",
  skillNotReported: "{harness} 不报告 skill 加载结果",

  stateLoaded: "已加载",
  stateApproval: "待信任",
  stateAuth: "需授权",
  stateFailed: "未加载",
  stateUnknown: "不报告",
  statePending: "检测中",

  kindMcp: "MCP",
  kindSkill: "Skill",

  openApp: "打开 {app}",
  tagline: "MCP 与 Skill 统一管理",
  counts: "{mcp} 个 MCP · {skills} 个 Skill · {projects} 个项目",
  importButton: "从各 harness 导入",
  rescanButton: "重新扫描",
  refresh: "刷新",
  refreshing: "刷新中…",
  loading: "加载中…",
  langAuto: "自动",
  langLabel: "语言",
  importDone: "已导入 {servers} 个 MCP、{skills} 个 Skill",
  importConflicts: "{count} 个同名冲突，保留了先扫描到的定义：{names}",
  importFailed: "导入完成，但部分文件写入失败：{paths}",

  emptyCatalogTitle: "还没有接管任何配置",
  emptyCatalogHint: "从 {harnesses} 的用户级和项目级配置导入现有的 MCP 和 Skill，之后在这里统一挂载到各项目。",
  noProjectsTitle: "没有项目",
  noProjectsHint: "在 Paseo 里打开一个项目后，这里就能为它挂载 MCP 和 Skill。",
  noMatch: "没有匹配项",
  noneYet: "还没有 {kind}",
  noMatchHint: "没有名称或路径包含「{query}」的 {kind}。",
  noneHint: "导入后会出现在这里。",

  projects: "项目",
  projectChip: "{name}，已挂载 {count} 项",
  search: "搜索 {kind}",
  helpMcp:
    "「全局」写入用户级配置，所有会话都会加载，此时项目开关锁定为开启；关闭全局后「项目」开关决定是否写入「{project}」的项目配置。显示「待信任」时点「信任」放行。徽章为各 harness 实测加载结果，点行查看原始输出。",
  helpSkill:
    "「全局」链接到用户级 Skill 目录，所有会话可用，此时项目开关锁定为开启；关闭全局会把源目录迁到 ~/.paseo/agent-kit/skills，之后「项目」开关决定是否链接到「{project}」。",
  skillBlind: "{harnesses} 在 Paseo 会话中不加载项目级 Skill。只挂到项目、没开「全局」的 Skill，在这些会话里不可用。",
  probeFailed: "检测失败：{message}",

  rowExpand: "展开 {name} 的加载详情",
  rowCollapse: "收起 {name} 的加载详情",
  projectOnlyBlind: "仅项目级：{harnesses} 会话中不可用",
  trust: "在 {harness} 信任",
  global: "全局",
  project: "项目",
  globalLockHint: "无法关闭全局：{reason}",
  a11yGlobalLocked: "{name} 锁定为全局：{reason}",
  a11yGlobalOff: "取消 {name} 的用户级加载",
  a11yGlobalOn: "让 {name} 在所有会话加载",
  projectLockHint: "已全局加载，所有项目都会生效；先关闭「全局」才能按项目挂载",
  a11yMountLocked: "{name} 已全局加载，项目挂载不可调整",
  a11yUnmount: "从当前项目卸载 {name}",
  a11yMount: "挂载 {name} 到当前项目",

  mounted: "已挂载 {name} 到 {project}",
  unmounted: "已从 {project} 卸载 {name}",
  globalOn: "{name} 已设为全局加载",
  globalOff: "{name} 已取消全局，仅在挂载的项目中加载",
  trusted: "已在 {harness} 信任 {name}（{project}）",
};

const MESSAGES: Record<Locale, Record<MessageKey, string>> = { en, zh };

export type Vars = Readonly<Record<string, string | number>>;

export function translate(locale: Locale, key: MessageKey, vars?: Vars): string {
  const template = MESSAGES[locale][key];
  return vars ? template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match)) : template;
}
