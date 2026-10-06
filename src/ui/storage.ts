// localStorage can be missing or can throw (private mode, blocked site data). The UI operates without it.

const KEY = "tracker.selectedProject";

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
