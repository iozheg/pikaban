<p align="center"><img src="assets/logo.png" alt="pikaban logo: a pika peeking over a kanban board" width="160" /></p>

# pikaban

A local simple task tracker for you and your agent. Manage tasks in your browser or with agent commands.

## Human written for you

Features:

- minimum features, super simple
- markdown files in project
- Kanban board in browser
- agent skill
- multiple projects

## Usage

```sh
npm install -g pikaban
```

> The package is **not published to npm yet**, so use the "from source" steps below for now.

### From source (git)

`dist/` is not in git, so the package must be built before it is installed. With npm 10, `npm install -g github:<user>/<repo>` does **not** work for this package: npm runs the `prepare` build of a global git install without the dev dependencies, and the build stops with `tsup: command not found`. Clone, build and install the packed tarball instead:

```sh
git clone https://github.com/<user>/<repo>.git pikaban
cd pikaban
npm ci                    # also builds dist/ (the "prepare" script)
npm pack                  # makes pikaban-<version>.tgz
npm install -g ./pikaban-*.tgz
```

The build tools (Vite) need Node.js 20.19+ or 22.12+. The installed CLI needs only Node.js 20+.

### `EACCES` errors on `npm install -g`

If npm cannot write to its global folder (for example, a system Node.js in `/usr/local`), do not use `sudo`. Use a Node version manager such as [nvm](https://github.com/nvm-sh/nvm), [fnm](https://github.com/Schniz/fnm) or [Volta](https://volta.sh/); they keep global packages in your home folder. Another option is a user prefix: `npm config set prefix ~/.npm-global` and add `~/.npm-global/bin` to your `PATH`.

## Quick start

```sh
cd my-project
pikaban init
pikaban add "Implement OAuth2 login" --body "Use GitHub as the first provider."
pikaban ui
```

`pikaban init` makes `.pikaban/` with `config.json` and `tasks/`, and adds the project to your global project list (`~/.pikaban_config.json`). In a terminal it asks these questions, shows a summary and asks for confirmation:

| Question                                                  | Answers                                                                                       | Default   | Flag                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------- |
| Optional categories (a list of two)                       | Check with the arrow keys and space, confirm with enter                                       | `backlog` | `--backlog` / `--no-backlog`, `--review` / `--no-review` |
| Install the agent skill?                                  | `project` (`<project>/.claude/skills/pikaban/`), `user` (`~/.claude/skills/pikaban/`), `none` | `project` | `--skill <answer>`                                       |
| Let the agent run `pikaban` without permission prompts?   | yes / no                                                                                      | no        | `--allow` / `--no-allow`                                 |
| Keep the pikaban files in git? (only in a git repository) | yes / no                                                                                      | yes       | `--git` / `--no-git`                                     |

- **Categories.** `todo`, `in_progress` and `done` always exist. `backlog` (tasks for later) and `review` (the agent's finished tasks wait for your check before `done`) are optional. The board order is `backlog, todo, in_progress, review, done`. Change them later with `pikaban categories enable|disable backlog|review`.
- Without a terminal (an agent, a script, CI), `pikaban init` never asks. Give `--skill` and `--allow` / `--no-allow`, or `--yes` for the defaults; otherwise it stops with exit code 2 and writes nothing. A missing category or git flag gives the default. Example: `pikaban init --skill project --no-allow`.
- `--name` and `--id` set the project name and ID (default: the folder name).
- **Git is never run.** "yes" to the git question changes nothing: commit `.pikaban/` (and `.claude/skills/pikaban/` for a project skill) when you want. "no" adds them to `.git/info/exclude` of the repository (local only, not committed, not shared with teammates). Outside a git repository there is no question.

`pikaban ui` starts a local server on `127.0.0.1` (port 4477, or the next free port) and opens the board in your browser. Stop it with Ctrl+C. Changes made by the CLI or by hand appear on the board in less than a second.

## Commands

Global options (before or after the command name): `-C <path>` uses that project folder (default: search up from the current folder for `.pikaban/`); `--json` writes only JSON to stdout and errors as JSON to stderr. `pikaban <command> --help` shows the details.

A `<ref>` is a short name (`task-0042`, `0042`, `42`) or the full 26-character ULID.

| Command                                  | Options                                                                                                                                                                        | What it does                                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pikaban init`                           | `--name <name>`, `--id <id>`, `--backlog` / `--no-backlog`, `--review` / `--no-review`, `--skill project\|user\|none`, `--allow` / `--no-allow`, `--git` / `--no-git`, `--yes` | Makes `.pikaban/` and `config.json`, registers the project, installs the skill and the permission rule                              |
| `pikaban add <title>`                    | `--body <text>`, `--body-file <path>` (`-` for stdin), `--category <c>`                                                                                                        | Makes a new task (default category: the first one in `config.json`)                                                                 |
| `pikaban list`                           | `--category <c>`, `--assignee agent\|user\|none`, `--needs-input`                                                                                                              | Shows tasks                                                                                                                         |
| `pikaban show <ref>`                     |                                                                                                                                                                                | Shows one task with its body                                                                                                        |
| `pikaban move <ref> <category>`          | `--assignee agent\|user\|none`                                                                                                                                                 | Changes the category (and the assignee) in one write                                                                                |
| `pikaban set <ref>`                      | `--title <t>`, `--assignee agent\|user\|none`, `--needs-input true\|false`                                                                                                     | Changes frontmatter fields                                                                                                          |
| `pikaban note <ref> [text]`              | `--file <path>` (`-` for stdin)                                                                                                                                                | Adds text to the end of the body                                                                                                    |
| `pikaban delete <ref>`                   |                                                                                                                                                                                | Deletes the task file                                                                                                               |
| `pikaban categories`                     |                                                                                                                                                                                | Shows the categories (on, off, required)                                                                                            |
| `pikaban categories enable\|disable <c>` |                                                                                                                                                                                | Turns `backlog` or `review` on or off. Disable stops with code 1 while tasks are in the category                                    |
| `pikaban check`                          | `--fix`                                                                                                                                                                        | Validates the config, all task files and the skill version. `--fix` gives a new short name to the newer task of each duplicate pair |
| `pikaban migrate`                        | `--dry-run`                                                                                                                                                                    | Changes all files to the schema version of the CLI                                                                                  |
| `pikaban skill install`                  | `--project`, `--force`, `--allow`                                                                                                                                              | Installs the agent skill into `~/.claude/skills/pikaban/` (or the project with `--project`)                                         |
| `pikaban projects add [path]`            |                                                                                                                                                                                | Adds a project folder to the global list (default: the current project)                                                             |
| `pikaban projects remove [path]`         |                                                                                                                                                                                | Removes a project folder from the global list                                                                                       |
| `pikaban projects list`                  |                                                                                                                                                                                | Shows the project folders                                                                                                           |
| `pikaban ui`                             | `--port <n>`, `--no-open`                                                                                                                                                      | Starts the UI server and opens the board. With `--port`, a port in use is an error                                                  |

## Exit codes

| Code | Meaning                                                                                     |
| ---- | ------------------------------------------------------------------------------------------- |
| 0    | Success                                                                                     |
| 1    | General error                                                                               |
| 2    | Incorrect usage (also: `pikaban init` without a terminal and a missing flag)                |
| 3    | Task or project not found                                                                   |
| 4    | Short name has more than one task (the message shows the ULIDs)                             |
| 5    | Conflict: a file changed during the operation, or an installed skill file has local changes |
| 6    | Schema version of the project is different from the CLI                                     |
| 7    | Validation error                                                                            |

## Agent setup (Claude Code)

**The skill.** The package contains a Claude Code skill (`SKILL.md`) that tells the agent how to work with tasks: which command to use for each action, the protocol rules (for example, never edit frontmatter by hand, do not start a task that needs input) and what to do for each exit code. Ask for several tasks ("do tasks 41, 42 and 45", "work through the todo list") and the agent does them one by one, each in its own subagent. If a listed task is not ready (it needs input, is assigned to you, or is not in `todo`, `backlog` or the agent's `in_progress`), nothing starts until you approve. During the batch, a task that ends with questions does not stop it; a failed task does. The skill text ships with the CLI, so it always matches the installed commands.

- Project scope: `<project>/.claude/skills/pikaban/SKILL.md`. Commit it if teammates or cloud sessions should get it.
- User scope: `~/.claude/skills/pikaban/SKILL.md`, for all your projects.
- `pikaban init --skill project|user` installs it; later, run `pikaban skill install` (user) or `pikaban skill install --project`.
- The installer does not replace a skill file that you changed: it shows a diff and stops with exit code 5. Use `--force` to replace it. A file that differs only by an older version line is updated automatically.
- The skill contains a `<!-- pikaban-skill-version: X.Y.Z -->` line. After you update the CLI, `pikaban check` warns if an installed skill is older than the CLI and prints the command to update it.

**The permission rule.** By default Claude Code asks before each `pikaban` command. `--allow` (on `pikaban init` or `pikaban skill install`) adds `Bash(pikaban:*)` to `permissions.allow` in `<project>/.claude/settings.json` (or `~/.claude/settings.json` for `pikaban skill install --allow` without `--project`). The existing JSON is merged, not replaced, a backup `settings.json.bak` is written, and an invalid JSON file is left unchanged. It is never the default.

## Cloud and remote agent sessions

A cloud session does not have your global npm packages. Install the CLI in the environment's setup script, for example:

```sh
npm install -g pikaban
```

(Until the package is published, use the "from source" steps above in the setup script.) The skill reaches the session if you committed the project skill (`.claude/skills/pikaban/`) to git. If `pikaban` is not found, the skill tells the agent to stop and tell you.

## Files on disk

| Path                                                                           | Content                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<project>/.pikaban/config.json`                                               | `schema_version`, `project_id`, `project_name` and `categories` (the Kanban columns; must contain `todo`, `in_progress` and `done`; the first one is the default for new tasks)                                                                         |
| `<project>/.pikaban/tasks/task-XXXX-<ULID>.md`                                 | One file per task: YAML frontmatter (`id`, `short`, `title`, `category`, `assignee`, `needs_input`, `created_at`, `updated_at`) and a free Markdown body. Only `pikaban` and the UI write the frontmatter; you and the agent can edit the body directly |
| `~/.pikaban_config.json`                                                       | The list of project folders that the UI shows                                                                                                                                                                                                           |
| `<project>/.claude/skills/pikaban/SKILL.md`, `<project>/.claude/settings.json` | The project skill and the permission rule (if selected)                                                                                                                                                                                                 |

`PIKABAN_HOME` changes the home folder that pikaban uses: the folder of `.pikaban_config.json` and of `.claude/` for the user skill and the user `settings.json`. Example: `PIKABAN_HOME=/tmp/pikaban-home pikaban projects list`. The tests use it so they never touch your real files.

## Development

Development tools (Vitest) need **Node.js 22.12 or later**. The built CLI runs on Node.js 20+.

```sh
npm install          # also builds dist/ (the "prepare" script)
npm run build        # tsup (dist/cli.js, dist/server.js, dist/skill/SKILL.md) and vite build (dist/ui/)
npm test             # vitest; builds dist/ first, then runs the CLI and server tests against it
npm run typecheck    # tsc for the CLI/server and for the UI
npm run dev          # UI + API with hot reload: open http://localhost:5173
npm run dev:cli      # tsup --watch: rebuilds dist/cli.js for `node dist/cli.js <command>`
```

Run the built CLI without installing it: `node dist/cli.js <command>`. Use `PIKABAN_HOME=<temp folder>` to keep tests away from your real `~/.pikaban_config.json` and `~/.claude/`.

**UI development.** `npm run dev` is one command. It starts Vite on `http://localhost:5173` and, inside it, the API server from the TypeScript source (no build necessary). Vite sends `/api/...` to that server. A change in `src/ui/` reloads the page; a change in `src/core/` or `src/server/` restarts the API server, and the board connects again by itself. The board shows the projects in `~/.pikaban_config.json`; use `PIKABAN_HOME=<folder> npm run dev` for test data.

`npm run dev:cli` is necessary only when you also run the CLI from `dist/` and want it to follow your changes.

`PIKABAN_UI_DEV=1 pikaban ui` still makes the built server accept the Vite origin (`localhost:5173`). `npm run dev` does not need it.

Packing: `npm pack` runs the build (through `prepare`) and ships only `dist/`, `README.md` and `package.json` (about 72 kB packed). The UI libraries (Preact, marked, DOMPurify) are bundled into `dist/ui/` and are dev dependencies.

## Status and open items

- Version 0.1.0, not published.
- License: MIT (see `LICENSE`).
- The git question in `pikaban init` is deferred: `init` does not touch git.
- Tested on macOS only. Linux should work but is not tested; Windows is not tested and not in scope.
- `npm install -g github:<user>/<repo>` does not work with npm 10 (see "From source").
