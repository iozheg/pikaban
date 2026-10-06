---
name: tracker
description: Manage the tasks of this project with the `tracker` CLI. Use this skill for any work with project tasks or the `.tracker/` folder - the backlog, the todo list, the Kanban board - and to add, list, show, start, do, update, elaborate (ask questions about), move, finish or remove a task, or when the user names a task such as task-0042.
---

<!-- tracker-skill-version: {{version}} -->

# Project tasks with `tracker`

The tasks of this project are Markdown files in `.tracker/tasks/`. The user sees them on a Kanban board. The `tracker` CLI is the only tool that changes task frontmatter: it sets IDs, short names, timestamps and validation.

If the `tracker` command is not found, stop. Tell the user to install the tracker CLI (Node.js 20 or later, then `npm install -g` of the tracker package). Do not create or edit `.tracker/` files by hand instead.

## Read tasks

Always add `--json` when you read. The JSON output is stable; the human text is not.

- `tracker list --json` shows all tasks. Filters: `--category <c>`, `--assignee agent|user|none`, `--needs-input`.
- `tracker show <ref> --json` shows one task: all fields and the full `body`.
- A `<ref>` is a short name (`task-0042`, `0042`, `42`) or the full 26-character ULID (`id`).
- The categories (Kanban columns) are in `.tracker/config.json`. New tasks go into the first category. `in_progress` and `done` always exist.

## Skills mapped to commands

| Skill | Commands |
|---|---|
| `add_task` | `tracker add "<title>" [--body "<text>" \| --body-file <path>] [--category <c>]` |
| `do_task` | `tracker move <ref> in_progress --assignee agent`, then do the work, then `tracker move <ref> done` |
| `update_task` | `tracker set <ref> [--title "<t>"] [--assignee agent\|user\|none] [--needs-input true\|false]`, or `tracker note <ref> "<text>"` |
| `elaborate_task` | `tracker note <ref> "<questions>"`, then `tracker set <ref> --needs-input true` |
| `remove_task` | `tracker delete <ref>` |

For long or multi-line text, use stdin: `tracker note <ref> --file -` or `tracker add "<title>" --body-file -`.

## Protocol rules

1. Use the CLI for all frontmatter changes. Do not edit frontmatter (the lines between the `---` markers) by hand.
2. You can edit the body text (below the frontmatter) directly with your file tools.
3. Before you start a task, run `tracker show <ref> --json`. Do not start the task if `needs_input` is `true` or `assignee` is `user`.
4. To ask questions, add them to the body (`tracker note`) and run `tracker set <ref> --needs-input true`. Keep the task in `backlog` or `todo`.
5. The user writes the answers in the body. Read the full body (`tracker show <ref> --json`) before you continue.
6. Delete a task only when the user tells you to delete it.
7. At the start of a session, run `tracker list --category in_progress --assignee agent --json`. These tasks can remain from a session that stopped. Continue them or tell the user about them.
8. Exit code 6: tell the user to update the tracker CLI or to run `tracker migrate`. Do not edit files by hand.
9. If the project has no `.tracker/` folder (exit code 3 with "Run tracker init"), do not run `tracker init` without the user. Ask the user these questions:
   - Install the agent skill? `project` (in `.claude/skills/tracker/` of this project), `user` (in `~/.claude/skills/tracker/`) or `none`. Default: `project`.
   - Let the agent run `tracker` without permission prompts? This adds `Bash(tracker:*)` to `.claude/settings.json` of the project. `yes` or `no`. Default: `no`.

   Then run `tracker init --skill <project|user|none> --allow` (or `--no-allow`) with a flag for each answer. Do not use `--yes` unless the user tells you to use the defaults.

## Exit codes

| Code | Meaning | What to do |
|---|---|---|
| 0 | Success | Continue. |
| 1 | General error | Read the message. Tell the user if you cannot correct the cause. |
| 2 | Incorrect usage | Correct the command. For `tracker init`, give all flags (rule 9). |
| 3 | Task or project not found | Run `tracker list --json` to find the task. No `.tracker/`: rule 9. |
| 4 | Short name has more than one task | Use the full ULID from the message. `tracker check --fix` gives a new short name to the newer task. |
| 5 | Conflict: a file changed during the operation, or an installed skill file has local changes | Run `tracker show <ref> --json` again, then repeat the command. For a skill file, ask the user before you use `--force`. |
| 6 | Schema version is different from the CLI | Rule 8. |
| 7 | Validation error | Correct the value (for example, use a category from `.tracker/config.json`). For broken files, run `tracker check --json` and tell the user. |

## Other commands

- `tracker check --json` validates all task files and shows warnings (for example, an old skill version).
- `tracker skill install [--project]` updates this skill text to the version of the installed CLI.
- `tracker ui` opens the Kanban board for the user. Do not run it unless the user asks.
