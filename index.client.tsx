import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { createGoalIcon, GoalPopover } from "./client/goal";

export default function contribute(client: PluginClientContext) {
  const lifetime = new AbortController();
  const pills = new Map<string, { workspaceId: string; registration: PluginButtonRegistration }>();

  function remove(agentId: string) {
    pills.get(agentId)?.registration.remove();
    pills.delete(agentId);
  }

  function register(agent: {
    id: string;
    provider: string;
    workspaceId?: string | null;
    archivedAt?: string | null;
  }) {
    if (lifetime.signal.aborted) return;
    const { id, workspaceId } = agent;
    if (agent.provider !== "codex" || agent.archivedAt || !workspaceId) {
      remove(id);
      return;
    }
    if (pills.get(id)?.workspaceId === workspaceId) return;

    remove(id);
    const icon = createGoalIcon((label, title) => pills.get(id)?.registration.update({ label, title }));
    const registration = client.addComposerPill({
      id: "goal",
      workspaceId,
      agentId: id,
      button: {
        title: "Codex Goal",
        label: "Goal",
        icon,
        behavior: { kind: "popover", Content: GoalPopover },
      },
    });
    pills.set(id, { workspaceId, registration });
  }

  void client.paseo.agents.list({ subscribe: {}, signal: lifetime.signal }).then(({ subscription }) => {
    if (lifetime.signal.aborted) return;
    subscription.subscribe({
      snapshot: ({ entries }) => {
        const present = new Set(entries.map(({ agent }) => agent.id));
        for (const id of pills.keys()) {
          if (!present.has(id)) remove(id);
        }
        for (const { agent } of entries) register(agent);
      },
      update: (message) => {
        if (message.type !== "agent_update") return;
        const update = message.payload;
        if (update.kind === "upsert") register(update.agent);
        else remove(update.agentId);
      },
    });
  }).catch((error) => {
    if (!lifetime.signal.aborted) console.error("Could not register Codex Goal buttons", error);
  });

  return () => {
    lifetime.abort();
    for (const id of pills.keys()) remove(id);
  };
}
