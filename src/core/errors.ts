// Exit codes (design section 5). The agent depends on them: do not change.
export const EXIT_GENERAL = 1;
export const EXIT_USAGE = 2;
export const EXIT_NOT_FOUND = 3;
export const EXIT_AMBIGUOUS = 4;
export const EXIT_CONFLICT = 5;
export const EXIT_SCHEMA_VERSION = 6;
export const EXIT_VALIDATION = 7;

export type ExitCode =
  | typeof EXIT_GENERAL
  | typeof EXIT_USAGE
  | typeof EXIT_NOT_FOUND
  | typeof EXIT_AMBIGUOUS
  | typeof EXIT_CONFLICT
  | typeof EXIT_SCHEMA_VERSION
  | typeof EXIT_VALIDATION;

export class TrackerError extends Error {
  readonly code: ExitCode;

  constructor(code: ExitCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TrackerError";
    this.code = code;
  }
}
