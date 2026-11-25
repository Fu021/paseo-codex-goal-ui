import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse } from "@iarna/toml";
import { z } from "zod";
import { goalSchema } from "../shared/goal";

const storedGoalSchema = goalSchema.extend({ updatedAtMs: z.number().int().nonnegative() });

function isMissing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

export async function sqliteHome(override: Record<string, string | undefined>, cwd: string) {
  const home = override.CODEX_HOME || process.env.CODEX_HOME ||
    join(override.HOME || override.USERPROFILE || homedir(), ".codex");
  const directory = resolve(home);
  const sqliteOverride = override.CODEX_SQLITE_HOME ?? process.env.CODEX_SQLITE_HOME;
  let config = "";
  try {
    config = await readFile(join(directory, "config.toml"), "utf8");
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const configured = config ? parse(config).sqlite_home : undefined;
  const sqliteDirectory = (typeof configured === "string" ? configured : undefined) || sqliteOverride;
  return sqliteDirectory ? resolve(cwd, sqliteDirectory) : directory;
}

export async function readNativeGoal(directory: string, threadId: string) {
  for (const filename of ["goals_1.sqlite", "state_5.sqlite"]) {
    const path = join(directory, filename);
    try {
      await access(path);
    } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }

    const database = new DatabaseSync(path, { readOnly: true });
    try {
      if (filename === "state_5.sqlite" && !database.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'thread_goals'",
      ).get()) return null;

      const row = database.prepare(`
        SELECT goal_id AS id, objective, status, time_used_seconds AS seconds, updated_at_ms AS updatedAtMs
        FROM thread_goals
        WHERE thread_id = ?
      `).get(threadId);
      return row ? storedGoalSchema.parse(row) : null;
    } finally {
      database.close();
    }
  }
  return null;
}
