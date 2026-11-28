import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { loadTypeScript } from "./load-typescript.mjs";

const goal = loadTypeScript(new URL("../shared/goal.ts", import.meta.url));
const shortcuts = loadTypeScript(new URL("../shared/shortcuts.ts", import.meta.url));
const store = loadTypeScript(new URL("../server/store.ts", import.meta.url), {
  modules: { "../shared/goal": goal },
});
const { default: contribute } = loadTypeScript(new URL("../index.server.ts", import.meta.url), {
  modules: { "./shared/goal": goal, "./shared/shortcuts": shortcuts, "./server/store": store },
});

test("live time counts from the newer of the turn start and the goal update", () => {
  const turnStart = Date.parse("2026-01-01T12:00:00Z");
  const turnStartedAt = new Date(turnStart).toISOString();
  assert.equal(goal.estimateGoalSeconds(200, turnStart - 60_000, turnStartedAt, turnStart + 3_499), 203);
  assert.equal(goal.estimateGoalSeconds(200, turnStart + 1_000, turnStartedAt, turnStart + 3_499), 202);
  assert.equal(goal.estimateGoalSeconds(200, turnStart + 5_000, turnStartedAt, turnStart + 3_499), 200);
  assert.equal(goal.estimateGoalSeconds(200, turnStart, "invalid", turnStart), null);
});

test("a draft or confirmation follows its goal identity and ignores elapsed-time updates", () => {
  const expected = { id: "goal", objective: "First goal", status: "active", seconds: 12 };
  const snapshot = { threadId: "thread", goal: { ...expected, seconds: 25 }, liveSeconds: 30 };
  assert.equal(goal.matchesExpectedGoal(snapshot, "thread", expected), true);
  assert.equal(goal.matchesExpectedGoal(snapshot, "previous-thread", expected), false);
  assert.equal(goal.matchesExpectedGoal(snapshot, "thread", { ...expected, id: "old-goal" }), false);
  assert.equal(goal.matchesExpectedGoal(snapshot, "thread", { ...expected, objective: "Old text" }), false);
  assert.equal(goal.matchesExpectedGoal(snapshot, "thread", { ...expected, status: "paused" }), false);
  assert.equal(goal.matchesExpectedGoal(snapshot, null, null), false);
  const cleared = { ...snapshot, goal: null, liveSeconds: null };
  assert.equal(goal.matchesExpectedGoal(cleared, "thread", expected), false);
  assert.equal(goal.matchesExpectedGoal(cleared, null, null), true);
  assert.equal(goal.matchesExpectedGoal(cleared, "previous-thread", null), false);
});

