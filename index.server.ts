import { defineAgentTool, type PluginHandlerContext, type PluginServerContext } from "@getpaseo/plugin/server";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import {
  changeGoal, estimateGoalSeconds, GoalError, goalObjective, matchesExpectedGoal, readGoal, type GoalAction, type GoalSnapshot,
} from "./shared/goal";
import { shortcutSettings } from "./shared/shortcuts";
import { readNativeGoal, sqliteHome } from "./server/store";

type Paseo = PluginHandlerContext["paseo"];
type GoalChangeBase = Pick<z.output<typeof changeGoal.input>, "threadId" | "expected">;
type GoalEdit = GoalAction | { kind: "create"; objective: string } | { kind: "append"; objective: string };

const providerEnvironment = z.record(z.string(), z.string()).optional();
const newGoalObjective = goalObjective.refine(
  (objective) => Array.from(objective).length <= 4000,
  "The goal cannot exceed 4000 characters.",
);
const goalInstructions = [
  "Always use the Paseo tool codex_goal_manage for Goal reads, creation, objective edits, appends, pauses, resumptions, and clears in this session. If it is deferred, call tool_search for codex_goal_manage. Do not use get_goal or create_goal, or call update_goal to pause. If the Paseo tool is unavailable, report that the requested operation needs Paseo tool injection instead of switching to a built-in tool.",
  "Call codex_goal_manage with action kind create for a new Goal, including the first Goal in a fresh session. This replaces an existing Goal and resets its timer. Use set to rewrite the current objective and append to add work, preserving its time.",
  "Use the native update_goal tool only to report actual completion or mark a blocker under Codex's Goal rules.",
  "Proactively use a Goal for complex work or a growing task queue when the user has requested ongoing tracking.",
  "When the user says a missing prerequisite is now available, check the current Goal even if they don't mention it by name. If the Goal is blocked and you can now proceed, call codex_goal_manage with action kind resume before continuing the work. If the tool is deferred, look it up by name. Resume without waiting for a separate request. Leave a deliberately paused Goal paused until the user asks to continue.",
].join(" ");

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
      return after.goal?.objective === action.objective && after.goal.status === "active";
    case "pause":
      return after.goal?.id === before.goal?.id && after.goal?.status === "paused";
    case "resume":
      return after.goal?.id === before.goal?.id && after.goal?.status === "active";
    case "clear":
      return after.goal === null;
  }
}

async function sendGoalCommand(
  paseo: Paseo, agentId: string, action: GoalAction, before: GoalSnapshot, signal: AbortSignal,
  previousGoalId?: string,
) {
  const args = action.kind === "set" ? action.objective : action.kind;
  signal.throwIfAborted();
  await paseo.agents.ref(agentId).send(`/goal ${args}`, { activeTurnBehavior: "steer" });

  for (const milliseconds of [0, 150, 300, 550, 1000, 1500, 2000]) {
    await delay(milliseconds, undefined, { signal });
    const after = await inspectGoal(paseo, agentId);
    if (before.threadId && after.threadId !== before.threadId) throw new GoalError("sessionChanged");
    if (hasApplied(action, before, after) && (!previousGoalId || after.goal?.id !== previousGoalId)) return after;
  }
  throw new GoalError("unconfirmed");
}

