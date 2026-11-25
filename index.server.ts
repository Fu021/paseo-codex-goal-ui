import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { changeGoal, estimateGoalSeconds, readGoal, type GoalAction, type GoalSnapshot } from "./shared/goal";
import { readNativeGoal, sqliteHome } from "./server/store";

type Paseo = PluginHandlerContext["paseo"];

const providerEnvironment = z.record(z.string(), z.string()).optional();

async function readAgent(paseo: Paseo, agentId: string) {
  const agent = (await paseo.agents.ref(agentId).refresh())?.agent;
  if (!agent || agent.provider !== "codex" || agent.archivedAt || agent.providerUnavailable) {
    throw new Error("当前 Codex 会话不可用。");
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
    throw new Error("无法读取 Codex 的目标状态，请检查会话主机上的 Codex 数据目录。");
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
  server.handle(readGoal, ({ agentId }, { paseo }) => inspectGoal(paseo, agentId));
  server.handle(changeGoal, async ({ agentId, threadId, expected, action }, { paseo }) => {
    if (pending.has(agentId)) throw new Error("此会话的目标正在更新。");
    pending.add(agentId);
    try {
      await readAgent(paseo, agentId);
      const handle = paseo.agents.ref(agentId);
      const commands = await handle.commands();
      if (commands.error || !commands.commands.some((command) => command.name === "goal" && command.kind === "command")) {
        throw new Error("当前 Codex 会话未提供原生 /goal 命令。");
      }

      const before = await inspectGoal(paseo, agentId);
      const goal = before.goal;
      if (
        (threadId !== before.threadId && (threadId !== null || before.goal !== null)) ||
        expected?.id !== goal?.id || expected?.objective !== goal?.objective ||
        expected?.status !== goal?.status
      ) {
        throw new Error("目标已变化，请刷新后再操作。");
      }
      if (action.kind !== "set" && !goal) throw new Error("当前会话没有目标。");

      const args = action.kind === "set" ? action.objective : action.kind;
      await handle.send(`/goal ${args}`, { activeTurnBehavior: "steer" });

      for (const milliseconds of [0, 150, 300, 550, 1000, 1500, 2000]) {
        await delay(milliseconds, undefined, { signal: lifetime.signal });
        const after = await inspectGoal(paseo, agentId);
        if (before.threadId && after.threadId !== before.threadId) {
          throw new Error("Codex 会话已变化，请刷新目标。");
        }
        if (hasApplied(action, before, after)) return after;
      }
      throw new Error("Codex 尚未确认目标更新，请查看聊天中的 /goal 结果。");
    } finally {
      pending.delete(agentId);
    }
  });
  return () => lifetime.abort();
}
