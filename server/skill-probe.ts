import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProbeCell } from "../shared/api";
import { t } from "./locale";
import type { McpSupport, SkillSupport } from "./harness";
import { readJsonDoc } from "./mcp-config";

/**
 * Cursor and Kiro have no command that lists loaded skills, so we check what they
 * would find on disk: a skill directory with a valid SKILL.md (name + description)
 * in a root the harness reads. This confirms the file is where the harness looks;
 * it cannot see a harness that skips a skill for its own reasons.
 */

function frontmatterProblem(dir: string, name: string): string | null {
  let text: string;
  try {
    text = readFileSync(join(dir, "SKILL.md"), "utf8");
  } catch {
    return t("skillNoFile");
  }
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
  if (block === undefined) {
    return t("skillNoFrontmatter");
  }
  const field = (key: string) => {
    const raw = new RegExp(`^${key}:\\s*(.*)$`, "m").exec(block)?.[1]?.trim() ?? "";
    return /^(["'])(.*)\1$/.exec(raw)?.[2] ?? raw;
  };
  if (field("name") !== name) {
    return t("skillNameMismatch", { name: field("name") || "—" });
  }
  // `description: >-` style blocks leave the value on the following lines
  if (!/^description:/m.test(block)) {
    return t("skillNoDescription");
  }
  return null;
}

function isBrokenLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink() && !existsSync(path);
  } catch {
    return false;
  }
}

export function skillFileCells(harness: string, label: string, support: SkillSupport, rootPath: string, names: readonly string[]): ProbeCell[] {
  const userRoots = support.userScan;
  const projectRoots = support.projectScan(rootPath);
  return names.map((name): ProbeCell => {
    const cell = (state: ProbeCell["state"], detail: string): ProbeCell => ({ kind: "skill", name, harness, state, detail });
    let sessionBlind: string | null = null;
    let problem: string | null = null;
    const roots = [...userRoots.map((root) => ({ root, project: false })), ...projectRoots.map((root) => ({ root, project: true }))];
    for (const { root, project } of roots) {
      const dir = join(root, name);
      if (isBrokenLink(dir)) {
        problem = problem ?? t("skillBrokenLink", { path: dir });
        continue;
      }
      if (!existsSync(dir)) {
        continue;
      }
      if (project && !support.projectLoaded) {
        sessionBlind = sessionBlind ?? dir;
        continue;
      }
      const bad = frontmatterProblem(dir, name);
      if (bad) {
        problem = problem ?? t("skillInvalid", { path: dir, reason: bad });
        continue;
      }
      return cell("loaded", t("skillFileFound", { path: dir, harness: label }));
    }
    if (problem) {
      return cell("failed", problem);
    }
    if (sessionBlind) {
      return cell("failed", t("skillSessionBlind", { harness: label, path: sessionBlind }));
    }
    return cell("failed", t("skillFileMissing", { harness: label }));
  });
}

/** MCP counterpart of the file check, for harnesses with no command that reports server status. */
export function mcpFileCells(harness: string, label: string, mcp: McpSupport, rootPath: string, names: readonly string[]): ProbeCell[] {
  const files = [mcp.userPath, ...(mcp.projectPath ? [mcp.projectPath(rootPath)] : [])].filter((path) => existsSync(path));
  const servers = files.map((path) => ({ path, servers: mcp.format.read(readJsonDoc(path).doc) }));
  return names.map((name): ProbeCell => {
    const hit = servers.find((entry) => name in entry.servers);
    if (!hit) {
      return { kind: "mcp", name, harness, state: "failed", detail: t("mcpFileMissing", { harness: label }) };
    }
    if (hit.servers[name]?.enabled === false) {
      return { kind: "mcp", name, harness, state: "failed", detail: t("mcpFileDisabled", { path: hit.path }) };
    }
    return { kind: "mcp", name, harness, state: "loaded", detail: t("mcpFileFound", { path: hit.path, harness: label }) };
  });
}
