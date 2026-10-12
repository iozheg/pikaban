// localStorage can be missing or can throw (private mode, blocked site data). The UI operates without it.

const KEY = "pikaban.selectedProject";

export function loadSelectedProject(): string | null {
  try {
    return globalThis.localStorage?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

export function saveSelectedProject(pid: string | null): void {
  try {
    if (pid === null) globalThis.localStorage?.removeItem(KEY);
    else globalThis.localStorage?.setItem(KEY, pid);
  } catch {
    // ignore
  }
}

export type Theme = "light" | "dark";

const THEME_KEY = "pikaban.theme";

/** The saved theme, or null: then the theme follows prefers-color-scheme. */
export function loadTheme(): Theme | null {
  try {
    const v = globalThis.localStorage?.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

export function saveTheme(theme: Theme): void {
  try {
    globalThis.localStorage?.setItem(THEME_KEY, theme);
  } catch {
    // ignore
  }
}

const EDITOR_WIDTH_KEY = "pikaban.editorWidth";

/** The saved editor width in px, or null: then the default width. */
export function loadEditorWidth(): number | null {
  try {
    const v = Number(globalThis.localStorage?.getItem(EDITOR_WIDTH_KEY) ?? NaN);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function saveEditorWidth(width: number | null): void {
  try {
    if (width === null) globalThis.localStorage?.removeItem(EDITOR_WIDTH_KEY);
    else globalThis.localStorage?.setItem(EDITOR_WIDTH_KEY, String(width));
  } catch {
    // ignore
  }
}