export default function contribute(server: PluginServerContext) {
  const pending = new Set<string>();
  const lifetime = new AbortController();

  async function applyGoalEdit(
    paseo: Paseo, agentId: string, edit: GoalEdit, signal: AbortSignal, base?: GoalChangeBase,
  ) {
    if (pending.has(agentId)) throw new GoalError("busy");
    pending.add(agentId);
    try {
      signal.throwIfAborted();
      await readAgent(paseo, agentId);
      const handle = paseo.agents.ref(agentId);
      const commands = await handle.commands();
      if (commands.error || !commands.commands.some((command) => command.name === "goal" && command.kind === "command")) {
        throw new GoalError("unsupported");
      }

      const before = await inspectGoal(paseo, agentId);
      if (base && !matchesExpectedGoal(before, base.threadId, base.expected)) throw new GoalError("goalChanged");
      if (edit.kind === "create") {
        const action = { kind: "set", objective: edit.objective } as const;
        if (!before.goal) return await sendGoalCommand(paseo, agentId, action, before, signal);

        signal.throwIfAborted();
        const cleared = await sendGoalCommand(paseo, agentId, { kind: "clear" }, before, lifetime.signal);
        const current = await inspectGoal(paseo, agentId);
        if (current.threadId !== cleared.threadId) throw new GoalError("sessionChanged");
        if (current.goal) throw new GoalError("goalChanged");
        return await sendGoalCommand(paseo, agentId, action, current, lifetime.signal, before.goal.id);
      }

      let action: GoalAction;
      if (edit.kind === "set") {
        action = edit;
      } else {
        if (!before.goal) throw new GoalError("noGoal");
        action = edit.kind === "append"
          ? { kind: "set", objective: `${before.goal.objective.trimEnd()}\n\n${edit.objective}` }
          : edit;
      }

      return await sendGoalCommand(paseo, agentId, action, before, signal);
    } finally {
      pending.delete(agentId);
    }
  }

  const goalTool = defineAgentTool({
    name: "codex_goal_manage",
    description: [
      "Use this tool for all Goal reads, creation, objective edits, appends, pauses, resumptions, and clears in the current Codex session. Do not use get_goal, create_goal, or update_goal for these operations. Use update_goal only to record completion or a blocker under Codex's Goal rules.",
      "For complex work or a growing task queue, proactively check the Goal and keep its objective current when the user's instructions call for tracking that work.",
      "Use read to check the current objective and state. If the Goal is blocked and the user supplies the missing information or otherwise resolves the blocker, verify that the work can proceed, call resume, and continue the existing Goal without waiting for a separate resume request.",
      "If the blocker remains, explain the concrete condition still needed. For a deliberately paused Goal, wait for the user's request to continue.",
      "Use create when the user explicitly asks to start a new Goal or reset its timer. It clears any existing Goal, including its elapsed time, before starting a new one.",
      "Use set to rewrite the current objective, including a blocked Goal, or set an objective if none exists. Use append to add work to the current objective. Both preserve elapsed time and activate the Goal, so defer an edit that would reactivate a Goal that should stay paused or blocked.",
      "Use pause or clear only when the user explicitly asks. Report success only after the tool confirms the saved state.",
    ].join(" "),
    input: z.object({
      action: z.discriminatedUnion("kind", [
        z.object({
          kind: z.literal("create"),
          objective: newGoalObjective.describe("The new Goal's objective. This resets the timer."),
        }),
        z.object({ kind: z.literal("set"), objective: goalObjective.describe("The full objective to save while keeping the current timer.") }),
        z.object({ kind: z.literal("append"), objective: z.string().trim().min(1).describe("Only the work to add.") }),
        z.object({ kind: z.literal("read") }),
        z.object({ kind: z.enum(["pause", "resume", "clear"]) }),
      ]),
    }),
    async execute({ action }, { agent, paseo, signal }) {
      const result = await goalResult(() => {
        if (action.kind === "read") return inspectGoal(paseo, agent.id);
        return applyGoalEdit(paseo, agent.id, action, AbortSignal.any([signal, lifetime.signal]));
      });
      if ("error" in result) return { isError: true, text: `Could not ${action.kind} the Codex Goal: ${result.error}.` };
      return { structuredContent: { goal: result.goal } };
    },
  });

  server.registerSettings(shortcutSettings);
  server.handle(readGoal, ({ agentId }, { paseo }) => goalResult(() => inspectGoal(paseo, agentId)));
  server.handle(changeGoal, ({ agentId, threadId, expected, action }, { paseo }) =>
    goalResult(() => applyGoalEdit(paseo, agentId, action, lifetime.signal, { threadId, expected })),
  );
  const removeHook = server.addHook("agent.open.before", async ({ request }) => {
    if (request.provider !== "codex" || request.background || request.purpose === "history") return;
    return {
      ...request,
      appendSystemPrompt: [...(request.appendSystemPrompt ?? []), goalInstructions],
      tools: [...request.tools, goalTool],
    };
  });
  return () => {
    removeHook();
    lifetime.abort();
  };
}
