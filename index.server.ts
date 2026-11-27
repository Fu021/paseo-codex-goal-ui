import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { changeGoal, estimateGoalSeconds, GoalError, readGoal, type GoalAction, type GoalSnapshot } from "./shared/goal";
import { shortcutSettings } from "./shared/shortcuts";
import { readNativeGoal, sqliteHome } from "./server/store";

type Paseo = PluginHandlerContext["paseo"];

const providerEnvironment = z.record(z.string(), z.string()).optional();

async function goalResult(run: () => Promise<GoalSnapshot>) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof GoalError) return { error: error.code };
    throw error;
  }
}

async function readAgent(paseo: Paseo, agentId: string) {
  const agent = (await paseo.agents.ref(agentId).refresh())?.agent;
  if (!agent || agent.provider !== "codex" || agent.archivedAt || agent.providerUnavailable) {
    throw new GoalError("unavailable");
  }
  return agent;
}

async function inspectGoal(paseo: Paseo, agentId: string): Promise<GoalSnapshot> {
  const agent = await readAgent(paseo, agentId);
  const threadId = agent.runtimeInfo?.sessionId ?? agent.persistence?.sessionId ?? null;
  const turnStartedAt = agent.status === "running" ? agent.activeTurn?.startedAt ?? null : null;
  if (!threadId) return { threadId, goal: null, liveSeconds: null };

  try {
    const { config } = await paseo.config.get();
    const env = providerEnvironment.parse(config.providers.codex?.env) ?? {};
    const home = await sqliteHome(env, agent.cwd);
    const goal = await readNativeGoal(home, threadId);
    const liveSeconds = goal?.status === "active" && turnStartedAt
      ? estimateGoalSeconds(goal.seconds, goal.updatedAtMs, turnStartedAt, Date.now())
      : null;
    return { threadId, goal, liveSeconds };
  } catch (error) {
    console.error("Could not read Codex goal state", error instanceof Error ? error.name : "UnknownError");
    throw new GoalError("read");
  }
}

function hasApplied(action: GoalAction, before: GoalSnapshot, after: GoalSnapshot) {
  switch (action.kind) {
    case "set":
      return after.goal?.objective === action.objective;
    case "pause":
      return after.goal?.id === before.goal?.id && after.goal?.status === "paused";
    case "resume":
      return after.goal?.id === before.goal?.id && after.goal?.status !== before.goal?.status;
    case "clear":
      return after.goal === null;
  }
}

export default function contribute(server: PluginServerContext) {
  const pending = new Set<string>();
  const lifetime = new AbortController();
  server.registerSettings(shortcutSettings);
  server.handle(readGoal, ({ agentId }, { paseo }) => goalResult(() => inspectGoal(paseo, agentId)));
  server.handle(changeGoal, ({ agentId, threadId, expected, action }, { paseo }) => goalResult(async () => {
    if (pending.has(agentId)) throw new GoalError("busy");
    pending.add(agentId);
    try {
      await readAgent(paseo, agentId);
      const handle = paseo.agents.ref(agentId);
      const commands = await handle.commands();
      if (commands.error || !commands.commands.some((command) => command.name === "goal" && command.kind === "command")) {
        throw new GoalError("unsupported");
      }

      const before = await inspectGoal(paseo, agentId);
      const goal = before.goal;
      if (
        (threadId !== before.threadId && (threadId !== null || before.goal !== null)) ||
        expected?.id !== goal?.id || expected?.objective !== goal?.objective ||
        expected?.status !== goal?.status
      ) {
        throw new GoalError("goalChanged");
      }
      if (action.kind !== "set" && !goal) throw new GoalError("noGoal");

      const args = action.kind === "set" ? action.objective : action.kind;
      await handle.send(`/goal ${args}`, { activeTurnBehavior: "steer" });

      for (const milliseconds of [0, 150, 300, 550, 1000, 1500, 2000]) {
        await delay(milliseconds, undefined, { signal: lifetime.signal });
        const after = await inspectGoal(paseo, agentId);
        if (before.threadId && after.threadId !== before.threadId) {
          throw new GoalError("sessionChanged");
        }
        if (hasApplied(action, before, after)) return after;
      }
      throw new GoalError("unconfirmed");
    } finally {
      pending.delete(agentId);
    }
  }));
  return () => lifetime.abort();
}
