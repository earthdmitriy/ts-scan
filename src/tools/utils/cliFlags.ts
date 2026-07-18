import { error, Result, success } from "../../types.js";

export type CliFlagDef =
  | { name: string; type: "boolean" }
  | { name: string; type: "string"; required?: boolean }
  | {
      name: string;
      type: "integer";
      required?: boolean;
      min?: number;
      max?: number;
    }
  | { name: string; type: "stringList"; required?: boolean };

export interface ParseCliFlagsOptions {
  /** Groups of flag names that cannot appear together. */
  mutuallyExclusive?: string[][];
  /** When true, leftover non-flag tokens become positionals. */
  allowPositionals?: boolean;
}

export interface ParsedCliFlags {
  flags: Record<string, boolean | string | number | string[] | undefined>;
  positionals: string[];
  /** Number of argv entries consumed (always `args.length` on success). */
  consumed: number;
}

/**
 * Parse `--flag` / `--name value` style CLI flags.
 * Returns Result — never calls process.exit.
 */
export const parseCliFlags = (
  args: string[],
  defs: CliFlagDef[],
  options: ParseCliFlagsOptions = {},
): Result<ParsedCliFlags> => {
  const byName = new Map(defs.map((def) => [def.name, def]));
  const flags: Record<
    string,
    boolean | string | number | string[] | undefined
  > = {};
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) {
      if (options.allowPositionals) {
        positionals.push(arg);
        continue;
      }
      return error(`Unexpected argument: ${arg}`);
    }

    const name = arg.slice(2);
    if (name.length === 0) {
      return error(`Invalid flag: ${arg}`);
    }

    const def = byName.get(name);
    if (!def) {
      return error(`Unknown flag: --${name}`);
    }

    if (def.type === "boolean") {
      flags[name] = true;
      continue;
    }

    const raw = args[i + 1];
    if (raw === undefined || raw.startsWith("--")) {
      return error(`Flag --${name} requires a value.`);
    }
    i++;

    if (def.type === "string") {
      flags[name] = raw;
      continue;
    }

    if (def.type === "stringList") {
      const parts = raw
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      const existing = flags[name];
      const list = Array.isArray(existing) ? [...existing] : [];
      list.push(...parts);
      flags[name] = list;
      continue;
    }

    // integer
    if (!/^-?\d+$/.test(raw)) {
      return error(`Flag --${name} expects an integer, got: ${raw}`);
    }
    const value = Number.parseInt(raw, 10);
    if (def.min !== undefined && value < def.min) {
      return error(`Flag --${name} must be >= ${def.min}, got: ${value}`);
    }
    if (def.max !== undefined && value > def.max) {
      return error(`Flag --${name} must be <= ${def.max}, got: ${value}`);
    }
    flags[name] = value;
  }

  for (const def of defs) {
    if (
      "required" in def &&
      def.required &&
      (flags[def.name] === undefined || flags[def.name] === "")
    ) {
      return error(`Missing required flag: --${def.name}`);
    }
  }

  for (const group of options.mutuallyExclusive ?? []) {
    const present = group.filter((name) => flags[name] !== undefined);
    if (present.length > 1) {
      return error(
        `Flags are mutually exclusive: ${present.map((n) => `--${n}`).join(", ")}`,
      );
    }
  }

  return success({ flags, positionals, consumed: args.length });
};
