import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { LoadState, ProbeCell } from "../shared/api";

export const PROJECT_HARNESS_IDS = ["cursor", "kiro", "qoder"] as const;

const CLI_TIMEOUT_MS = 45_000;

export interface ProbeNames {
  readonly mcp: readonly string[];
  readonly skills: readonly string[];
}

export interface CliRun {
  readonly code: number | null;
  readonly out: string;
}

/** Approval/auth before generic failure: Cursor prints `not loaded (needs approval)`. */
export function classifyLoad(detail: string): LoadState {
  const text = detail.toLowerCase();
  if (/needs approval|not approved/.test(text)) {
    return "approval";
  }
  if (/needs auth|unauthorized|not logged in|please log ?in|authentication required/.test(text)) {
    return "auth";
  }
  if (/\bready\b|\bconnected\b|\benabled\b/.test(text)) {
    return "loaded";
  }
  return "failed";
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * `kiro-cli mcp list default` shows the servers merged into the kiro_default agent
 * (global + workspace files) as `• name  command`. Kiro has no load status or
 * approval gate, so presence is all it can tell us.
 */
function kiroMcpCells(names: readonly string[], run: CliRun): ProbeCell[] {
  const failure = commandFailure(run);
  if (failure) {
    return names.map((name) => ({ kind: "mcp" as const, name, harness: "kiro", state: "failed" as const, detail: failure }));
  }
  const listed = new Set(
    stripAnsi(run.out)
      .split("\n")
      .map((line) => /^\s*•\s+(\S+)/.exec(line)?.[1])
      .filter((name): name is string => Boolean(name)),
  );
  return names.map((name) =>
    listed.has(name)
      ? { kind: "mcp" as const, name, harness: "kiro", state: "unknown" as const, detail: "已配置到 kiro_default，Kiro 不报告连接状态" }
      : { kind: "mcp" as const, name, harness: "kiro", state: "failed" as const, detail: "未出现在 kiro_default 列表" },
  );
}

export function findSkillHeader(out: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = stripAnsi(out).match(new RegExp(`^${escaped} \\[([^\\]]+)\\]\\s*$`, "m"));
  return match ? match[0].trim() : null;
}

export function findLine(out: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|[\\s✓✗●])${escaped}(?=\\s|:|\\[|$)`);
  for (const line of stripAnsi(out).split("\n")) {
    if (re.test(line)) {
      return line.trim();
    }
  }
  return null;
}

function detailFromLine(line: string, name: string): string {
  const index = line.indexOf(name);
  const rest = line.slice(index + name.length).replace(/^[\s:：\-–—]+/, "").trim();
  return rest || line;
}

export function runCli(cmd: string, args: readonly string[], cwd: string): Promise<CliRun> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      resolve({ code: null, out: message });
      return;
    }
    const stdout = child.stdout;
    const stderr = child.stderr;
    if (!stdout || !stderr) {
      resolve({ code: null, out: "子进程没有输出管道" });
      return;
    }
    let out = "";
    let settled = false;
    const finish = (result: CliRun) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ code: null, out: `${out}\n(超时)` });
    }, CLI_TIMEOUT_MS);
    stdout.setEncoding("utf8");
    stderr.setEncoding("utf8");
    stdout.on("data", (chunk: string) => {
      out += chunk;
    });
    stderr.on("data", (chunk: string) => {
      out += chunk;
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish({ code: null, out: error.message });
    });
    child.on("close", (code) => {
      finish({ code, out });
    });
  });
}

function commandFailure(run: CliRun): string | null {
  if (/not logged in|please log ?in/i.test(run.out)) {
    return run.out.trim().slice(0, 180) || "未登录";
  }
  if (run.code === null) {
    return run.out.trim().slice(-180) || "命令失败";
  }
  if (run.code !== 0 && !run.out.trim()) {
    return `退出码 ${run.code}`;
  }
  return null;
}

function cellsForNames(
  kind: "mcp" | "skill",
  harness: string,
  names: readonly string[],
  run: CliRun,
  missingDetail: string,
): ProbeCell[] {
  const failure = commandFailure(run);
  if (failure) {
    const state: LoadState = classifyLoad(failure) === "auth" ? "auth" : "failed";
    return names.map((name) => ({ kind, name, harness, state, detail: failure }));
  }
  return names.map((name) => {
    const line = findLine(run.out, name);
    if (!line) {
      return { kind, name, harness, state: "failed" as const, detail: missingDetail };
    }
    const detail = detailFromLine(line, name);
    return { kind, name, harness, state: classifyLoad(detail), detail };
  });
}

function qoderSkillCells(names: readonly string[], run: CliRun): ProbeCell[] {
  const failure = commandFailure(run);
  if (failure) {
    const state: LoadState = classifyLoad(failure) === "auth" ? "auth" : "failed";
    return names.map((name) => ({ kind: "skill" as const, name, harness: "qoder", state, detail: failure }));
  }
  return names.map((name) => {
    const line = findSkillHeader(run.out, name);
    if (!line) {
      return { kind: "skill" as const, name, harness: "qoder", state: "failed" as const, detail: "未出现在 Qoder skill 列表" };
    }
    const detail = detailFromLine(line, name);
    return { kind: "skill" as const, name, harness: "qoder", state: classifyLoad(detail), detail };
  });
}

function staticCells(
  kind: "mcp" | "skill",
  harness: string,
  names: readonly string[],
  detail: string,
  state: LoadState = "failed",
): ProbeCell[] {
  return names.map((name) => ({ kind, name, harness, state, detail }));
}

export async function probeProject(rootPath: string, names: ProbeNames): Promise<ProbeCell[]> {
  if (!existsSync(rootPath)) {
    return [
      ...PROJECT_HARNESS_IDS.flatMap((harness) => staticCells("mcp", harness, names.mcp, "项目目录不存在")),
      ...PROJECT_HARNESS_IDS.flatMap((harness) => staticCells("skill", harness, names.skills, "项目目录不存在")),
    ];
  }
  const [cursor, qoderMcp, kiro, qoderSkills] = await Promise.all([
    runCli("agent", ["mcp", "list"], rootPath),
    runCli("qodercli", ["mcp", "list"], rootPath),
    runCli("kiro-cli", ["mcp", "list", "default"], rootPath),
    runCli("qodercli", ["skills", "list"], rootPath),
  ]);
  return [
    ...cellsForNames("mcp", "cursor", names.mcp, cursor, "未出现在 Cursor 列表"),
    ...kiroMcpCells(names.mcp, kiro),
    ...cellsForNames("mcp", "qoder", names.mcp, qoderMcp, "未出现在 Qoder 列表"),
    ...staticCells("skill", "cursor", names.skills, "Cursor 不报告 skill 加载结果", "unknown"),
    ...staticCells("skill", "kiro", names.skills, "Kiro 不报告 skill 加载结果", "unknown"),
    ...qoderSkillCells(names.skills, qoderSkills),
  ];
}
