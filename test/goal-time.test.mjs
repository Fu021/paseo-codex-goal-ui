import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { loadTypeScript } from "./load-typescript.mjs";

const goal = loadTypeScript(new URL("../shared/goal.ts", import.meta.url));
const store = loadTypeScript(new URL("../server/store.ts", import.meta.url), {
  modules: { "../shared/goal": goal },
});
const { default: contribute } = loadTypeScript(new URL("../index.server.ts", import.meta.url), {
  modules: { "./shared/goal": goal, "./server/store": store },
});

test("live time counts from the newer of the turn start and the goal update", () => {
  const turnStart = Date.parse("2026-01-01T12:00:00Z");
  const turnStartedAt = new Date(turnStart).toISOString();
  assert.equal(goal.estimateGoalSeconds(200, turnStart - 60_000, turnStartedAt, turnStart + 3_499), 203);
  assert.equal(goal.estimateGoalSeconds(200, turnStart + 1_000, turnStartedAt, turnStart + 3_499), 202);
  assert.equal(goal.estimateGoalSeconds(200, turnStart + 5_000, turnStartedAt, turnStart + 3_499), 200);
  assert.equal(goal.estimateGoalSeconds(200, turnStart, "invalid", turnStart), null);
});

test("goal reads stop estimating when the goal pauses, completes, or the turn ends", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-goal-time-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const turnStart = Date.parse("2026-01-01T12:00:00Z");
  const clock = context.mock.method(Date, "now", () => turnStart + 3_500);
  const database = new DatabaseSync(join(directory, "goals_1.sqlite"));
  const agent = {
    provider: "codex",
    cwd: directory,
    runtimeInfo: { sessionId: "thread" },
    status: "running",
    activeTurn: { startedAt: new Date(turnStart).toISOString() },
  };
  const handlers = new Map();
  const stop = contribute({ handle: (rpc, handler) => handlers.set(rpc.name, handler) });
  context.after(stop);

  const paseo = {
    agents: { ref: () => ({ refresh: async () => ({ agent }) }) },
    config: {
      get: async () => ({
        config: { providers: { codex: { env: { CODEX_HOME: directory, CODEX_SQLITE_HOME: directory } } } },
      }),
    },
  };
  const read = () => goal.unwrapGoal(handlers.get(goal.readGoal.name)({ agentId: "agent" }, { paseo }));

  try {
    database.exec(`CREATE TABLE thread_goals (
      thread_id TEXT PRIMARY KEY, goal_id TEXT, objective TEXT, status TEXT,
      time_used_seconds INTEGER, updated_at_ms INTEGER
    )`);
    database.prepare("INSERT INTO thread_goals VALUES (?, ?, ?, ?, ?, ?)")
      .run("thread", "goal", "Run checks", "active", 200, turnStart - 60_000);

    assert.equal((await read()).liveSeconds, 203);
    const update = database.prepare("UPDATE thread_goals SET status = ?, time_used_seconds = ?, updated_at_ms = ?");
    update.run("paused", 204, turnStart + 4_000);
    clock.mock.mockImplementation(() => turnStart + 20_000);
    const paused = await read();
    assert.equal(paused.liveSeconds, null);
    assert.equal(paused.goal.status, "paused");
    assert.equal(paused.goal.seconds, 204);

    update.run("complete", 205, turnStart + 5_000);
    const complete = await read();
    assert.equal(complete.liveSeconds, null);
    assert.equal(complete.goal.seconds, 205);

    update.run("active", 205, turnStart + 5_000);
    agent.status = "idle";
    const idle = await read();
    assert.equal(idle.liveSeconds, null);
    assert.equal(idle.goal.seconds, 205);
  } finally {
    database.close();
  }
});
