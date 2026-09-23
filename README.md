# Agent Kit

A [Paseo](https://paseo.sh) plugin for managing MCP servers and skills across coding-agent harnesses from one place, at user, project and session scope.

Each harness keeps MCP and skill config in its own files with its own format and loading rules. Agent Kit keeps one store of MCP servers and skills and syncs them into each harness's native locations. It also checks what each harness actually loads.

## Features

- **One catalog** of MCP servers and skills. You can seed it once from your existing Cursor config.
- **Global or per-project**: each entry is either global (user-level, so every session gets it) or mounted on specific Paseo projects.
- **Load probe**: runs each harness's own CLI (`agent mcp list`, `kiro-cli mcp list`, `qodercli mcp list`) in the project directory and shows the result per harness.
- **Safe writes**: before each write it makes a `.agent-kit.bak` backup and replaces the file atomically. It only removes entries it wrote itself, which it tracks in an ownership lock at `~/.paseo/agent-kit.lock.json`. Entries it didn't write are never touched.
- **Session injection**: MCP servers can be injected into every Paseo agent through the `agent.create` hook.

## Supported harnesses and verified loading

These results come from live Paseo sessions, using fixture MCP servers and skills placed in each location:

| Harness | User MCP | Project MCP | User skills | Project skills |
|---|---|---|---|---|
| Kiro | `~/.kiro/settings/mcp.json` | `.kiro/settings/mcp.json` | `~/.kiro/skills` | `.kiro/skills` |
| Qoder | `~/.qoder/settings.json` | `.mcp.json` | `~/.agents/skills`, `~/.qoder/skills` | `.qoder/skills`, `.agents/skills` |
| Cursor (ACP in Paseo) | `~/.cursor/mcp.json` | not read (see below) | `~/.cursor/skills`, `~/.agents/skills`, `~/.claude/skills` | not read |

User-level MCP servers are also synced to OpenCode (`~/.config/opencode/opencode.json`) and Oh My Pi (`~/.omp/agent/mcp.json`).

### Cursor caveats

- **Cursor in ACP mode ignores project-level config.** For Cursor sessions, Agent Kit injects the project's non-global MCP servers into the session through `agent.create`, based on the session's working directory. Paseo has no skill-injection API, so project-only skills are **not** available in Cursor sessions. The dashboard warns about this.
- **The Cursor CLI and IDE gate project MCP servers behind approval.** When a server is mounted on a project, Agent Kit runs `agent mcp enable <name>` there. For servers shown as "pending trust", a **Trust** button runs the same command. Approval keys include a hash of the config, so editing a server re-approves it.
- In Cursor, a project entry shadows the user entry with the same name and needs approval. So global servers are never also written to project files.

## Scopes

**MCP servers**

- *Global* on: written to every harness's user-level file. The project toggle is locked on.
- *Global* off: written only to the project files of the projects it is mounted on. Cursor sessions get it through injection.

**Skills**

- *Global* on: symlinked into each harness's user-level skill directory.
- *Global* off: if the skill's source directory sits in a directory harnesses scan on their own (such as `~/.agents/skills`), it is moved to `~/.paseo/agent-kit/skills/<name>`. Otherwise it would stay visible everywhere. After that it is symlinked only into the project skill directories of mounted projects.
- Skills named `paseo` or `paseo-*` are Paseo's own bundled skills. Paseo re-syncs them, so they are locked to global.

## Install

Requires Paseo `>= 0.8.0` and the CLIs of the harnesses you use (`agent`, `kiro-cli`, `qodercli`) on `PATH`.

```bash
paseo plugin install github:capcdk/paseo-agent-kit
```

For local development:

```bash
git clone https://github.com/capcdk/paseo-agent-kit.git
cd paseo-agent-kit && npm install
paseo plugin install .
```

After you change local server code, run `paseo plugin reload agent-kit`.

## Data locations

| Path | Purpose |
|---|---|
| `~/.paseo/plugin-settings/agent-kit/kit-store.json` | Catalog of MCP servers and skills |
| `~/.paseo/agent-kit.lock.json` | Ownership lock: which entries Agent Kit wrote to which file |
| `~/.paseo/agent-kit/skills/` | Skills moved out of auto-scanned directories |
| `<file>.agent-kit.bak` | Backup taken before each write |

The plugin runs unsandboxed with your user's permissions. It reads and writes the harness config files listed above.

## Development

```bash
npm install
npm run typecheck
```

The UI is React Native (rendered by Paseo). Server code runs inside the Paseo daemon.

## License

MIT
