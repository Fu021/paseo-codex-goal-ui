import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const statuses = {
  active: "进行中",
  paused: "已暂停",
  blocked: "受阻",
  usage_limited: "用量受限",
  budget_limited: "预算用尽",
  complete: "已完成",
} as const;

const goalIdentity = z.object({
  id: z.string(),
  objective: z.string(),
  status: z.enum(Object.keys(statuses) as [keyof typeof statuses, ...(keyof typeof statuses)[]]),
});

export const goalSchema = goalIdentity.extend({
  seconds: z.number().int().nonnegative(),
});

export const snapshotSchema = z.object({
  threadId: z.string().nullable(),
  goal: goalSchema.nullable(),
  liveSeconds: z.number().int().nonnegative().nullable(),
});

export function estimateGoalSeconds(seconds: number, updatedAtMs: number, turnStartedAt: string, now: number) {
  const turnStart = Date.parse(turnStartedAt);
  if (!Number.isFinite(turnStart)) return null;
  const baseline = Math.max(turnStart, updatedAtMs);
  return seconds + Math.floor(Math.max(0, now - baseline) / 1000);
}

export const readGoal = defineRpc({
  name: "goal.read",
  input: z.object({ agentId: z.string().min(1) }),
  output: snapshotSchema,
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
          "目标内容不能是 pause、resume 或 clear。",
        ),
      }),
      z.object({ kind: z.enum(["pause", "resume", "clear"]) }),
    ]),
  }),
  output: snapshotSchema,
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
