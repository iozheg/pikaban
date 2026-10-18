# pikaban: guide for agents

This file is for an AI agent. Read it when the user asks how to install, set up or use pikaban, or asks a question about it. Answer from this file; do not guess commands or flags. `pikaban <command> --help` shows the details of the installed version.

## What pikaban is

pikaban is a local task tracker for one user and one AI coding agent. The tasks of a project are Markdown files in `<project>/.pikaban/tasks/`. The user sees them on a Kanban board in the browser (`pikaban ui`). The agent works with them through the `pikaban` CLI. There is no server in the cloud and no account: all data is in the project folder.

Each task file has YAML frontmatter (`id`, `short`, `title`, `category`, `assignee`, `needs_input`, `created_at`, `updated_at`) and a free Markdown body. Only the CLI and the board write the frontmatter. The user and the agent can edit the body directly.

## How you, the agent, work with tasks

If the pikaban skill is installed (`.claude/skills/pikaban/SKILL.md` in the project or `~/.claude/skills/pikaban/SKILL.md`), follow the skill for all task work: it has the protocol rules and what to do for each exit code. Without the skill, use these rules:

- Read with `--json`: `pikaban list --json`, `pikaban show <ref> --json`. The JSON output is stable; the human text is not.
- Change the frontmatter only with the CLI (`add`, `move`, `set`, `note`, `delete`). Never edit it by hand.
- Do not start a task with `needs_input: true` or `assignee: user`. To ask questions: `pikaban note <ref> "<questions>"`, then `pikaban set <ref> --needs-input true`.
- Start a task: `pikaban move <ref> in_progress --assignee agent`. Finish it: `pikaban move <ref> review` if the project has `review`, otherwise `pikaban move <ref> done`.
- Do not run `pikaban init`, `pikaban ui` or `pikaban categories enable|disable` unless the user asks.

## Install

```sh
npm install -g pikaban
```

