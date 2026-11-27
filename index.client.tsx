import {
  type PluginButtonContentProps,
  type PluginButtonRegistration,
  type PluginClientContext,
  type PluginComposerItemProps,
  useComposer,
} from "@getpaseo/plugin/client";
import { useSyncExternalStore } from "react";
import { createGoalIcon, GoalPopover, GoalSubscriptionNotice, type GoalSubscriptionStatus } from "./client/goal";
import { ShortcutSettings } from "./client/shortcuts";

export default function contribute(client: PluginClientContext) {
  const lifetime = new AbortController();
  const pills = new Map<string, { workspaceId: string; registration: PluginButtonRegistration }>();
  const initialRetryDelay = 1000;
  const maxRetryDelay = 30000;
  let retryDelay = initialRetryDelay;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let status: GoalSubscriptionStatus = "ready";
  const statusListeners = new Set<() => void>();

  function setStatus(next: GoalSubscriptionStatus) {
    if (status === next) return;
    status = next;
    for (const listener of statusListeners) listener();
  }

  function subscribeStatus(listener: () => void) {
    statusListeners.add(listener);
    return () => {
      statusListeners.delete(listener);
    };
  }

  const getStatus = () => status;

  function useSubscriptionStatus() {
    return useSyncExternalStore(subscribeStatus, getStatus, getStatus);
  }

  function GoalContent(props: PluginButtonContentProps) {
    const current = useSubscriptionStatus();
    return <GoalPopover {...props} sync={current === "ready" ? undefined : { retrying: current === "retrying", onRetry: retry }} />;
  }

  function SubscriptionNotice(props: PluginComposerItemProps) {
    const current = useSubscriptionStatus();
    const composer = useComposer();
    if (current === "ready" || composer.context !== "agent" || composer.agent.provider !== "codex") return null;
    for (const agentId of pills.keys()) {
      if (client.composers({ agentId }).includes(composer)) return null;
    }
    return <GoalSubscriptionNotice theme={props.theme} retrying={current === "retrying"} onRetry={retry} />;
  }

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
    const icon = createGoalIcon(
      (label, title) => pills.get(id)?.registration.update({ label, title }),
      useSubscriptionStatus,
    );
    const registration = client.addComposerPill({
      id: "goal",
      workspaceId,
      agentId: id,
      button: {
        title: "Codex Goal",
        label: "Goal",
        icon,
        behavior: { kind: "popover", Content: GoalContent },
      },
    });
    pills.set(id, { workspaceId, registration });
  }

  function scheduleRetry(error: unknown) {
    if (lifetime.signal.aborted || retryTimer !== undefined) return;
    if (retryDelay === initialRetryDelay) console.warn("Could not subscribe to Codex Goal agents", error);
    retryTimer = setTimeout(retry, retryDelay);
    retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
    setStatus("failed");
  }

  function retry() {
    if (lifetime.signal.aborted || retryTimer === undefined) return;
    clearTimeout(retryTimer);
    retryTimer = undefined;
    setStatus("retrying");
    void observeAgents();
  }

  async function observeAgents() {
    try {
      const { subscription } = await client.paseo.agents.list({
        subscribe: {},
        signal: lifetime.signal,
      });
      if (lifetime.signal.aborted) return;
      subscription.subscribe({
        snapshot: ({ entries }) => {
          retryDelay = initialRetryDelay;
          const present = new Set(entries.map(({ agent }) => agent.id));
          for (const id of pills.keys()) {
            if (!present.has(id)) remove(id);
          }
          for (const { agent } of entries) register(agent);
          setStatus("ready");
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "upsert") register(update.agent);
          else remove(update.agentId);
        },
        error: scheduleRetry,
      });
    } catch (error) {
      scheduleRetry(error);
    }
  }

  const removeNotice = client.addComposerItem({ id: "goal-subscription-notice", Component: SubscriptionNotice });
  const removeSettings = client.addSettingsScreen({ id: "shortcuts", title: "Codex Goal", icon: "Keyboard", Component: ShortcutSettings });
  void observeAgents();

  return () => {
    clearTimeout(retryTimer);
    lifetime.abort();
    for (const id of pills.keys()) remove(id);
    removeSettings();
    return removeNotice();
  };
}
