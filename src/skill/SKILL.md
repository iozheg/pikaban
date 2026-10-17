---
name: pikaban
description: Manage the tasks of this project with the `pikaban` CLI. Use this skill for any work with project tasks or the `.pikaban/` folder - the backlog, the todo list, the Kanban board - and to add, list, show, start, do, update, elaborate (ask questions about), move, finish or remove a task, or when the user names a task such as task-0042. Also use it to do several tasks one by one (a list of tasks, "work through the todo list", "do all todo tasks").
---

<!-- pikaban-skill-version: {{version}} -->

# Project tasks with `pikaban`

The tasks of this project are Markdown files in `.pikaban/tasks/`. The user sees them on a Kanban board. The `pikaban` CLI is the only tool that changes task frontmatter: it sets IDs, short names, timestamps and validation.

If the `pikaban` command is not found, stop. Tell the user to install the pikaban CLI (Node.js 20 or later, then `npm install -g` of the pikaban package). Do not create or edit `.pikaban/` files by hand instead.

## Read tasks

Always add `--json` when you read. The JSON output is stable; the human text is not.

- `pikaban list --json` shows all tasks. Filters: `--category <c>`, `--assignee agent|user|none`, `--needs-input`.
- `pikaban show <ref> --json` shows one task: all fields and the full `body`.
- A `<ref>` is a short name (`task-0042`, `0042`, `42`) or the full 26-character ULID (`id`).
- The categories (Kanban columns) are in `.pikaban/config.json`. `todo`, `in_progress` and `done` always exist. `backlog` and `review` are optional: check the config before you use them.

## Skills mapped to commands

| Skill | Commands |
|---|---|
| `add_task` | `pikaban add "<title>" --category <c> [--body "<text>" \| --body-file <path>]` (see "New tasks") |
| `do_task` | `pikaban move <ref> in_progress --assignee agent`, then do the work, then `pikaban move <ref> review` if the config has `review`, otherwise `pikaban move <ref> done` |
| `do_tasks` | `do_task` for each task of a list, one by one, each in its own subagent (see "Several tasks") |
| `update_task` | `pikaban set <ref> [--title "<t>"] [--assignee agent\|user\|none] [--needs-input true\|false]`, or `pikaban note <ref> "<text>"` |
| `elaborate_task` | `pikaban note <ref> "<questions>"`, then `pikaban set <ref> --needs-input true` |
| `remove_task` | `pikaban delete <ref>` |

## New tasks

Select the category from what the user asks:

- "Create a task" (no category named): `--category todo`.
- "Create it in the backlog" (or "for later"): `--category backlog`. If the config has no `backlog`, use `todo`.
- "Create and start" (or "create and implement"): `--category todo`, then `do_task` for the new task.
- The user names a category: use it.

If the config has `review`, the user moves reviewed tasks from `review` to `done`. Do not move your own tasks to `done` unless the user tells you to.

For long or multi-line text, use stdin: `pikaban note <ref> --file -` or `pikaban add "<title>" --body-file -`.

## Several tasks

When the user asks for several tasks, do each task in its own subagent. Your context then keeps only a short report for each task.

- **The list.** Use the tasks the user names, in that order. For "all todo tasks" (or "work through the todo list"), use `pikaban list --category todo --json`, sorted by short name.
- **Before you start.** Run `pikaban show <ref> --json` for each task. A task is ready when all of these are true:
  - `category` is `todo` or `backlog`, or `category` is `in_progress` and `assignee` is `agent` (a task from a stopped session, rule 7).
  - `needs_input` is `false`.
  - `assignee` is not `user`.
- **A task is not ready.** Do not start any task. Show the user each task that is not ready and the reason (for example, "task-0002: category `review`"). Start only when the user approves: the batch without these tasks, or the full list after the user changes the tasks.
- **One at a time.** Start one subagent (the Agent tool, `run_in_background: false`) and wait for its result before the next one. Do not start subagents in parallel: they share the working tree and the task files.
- **The subagent's prompt.** Give the task ref and these instructions:
  - Do the task with `do_task` of the pikaban skill: `pikaban show <ref> --json`, `pikaban move <ref> in_progress --assignee agent`, the work, then `pikaban move <ref> review` (if the config has `review`) or `pikaban move <ref> done`.
  - Use the checks of the project (tests, typecheck, build) if its CLAUDE.md or README names them. The task is finished only when they pass.
  - If the task needs answers from the user, use `elaborate_task` (`pikaban note`, then `pikaban set <ref> --needs-input true`) and stop.
  - If you cannot finish the task, add the reason with `pikaban note <ref> "<reason>"`, leave the task in `in_progress` and stop.
  - At the end, report in one or two lines: the task ref, its category, and the changed files.
