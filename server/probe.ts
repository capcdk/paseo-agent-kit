import { spawn } from "node:child_process";
import type { LoadState, ProbeCell } from "../shared/api";
import { t } from "./locale";

const CLI_TIMEOUT_MS = 45_000;

type Kind = ProbeCell["kind"];

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
      resolve({ code: null, out: t("noPipes") });
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
      finish({ code: null, out: `${out}\n${t("timedOut")}` });
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

export function commandFailure(run: CliRun): string | null {
  if (/not logged in|please log ?in/i.test(run.out)) {
    return run.out.trim().slice(0, 180) || t("notLoggedIn");
  }
  if (run.code === null) {
    return run.out.trim().slice(-180) || t("commandFailed");
  }
  if (run.code !== 0 && !run.out.trim()) {
    return t("exitCode", { code: run.code });
  }
  return null;
}

function failedCells(kind: Kind, harness: string, names: readonly string[], failure: string): ProbeCell[] {
  const state: LoadState = classifyLoad(failure) === "auth" ? "auth" : "failed";
  return names.map((name) => ({ kind, name, harness, state, detail: failure }));
}

/** CLI output with one line per item, where the text after the name carries its load state. */
export function cellsFromLines(kind: Kind, harness: string, label: string, names: readonly string[], run: CliRun): ProbeCell[] {
  const failure = commandFailure(run);
  if (failure) {
    return failedCells(kind, harness, names, failure);
  }
  return names.map((name) => {
    const line = findLine(run.out, name);
    if (!line) {
      return { kind, name, harness, state: "failed" as const, detail: t("notListed", { harness: label }) };
    }
    const detail = detailFromLine(line, name);
    return { kind, name, harness, state: classifyLoad(detail), detail };
  });
}

/** CLI output with one `name [state]` header per item. */
export function cellsFromHeaders(kind: Kind, harness: string, label: string, names: readonly string[], run: CliRun): ProbeCell[] {
  const failure = commandFailure(run);
  if (failure) {
    return failedCells(kind, harness, names, failure);
  }
  return names.map((name) => {
    const line = findSkillHeader(run.out, name);
    if (!line) {
      return { kind, name, harness, state: "failed" as const, detail: t("notListed", { harness: label }) };
    }
    const detail = detailFromLine(line, name);
    return { kind, name, harness, state: classifyLoad(detail), detail };
  });
}

/**
 * `kiro-cli mcp list default` shows the servers merged into the kiro_default agent
 * (global + workspace files) as `• name  command`. Kiro has no load status or
 * approval gate, so presence is all it can tell us.
 */
export function cellsFromBullets(kind: Kind, harness: string, names: readonly string[], run: CliRun): ProbeCell[] {
  const failure = commandFailure(run);
  if (failure) {
    return names.map((name) => ({ kind, name, harness, state: "failed" as const, detail: failure }));
  }
  const listed = new Set(
    stripAnsi(run.out)
      .split("\n")
      .map((line) => /^\s*•\s+(\S+)/.exec(line)?.[1])
      .filter((name): name is string => Boolean(name)),
  );
  return names.map((name) =>
    listed.has(name)
      ? { kind, name, harness, state: "unknown" as const, detail: t("kiroConfigured") }
      : { kind, name, harness, state: "failed" as const, detail: t("kiroNotListed") },
  );
}

export function staticCells(kind: Kind, harness: string, names: readonly string[], detail: string, state: LoadState = "failed"): ProbeCell[] {
  return names.map((name) => ({ kind, name, harness, state, detail }));
}
