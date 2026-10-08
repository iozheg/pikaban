import { isAvailable, statusLabel } from "../logic.js";
import type { ProjectSummary } from "../types.js";

interface ProjectSelectorProps {
  projects: ProjectSummary[];
  selected: string | null;
  /** Returns false if the selection did not change (the user cancelled). */
  onSelect(pid: string): boolean;
}

/**
 * The projects from ~/.pikaban_config.json (design 7.1 item 1). Projects that are not available
 * (missing, different schema version, config not valid) show as disabled options with the reason.
 */
export function ProjectSelector({ projects, selected, onSelect }: ProjectSelectorProps) {
  const unavailable = projects.filter((p) => !isAvailable(p));
  const current = projects.find((p) => p.pid === selected) ?? null;
  return (
    <div class="project-selector">
      {/* The native select lies over the button, transparent: it keeps the keyboard and the option list. */}
      <label class="project-button">
        <span class="project-name">{current ? current.name : projects.length === 0 ? "No projects" : "Select a project"}</span>
        {/* On hover: the name and the path. */}
        {current && (
          <span class="project-tooltip" aria-hidden="true">
            <span class="project-name">{current.name}</span>
            <span class="project-root">{current.root}</span>
          </span>
        )}
        <span class="project-caret" aria-hidden="true">
          ▼
        </span>
        <select
          aria-label="Project"
          value={selected ?? ""}
          onChange={(e) => {
            const el = e.currentTarget;
            if (!onSelect(el.value)) el.value = selected ?? "";
          }}
          disabled={projects.length === 0}
        >
          {selected === null && (
            <option value="" disabled>
              {projects.length === 0 ? "No projects" : "Select a project"}
            </option>
          )}
          {projects.map((p) => (
            <option key={p.pid} value={p.pid} disabled={!isAvailable(p)} title={p.message ?? p.root}>
              {isAvailable(p) ? p.name : `${p.name} (unavailable: ${statusLabel(p)})`}
            </option>
          ))}
        </select>
      </label>
      {unavailable.length > 0 && (
        <details class="unavailable">
          <summary>
            {unavailable.length} unavailable {unavailable.length === 1 ? "project" : "projects"}
          </summary>
          <ul>
            {unavailable.map((p) => (
              <li key={p.pid}>
                <strong>{p.name}</strong> <span class="badge badge-error">{statusLabel(p)}</span>
                <div class="path">{p.root}</div>
                {p.message && <div class="reason">{p.message}</div>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