- **After each subagent.** Run `pikaban show <ref> --json`. Do not trust only the subagent's report.
  - Category `review` or `done`: success. Continue with the next task.
  - `needs_input` is `true`: the task waits for the user. Continue with the next task.
  - Any other result (the task is still in `in_progress`, or the subagent stopped with an error): failure. Stop the batch. Do not start the next task.
- **At the end** (or after a failure), report in one block: the finished tasks, the tasks with questions (the user answers them in the body), the failed task with its reason, and the tasks that you did not start.

Do not commit between the tasks unless the user tells you to.

## Protocol rules

1. Use the CLI for all frontmatter changes. Do not edit frontmatter (the lines between the `---` markers) by hand.
2. You can edit the body text (below the frontmatter) directly with your file tools.
3. Before you start a task, run `pikaban show <ref> --json`. Do not start the task if `needs_input` is `true` or `assignee` is `user`.
4. To ask questions, add them to the body (`pikaban note`) and run `pikaban set <ref> --needs-input true`. Do not move the task to `in_progress`.
5. The user writes the answers in the body. Read the full body (`pikaban show <ref> --json`) before you continue.
6. Delete a task only when the user tells you to delete it.
7. At the start of a session, run `pikaban list --category in_progress --assignee agent --json`. These tasks can remain from a session that stopped. Continue them or tell the user about them.
8. Exit code 6: tell the user to update the pikaban CLI or to run `pikaban migrate`. Do not edit files by hand.
9. If the project has no `.pikaban/` folder (exit code 3 with "Run pikaban init"), do not run `pikaban init` without the user. Ask the user these questions:
   - Install the agent skill? `project` (in `.claude/skills/pikaban/` of this project), `user` (in `~/.claude/skills/pikaban/`) or `none`. Default: `project`.
   - Let the agent run `pikaban` without permission prompts? This adds `Bash(pikaban:*)` to `.claude/settings.json` of the project. `yes` or `no`. Default: `no`.
   - Optional categories: `backlog` (tasks for later) and `review` (your finished tasks wait for the user's check). Default: `backlog` only.
   - Only in a git repository: keep the pikaban files in git? `no` adds them to `.git/info/exclude`. Default: `yes`.

   Then run `pikaban init --skill <project|user|none> --allow` (or `--no-allow`) with a flag for each answer: `--backlog` / `--no-backlog`, `--review` / `--no-review`, `--git` / `--no-git`. Do not use `--yes` unless the user tells you to use the defaults.

## Exit codes

| Code | Meaning | What to do |
|---|---|---|
| 0 | Success | Continue. |
| 1 | General error | Read the message. Tell the user if you cannot correct the cause. |
| 2 | Incorrect usage | Correct the command. For `pikaban init`, give all flags (rule 9). |
| 3 | Task or project not found | Run `pikaban list --json` to find the task. No `.pikaban/`: rule 9. |
| 4 | Short name has more than one task | Use the full ULID from the message. `pikaban check --fix` gives a new short name to the newer task. |
| 5 | Conflict: a file changed during the operation, or an installed skill file has local changes | Run `pikaban show <ref> --json` again, then repeat the command. For a skill file, ask the user before you use `--force`. |
| 6 | Schema version is different from the CLI | Rule 8. |
| 7 | Validation error | Correct the value (for example, use a category from `.pikaban/config.json`). For broken files, run `pikaban check --json` and tell the user. |

## Other commands

- `pikaban check --json` validates all task files and shows warnings (for example, an old skill version).
- `pikaban skill install [--project]` updates this skill text to the version of the installed CLI.
- `pikaban categories` shows the categories. `pikaban categories enable|disable backlog|review` changes them. Run it only when the user asks.
- `pikaban ui` opens the Kanban board for the user. Do not run it unless the user asks.