test("goal reads stop estimating on pause, completion, blocking, or turn end and restart on resume", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-goal-time-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const turnStart = Date.parse("2026-01-01T12:00:00Z");
  const clock = context.mock.method(Date, "now", () => turnStart + 3_500);
  const database = new DatabaseSync(join(directory, "goals_1.sqlite"));
  context.after(() => database.close());
  database.exec(`CREATE TABLE thread_goals (
    thread_id TEXT PRIMARY KEY, goal_id TEXT, objective TEXT, status TEXT,
    time_used_seconds INTEGER, updated_at_ms INTEGER
  )`);
  const insert = database.prepare("INSERT INTO thread_goals VALUES (?, ?, ?, ?, ?, ?)");
  insert.run("thread", "goal", "Run checks", "active", 200, turnStart - 60_000);
  const update = database.prepare("UPDATE thread_goals SET status = ?, time_used_seconds = ?, updated_at_ms = ?");
  const agent = {
    provider: "codex",
    cwd: directory,
    runtimeInfo: { sessionId: "thread" },
    status: "running",
    activeTurn: { startedAt: new Date(turnStart).toISOString() },
  };
  const handlers = new Map();
  let openSession;
  const stop = contribute({
    handle: (rpc, handler) => handlers.set(rpc.name, handler),
    registerSettings: (settings) => assert.equal(settings, shortcuts.shortcutSettings),
    addHook: (name, handler) => {
      assert.equal(name, "agent.open.before");
      openSession = handler;
      return () => {};
    },
  });
  context.after(stop);

  const request = { provider: "codex", purpose: "interactive", background: false, tools: [], appendSystemPrompt: ["Existing instructions"] };
  assert.equal(await openSession({ request: { ...request, provider: "claude" } }), undefined);
  assert.equal(await openSession({ request: { ...request, purpose: "history" } }), undefined);
  assert.equal(await openSession({ request: { ...request, background: true } }), undefined);
  const opened = await openSession({ request });
  assert.equal(opened.appendSystemPrompt[0], "Existing instructions");
  assert.match(opened.appendSystemPrompt[1], /missing prerequisite/);
  const [tool] = opened.tools;
  assert.equal(tool.name, "codex_goal_manage");

  const paseo = {
    agents: {
      ref: () => ({
        refresh: async () => ({ agent }),
        commands: async () => ({ commands: [{ name: "goal", kind: "command" }] }),
        async send(command, options) {
          assert.equal(command, "/goal resume");
          assert.deepEqual(options, { activeTurnBehavior: "steer" });
          update.run("active", 206, turnStart + 19_000);
        },
      }),
    },
    config: {
      get: async () => ({
        config: { providers: { codex: { env: { CODEX_HOME: directory, CODEX_SQLITE_HOME: directory } } } },
      }),
    },
  };
  const read = () => goal.unwrapGoal(handlers.get(goal.readGoal.name)({ agentId: "agent" }, { paseo }));

  assert.equal((await read()).liveSeconds, 203);
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

  update.run("blocked", 206, turnStart + 6_000);
  const blocked = await read();
  assert.equal(blocked.liveSeconds, null);
  assert.equal(blocked.goal.status, "blocked");
  assert.equal(blocked.goal.seconds, 206);

  const resumed = await goal.unwrapGoal(handlers.get(goal.changeGoal.name)({
    agentId: "agent", threadId: blocked.threadId, expected: blocked.goal, action: { kind: "resume" },
  }, { paseo }));
  assert.equal(resumed.goal.status, "active");
  assert.equal(resumed.liveSeconds, 207);

  update.run("blocked", 206, turnStart + 19_000);
  const toolContext = { agent: { id: "agent" }, paseo, signal: new AbortController().signal };
  const toolRead = await tool.execute({ action: { kind: "read" } }, toolContext);
  assert.equal(toolRead.structuredContent.goal.status, "blocked");
  const toolResume = await tool.execute({ action: { kind: "resume" } }, toolContext);
  assert.equal(toolResume.structuredContent.goal.id, blocked.goal.id);
  assert.equal(toolResume.structuredContent.goal.status, "active");

  agent.status = "idle";
  const idle = await read();
  assert.equal(idle.liveSeconds, null);
  assert.equal(idle.goal.seconds, 206);

  const commands = [];
  const handle = paseo.agents.ref();
  const editContext = { ...toolContext, paseo: { ...paseo, agents: { ref: () => handle } } };
  let newGoalCount = 0;
  handle.send = async (command) => {
    commands.push(command);
    if (command === "/goal clear") {
      database.exec("DELETE FROM thread_goals WHERE thread_id = 'thread'");
      return;
    }
    const objective = command.slice("/goal ".length);
    const row = database.prepare("SELECT goal_id FROM thread_goals WHERE thread_id = 'thread'").get();
    if (row) database.prepare("UPDATE thread_goals SET objective = ? WHERE thread_id = 'thread'").run(objective);
    else insert.run("thread", `new-goal-${++newGoalCount}`, objective, "active", 0, Date.now());
  };
  const rewrite = await tool.execute({ action: { kind: "set", objective: "Run regressions" } }, editContext);
  assert.equal(rewrite.structuredContent.goal.id, "goal");
  assert.equal(rewrite.structuredContent.goal.seconds, 206);
  const append = await tool.execute({ action: { kind: "append", objective: "Review logs" } }, editContext);
  assert.equal(append.structuredContent.goal.id, "goal");
  assert.equal(append.structuredContent.goal.seconds, 206);
  assert.equal(append.structuredContent.goal.objective, "Run regressions\n\nReview logs");
  assert.deepEqual(commands.splice(0), ["/goal Run regressions", "/goal Run regressions\n\nReview logs"]);

  const objective = append.structuredContent.goal.objective;
  let previousGoal = append.structuredContent.goal;
  for (const status of goal.goalSchema.shape.status.options) {
    update.run(status, 206, turnStart + 19_000);
    const create = await tool.execute({ action: { kind: "create", objective } }, editContext);
    assert.notEqual(create.structuredContent.goal.id, previousGoal.id, status);
    assert.equal(create.structuredContent.goal.seconds, 0, status);
    assert.equal(create.structuredContent.goal.status, "active", status);
    assert.deepEqual(commands.splice(0), ["/goal clear", `/goal ${objective}`], status);
    previousGoal = create.structuredContent.goal;
  }
});