- The CLI needs Node.js 20 or later.
- `EACCES` on `npm install -g`: do not tell the user to use `sudo`. Recommend a Node version manager ([nvm](https://github.com/nvm-sh/nvm), [fnm](https://github.com/Schniz/fnm), [Volta](https://volta.sh/)), or a user prefix: `npm config set prefix ~/.npm-global` and `~/.npm-global/bin` in `PATH`.
- From source (unreleased changes). `npm install -g github:iozheg/pikaban` does **not** work with npm 10 (the `prepare` build runs without the dev dependencies and stops with `tsup: command not found`). Use this instead (the build needs Node.js 20.19+ or 22.12+):

  ```sh
  git clone https://github.com/iozheg/pikaban.git
  cd pikaban
  npm ci          # also builds dist/
  npm pack        # makes pikaban-<version>.tgz
  npm install -g ./pikaban-*.tgz
  ```

- Cloud and remote agent sessions do not have the user's global npm packages. Add `npm install -g pikaban` to the setup script of the environment, and commit the project skill (`.claude/skills/pikaban/`) so that the session gets it.

## Set up a project

`pikaban init` in the project folder makes `.pikaban/` (`config.json` and `tasks/`) and adds the project to the global list in `~/.pikaban_config.json`. In a terminal it asks these questions. Without a terminal (you, a script, CI) it never asks: give the flags, or it stops with exit code 2 and writes nothing.

| Question | Answers | Default | Flag |
|---|---|---|---|
| Optional categories | `backlog`, `review` | `backlog` only | `--backlog` / `--no-backlog`, `--review` / `--no-review` |
| Install the agent skill? | `project`, `user`, `none` | `project` | `--skill <answer>` (required without a terminal) |
| Let the agent run `pikaban` without permission prompts? | yes / no | no | `--allow` / `--no-allow` (required without a terminal) |
| Keep the pikaban files in git? (only in a git repository) | yes / no | yes | `--git` / `--no-git` |

Ask the user each question before you run `pikaban init` for them, then give a flag for each answer, for example `pikaban init --skill project --no-allow --backlog --no-review --git`. Use `--yes` (all defaults) only when the user tells you to. `--name` and `--id` set the project name and ID (default: the folder name).

- **Categories** are the board columns: `backlog, todo, in_progress, review, done`. `todo`, `in_progress` and `done` always exist. `backlog` holds tasks for later. With `review`, the agent's finished tasks wait for the user's check, and the user moves them to `done`. Change them later: `pikaban categories enable|disable backlog|review` (disable stops with code 1 while the category has tasks).
- **Skill scope.** `project` puts the skill in `<project>/.claude/skills/pikaban/` (commit it for teammates and cloud sessions). `user` puts it in `~/.claude/skills/pikaban/` for all projects.
- **Permission rule.** "yes" adds `Bash(pikaban:*)` to `permissions.allow` in `<project>/.claude/settings.json`. The existing JSON is merged, a backup `settings.json.bak` is written, and an invalid file is not changed.
- **Git.** pikaban never runs git. "yes" changes nothing: the user commits `.pikaban/` when they want. "no" adds the pikaban files to `.git/info/exclude` (local only, not shared).

## Agents other than Claude Code

pikaban installs its skill only for Claude Code. Any other agent that can run shell commands can use pikaban too. When the user asks for it, make the skill for that agent yourself:

1. Get the skill text of the installed CLI without changing the user's files:

   ```sh
   PIKABAN_HOME="$(mktemp -d)" pikaban skill install
   ```

   The text is in `<that folder>/.claude/skills/pikaban/SKILL.md`. Or read `$(npm root -g)/pikaban/dist/skill/SKILL.md`; it has `{{version}}` in place of the version.
2. Put it where the agent reads instructions. Check the agent's documentation for the current location. Usual places:
   - Agents that read Agent Skills (a folder with a `SKILL.md` that has `name` and `description` frontmatter): copy the folder into the agent's skills folder unchanged.
   - Agents with one instructions file (`AGENTS.md` for Codex and others, `GEMINI.md`, `.github/copilot-instructions.md`): add the text as a "Project tasks with pikaban" section. Keep the body; drop the frontmatter.
   - Agents with rule files (for example `.cursor/rules/pikaban.mdc`, `.windsurf/rules/pikaban.md`): one rule file with the text, active when the user mentions tasks.
3. Adapt the parts that are specific to Claude Code:
   - "Several tasks" uses the Agent tool for subagents. Use the agent's own subagent feature, or do the tasks one by one in the same session.
   - The permission rule `Bash(pikaban:*)` is for Claude Code only. Tell the user how to allow `pikaban` in their agent, or skip it.
   - Keep the protocol rules and the exit code table as they are.
4. Tell the user that `pikaban check` does not see this copy. After a CLI update, make it again from the new skill text. Answer `none` to the skill question of `pikaban init` (`--skill none`) when the project has no Claude Code users.

## Commands

Global options, before or after the command: `-C <path>` (the project folder; default: search up from the current folder for `.pikaban/`) and `--json`. A `<ref>` is a short name (`task-0042`, `0042`, `42`) or the full 26-character ULID.

| Command | Options | What it does |
|---|---|---|
| `pikaban add <title>` | `--body <text>`, `--body-file <path>` (`-` for stdin), `--category <c>` | Makes a task (default category: the first one in `config.json`) |
| `pikaban list` | `--category <c>`, `--assignee agent\|user\|none`, `--needs-input` | Shows tasks |
| `pikaban show <ref>` | | Shows one task with its body |
| `pikaban move <ref> <category>` | `--assignee agent\|user\|none` | Changes the category (and the assignee) |
| `pikaban set <ref>` | `--title <t>`, `--assignee agent\|user\|none`, `--needs-input true\|false` | Changes frontmatter fields |
| `pikaban note <ref> [text]` | `--file <path>` (`-` for stdin) | Adds text to the end of the body |
| `pikaban delete <ref>` | | Deletes the task file |
| `pikaban categories` | `enable\|disable <c>` | Shows or changes the optional categories |
| `pikaban check` | `--fix` | Validates the config, the task files and the skill version. `--fix` gives a new short name to the newer task of each duplicate pair |
| `pikaban migrate` | `--dry-run` | Changes all files to the schema version of the CLI |
| `pikaban skill install` | `--project`, `--force`, `--allow` | Installs or updates the skill (user scope by default) |
| `pikaban projects add\|remove [path]`, `pikaban projects list` | | Changes or shows the global project list that the board uses |
| `pikaban ui` | `--port <n>`, `--no-open` | Starts the board on `127.0.0.1` (port 4477 or the next free port) and opens the browser. Stop it with Ctrl+C |

The board shows all projects in `~/.pikaban_config.json`. Changes from the CLI or from a text editor appear on it in less than a second.

## Exit codes

| Code | Meaning | Usual fix |
|---|---|---|
| 0 | Success | |
| 1 | General error | Read the message |
| 2 | Incorrect usage | Correct the command; for `init` without a terminal, give `--skill` and `--allow` / `--no-allow` |
| 3 | Task or project not found | `pikaban list --json`; no `.pikaban/`: the project needs `pikaban init` |
| 4 | Short name has more than one task | Use the ULID from the message, or `pikaban check --fix` |
| 5 | Conflict: a file changed during the operation, or an installed skill file has local changes | Read the task again and repeat; for the skill, the installer shows a diff; `--force` replaces the file (ask the user first) |
| 6 | Schema version of the project is different from the CLI | Update the CLI (`npm install -g pikaban`) or run `pikaban migrate` |
| 7 | Validation error | Correct the value; for broken files, `pikaban check` |

## Common questions

- **`pikaban: command not found`.** The CLI is not installed in this environment (see Install). Do not make `.pikaban/` files by hand instead.
- **"The agent asks permission for each command."** Run `pikaban skill install --project --allow` (or `--allow` without `--project` for `~/.claude/settings.json`).
- **"The skill is old" (warning from `pikaban check`).** After a CLI update, run the command that `check` prints: `pikaban skill install` or `pikaban skill install --project`. A skill file with local changes is not replaced without `--force`.
- **"Do several tasks."** With the skill, the agent does them one by one, each in its own subagent. Tasks that are not ready (need input, assigned to the user, or in the wrong category) stop the start until the user approves. A task that ends with questions does not stop the batch; a failed task does.
- **"How do I answer the agent's questions?"** Write the answers in the task body. On the board, saving the body clears "needs input". After an edit of the file by hand, clear it with `pikaban set <ref> --needs-input false`.
- **"Tasks of another project are missing on the board."** `pikaban projects add <path>`.
- **"Port 4477 is in use."** Without `--port`, `pikaban ui` takes the next free port. With `--port`, a port in use is an error.
- **Test without touching real files.** `PIKABAN_HOME=<folder>` changes the home folder of `.pikaban_config.json` and of `.claude/` for the user skill and settings.

## Files

| Path | Content |
|---|---|
| `<project>/.pikaban/config.json` | `schema_version`, `project_id`, `project_name`, `categories` (the first one is the default for new tasks) |
| `<project>/.pikaban/tasks/task-XXXX-<ULID>.md` | One file per task |
| `~/.pikaban_config.json` | The project folders that the board shows |
| `<project>/.claude/skills/pikaban/SKILL.md`, `<project>/.claude/settings.json` | The project skill and the permission rule (if selected) |

## Development of pikaban itself

Development needs Node.js 22.12 or later. In a clone of the repository:

```sh
npm install          # also builds dist/
npm test             # builds dist/, then runs the tests against it
npm run typecheck
npm run dev          # board + API with hot reload on http://localhost:5173
node dist/cli.js <command>
```

Use `PIKABAN_HOME=<temp folder>` so that tests and the dev board do not use the real `~/.pikaban_config.json` and `~/.claude/`.

## Limits

- Tested on macOS. Linux should work but is not tested. Windows is not in scope.
- One user and one agent per project; no accounts, no sync, no cloud.
- License: MIT.
