import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const goalIdentity = z.object({
  id: z.string(),
  objective: z.string(),
  status: z.enum(["active", "paused", "blocked", "usage_limited", "budget_limited", "complete"]),
});

export const goalSchema = goalIdentity.extend({
  seconds: z.number().int().nonnegative(),
});

export const snapshotSchema = z.object({
  threadId: z.string().nullable(),
  goal: goalSchema.nullable(),
  liveSeconds: z.number().int().nonnegative().nullable(),
});

const goalError = z.enum([
  "unavailable", "read", "busy", "unsupported", "goalChanged", "noGoal", "sessionChanged", "unconfirmed",
]);
const goalResult = z.union([snapshotSchema, z.object({ error: goalError })]);

export class GoalError extends Error {
  constructor(readonly code: z.infer<typeof goalError>) {
    super(code);
  }
}

export async function unwrapGoal(result: Promise<z.infer<typeof goalResult>>) {
  const value = await result;
  if ("error" in value) throw new GoalError(value.error);
  return value;
}

export function estimateGoalSeconds(seconds: number, updatedAtMs: number, turnStartedAt: string, now: number) {
  const turnStart = Date.parse(turnStartedAt);
  if (!Number.isFinite(turnStart)) return null;
  const baseline = Math.max(turnStart, updatedAtMs);
  return seconds + Math.floor(Math.max(0, now - baseline) / 1000);
}

export const readGoal = defineRpc({
  name: "goal.read",
  input: z.object({ agentId: z.string().min(1) }),
  output: goalResult,
});

export const reservedObjectives = /^(pause|resume|clear)$/i;

export const changeGoal = defineRpc({
  name: "goal.change",
  input: z.object({
    agentId: z.string().min(1),
    threadId: z.string().nullable(),
    expected: goalIdentity.nullable(),
    action: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("set"),
        objective: z.string().trim().min(1).refine(
          (objective) => !reservedObjectives.test(objective),
          "The goal cannot be pause, resume, or clear.",
        ),
      }),
      z.object({ kind: z.enum(["pause", "resume", "clear"]) }),
    ]),
  }),
  output: goalResult,
});

export type Goal = z.infer<typeof goalSchema>;
export type GoalSnapshot = z.infer<typeof snapshotSchema>;
export type GoalAction = z.input<typeof changeGoal.input>["action"];

export function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const remainder = seconds % 60;
  const clock = `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${clock}` : clock;
}
