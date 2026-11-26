import {
  type PluginButtonContentProps,
  type PluginButtonIconProps,
  type PluginHostProps,
  useRpc,
} from "@getpaseo/plugin/client";
import { Icon, ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import {
  changeGoal,
  formatDuration,
  readGoal,
  reservedObjectives,
  statuses,
  type GoalAction,
  type GoalSnapshot,
} from "../shared/goal";

function goalKey(hostId: string, agentId: string) {
  return ["codex-goal-ui", hostId, agentId];
}

function useGoal(hostId: string, agentId: string) {
  const read = useRpc(readGoal);
  return useQuery({
    queryKey: goalKey(hostId, agentId),
    queryFn: () => read({ agentId }),
    staleTime: 1000,
    retry: false,
    refetchInterval: ({ state }) => state.data?.goal?.status === "active" ? 3000 : 10000,
  });
}

function useGoalTime(snapshot: GoalSnapshot | undefined, receivedAt: number, stale: boolean) {
  const liveSeconds = stale ? null : snapshot?.liveSeconds ?? null;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (liveSeconds === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [liveSeconds, receivedAt]);

  return {
    estimated: liveSeconds !== null,
    seconds: liveSeconds === null
      ? snapshot?.goal?.seconds
      : liveSeconds + Math.floor(Math.max(0, now - receivedAt) / 1000),
  };
}

export type GoalSubscriptionStatus = "ready" | "failed" | "retrying";

const subscriptionFailure = "Goal 会话同步失败";

export function createGoalIcon(
  updateButton: (label: string, title: string) => void,
  useSubscriptionStatus: () => GoalSubscriptionStatus,
) {
  return function GoalIcon(props: PluginButtonIconProps) {
    const status = useSubscriptionStatus();
    const unavailable = status !== "ready";
    useEffect(() => {
      if (unavailable) updateButton("Goal", subscriptionFailure);
    }, [unavailable]);
    if (unavailable) {
      return <Icon name="TriangleAlert" color={props.theme.colors.statusWarning} size={props.size} />;
    }
    return props.context === "agent" ? <GoalIndicator {...props} updateButton={updateButton} /> : null;
  };
}

function GoalIndicator({
  host, agentId, color, size, updateButton,
}: Extract<PluginButtonIconProps, { context: "agent" }> & {
  updateButton: (label: string, title: string) => void;
}) {
  const { data, dataUpdatedAt, isError } = useGoal(host.id, agentId);
  const goal = data?.goal;
  const status = isError ? "读取失败" : goal ? statuses[goal.status] : null;
  const { seconds } = useGoalTime(data, dataUpdatedAt, isError);
  const elapsed = seconds === undefined ? null : formatDuration(seconds);
  const label = elapsed ?? (isError ? "读取失败" : "Goal");
  const title = ["Codex Goal", status, elapsed && `累计运行 ${elapsed}`].filter(Boolean).join(" · ");
  useEffect(() => updateButton(label, title), [label, title, updateButton]);
  return <Icon name="Target" color={color} size={size} />;
}

export function GoalPopover(props: PluginButtonContentProps & { notice?: ReactNode }) {
  const { width, height } = useWindowDimensions();
  if (props.context !== "agent") return null;

  const contentWidth = props.layout.compact ? undefined : Math.min(394, Math.max(0, width - 56));
  const maxObjectiveHeight = props.layout.compact ? undefined : Math.min(300, Math.max(112, height - 168));
  return (
    <View style={{ width: contentWidth }}>
      {props.notice}
      <View style={props.notice ? { display: "none" } : undefined}>
        <GoalControls key={props.agentId} {...props} maxObjectiveHeight={maxObjectiveHeight} />
      </View>
    </View>
  );
}

export function GoalSubscriptionNotice({
  theme, retrying, onRetry,
}: Pick<PluginHostProps, "theme"> & { retrying: boolean; onRetry: () => void }) {
  const { colors } = theme;
  return (
    <View style={{ gap: 10, paddingVertical: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
        <Icon name="TriangleAlert" color={colors.statusWarning} size={16} />
        <Text style={{ color: colors.foreground, fontWeight: "600", flexShrink: 1 }}>{subscriptionFailure}</Text>
      </View>
      <Text accessibilityLiveRegion="polite" style={{ color: colors.foregroundMuted }}>
        {retrying ? "正在重新同步 Codex 会话…" : "暂时无法同步 Codex 会话。插件会自动重试。"}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: retrying, busy: retrying }}
        disabled={retrying}
        onPress={onRetry}
        style={({ pressed }) => ({
          alignSelf: "flex-start",
          minHeight: 36,
          justifyContent: "center",
          paddingHorizontal: 12,
          borderRadius: 7,
          backgroundColor: pressed ? colors.surface2 : colors.surface1,
          opacity: retrying ? 0.55 : 1,
        })}
      >
        <Text style={{ color: colors.foreground }}>{retrying ? "重试中…" : "重试"}</Text>
      </Pressable>
    </View>
  );
}

function GoalControls({
  theme, host, agentId, maxObjectiveHeight,
}: Extract<PluginButtonContentProps, { context: "agent" }> & { maxObjectiveHeight?: number }) {
  const state = useGoal(host.id, agentId);
  const cache = useQueryClient();
  const change = useRpc(changeGoal);
  const key = goalKey(host.id, agentId);
  const [draft, setDraft] = useState<{ objective: string; base: GoalSnapshot } | null>(null);
  const [confirmClear, setConfirmClear] = useState<GoalSnapshot | null>(null);
  const mutation = useMutation({
    mutationFn: ({ action, base }: { action: GoalAction; base: GoalSnapshot }) => change({
      agentId, action, threadId: base.threadId, expected: base.goal,
    }),
    onSuccess: async (snapshot) => {
      await cache.cancelQueries({ queryKey: key });
      cache.setQueryData(key, snapshot);
      setDraft(null);
      setConfirmClear(null);
    },
    onSettled: () => {
      void cache.invalidateQueries({ queryKey: key });
    },
  });

  const { colors } = theme;
  const snapshot = state.data;
  if (!snapshot) {
    return (
      <View style={{ gap: 10 }}>
        <Text style={{ color: colors.foreground }} accessibilityLiveRegion="polite">
          {state.error?.message ?? "正在读取目标…"}
        </Text>
        {state.isError && (
          <Action theme={theme} icon="RotateCw" label="重试" disabled={state.isFetching} onPress={() => void state.refetch()} />
        )}
      </View>
    );
  }

  const goal = snapshot.goal;
  const busy = mutation.isPending || state.isError;
  const editing = Boolean(draft) || !goal;
  const objective = draft?.objective ?? "";
  const normalized = objective.trim();
  const invalidObjective = reservedObjectives.test(normalized);
  const submit = (action: GoalAction, base = snapshot) => mutation.mutate({ action, base });
  const canResume = goal && ["paused", "blocked", "usage_limited"].includes(goal.status);
  const desktop = maxObjectiveHeight !== undefined;
  const currentText = editing ? objective : goal?.objective ?? "";
  const sizingText = currentText === "" || currentText.endsWith("\n") ? `${currentText}\u200B` : currentText;

  return (
    <View style={{ gap: 12 }}>
      {goal ? (
        <View style={{ gap: 6 }}>
          <Text style={{ color: colors.foreground, fontWeight: "600" }}>{statuses[goal.status]}</Text>
          <GoalTime theme={theme} snapshot={snapshot} receivedAt={state.dataUpdatedAt} stale={state.isError} />
        </View>
      ) : (
        <Text style={{ color: colors.foreground, fontWeight: "600" }}>设置目标</Text>
      )}

      <View>
        {desktop && (
          <ScrollView
            accessibilityLabel={editing ? undefined : "当前目标"}
            aria-hidden={editing}
            accessibilityElementsHidden={editing}
            importantForAccessibility={editing ? "no-hide-descendants" : "auto"}
            pointerEvents={editing ? "none" : "auto"}
            style={{ minHeight: 86, maxHeight: maxObjectiveHeight, opacity: editing ? 0 : 1 }}
          >
            <Text selectable={!editing} style={[styles.objectiveText, { color: colors.foreground }]}>
              {sizingText}
            </Text>
          </ScrollView>
        )}
        {editing && (
          <TextInput
            accessibilityLabel="目标内容"
            editable={!busy}
            multiline
            placeholder="输入希望 Codex 持续推进的目标"
            placeholderTextColor={colors.foregroundMuted}
            value={objective}
            onChangeText={(text) => setDraft({ objective: text, base: draft?.base ?? snapshot })}
            style={[
              {
                minHeight: 86,
                padding: 10,
                borderWidth: 1,
                borderRadius: 8,
                borderColor: colors.border,
                color: colors.foreground,
                lineHeight: 21,
                textAlignVertical: "top",
              },
              desktop && styles.desktopEditor,
            ]}
          />
        )}
        {!desktop && !editing && (
          <Text selectable style={{ color: colors.foreground, lineHeight: 21 }}>{goal?.objective}</Text>
        )}
      </View>

      {(invalidObjective || mutation.error || state.error) && (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.foreground }}>
          {invalidObjective ? "目标内容不能是 pause、resume 或 clear。" : (mutation.error ?? state.error)?.message}
        </Text>
      )}

      {confirmClear && (
        <Text style={{ color: colors.foreground }}>清除当前目标？</Text>
      )}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {confirmClear ? (
          <>
            <Action theme={theme} icon="Trash2" label="确认清除" destructive disabled={busy} onPress={() => submit({ kind: "clear" }, confirmClear)} />
            <Action theme={theme} icon="X" label="取消" disabled={mutation.isPending} onPress={() => setConfirmClear(null)} />
          </>
        ) : editing ? (
          <>
            <Action
              theme={theme}
              icon={goal ? "Check" : "Play"}
              label={goal?.status === "active" ? "保存" : goal ? "保存并继续" : "开始"}
              disabled={busy || !normalized || invalidObjective || normalized === goal?.objective}
              onPress={() => submit({ kind: "set", objective: normalized }, draft?.base)}
            />
            {goal && (
              <Action theme={theme} icon="X" label="取消" disabled={mutation.isPending} onPress={() => setDraft(null)} />
            )}
          </>
        ) : (
          <>
            {goal?.status === "active" && (
              <Action theme={theme} icon="Pause" label="暂停" disabled={busy} onPress={() => submit({ kind: "pause" })} />
            )}
            {canResume && (
              <Action theme={theme} icon="Play" label="继续" disabled={busy} onPress={() => submit({ kind: "resume" })} />
            )}
            {goal && (
              <Action theme={theme} icon="Pencil" label="编辑" disabled={busy} onPress={() => setDraft({ objective: goal.objective, base: snapshot })} />
            )}
            <Action theme={theme} icon="Trash2" label="清除" destructive disabled={busy} onPress={() => setConfirmClear(snapshot)} />
          </>
        )}
        {state.isError && (
          <Action theme={theme} icon="RotateCw" label="重试" disabled={state.isFetching} onPress={() => void state.refetch()} />
        )}
      </View>
      {mutation.isPending && (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.foregroundMuted }}>正在更新目标…</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  objectiveText: {
    padding: 11,
    fontSize: 14,
    lineHeight: 21,
  },
  desktopEditor: {
    ...StyleSheet.absoluteFillObject,
    fontSize: 14,
  },
});

function GoalTime({
  theme, snapshot, receivedAt, stale,
}: Pick<PluginHostProps, "theme"> & { snapshot: GoalSnapshot; receivedAt: number; stale: boolean }) {
  const { seconds } = useGoalTime(snapshot, receivedAt, stale);
  if (seconds === undefined) return null;
  return (
    <Text style={{ color: theme.colors.foregroundMuted, fontVariant: ["tabular-nums"] }}>
      累计运行 {formatDuration(seconds)}
    </Text>
  );
}

function Action({
  theme, icon, label, disabled, destructive, onPress,
}: Pick<PluginHostProps, "theme"> & {
  icon: string;
  label: string;
  disabled: boolean;
  destructive?: boolean;
  onPress: () => void;
}) {
  const { colors } = theme;
  const [hovered, setHovered] = useState(false);
  return (
    <View style={{ position: "relative", zIndex: hovered ? 1 : 0 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        style={({ pressed }) => ({
          width: 40,
          height: 36,
          borderRadius: 7,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: hovered || pressed ? colors.surface2 : colors.surface1,
          opacity: disabled ? 0.55 : 1,
        })}
      >
        <Icon name={icon} size={16} color={destructive ? colors.statusDanger : colors.foreground} />
      </Pressable>
      {hovered && (
        <View
          pointerEvents="none"
          aria-hidden
          style={{
            position: "absolute",
            bottom: 40,
            left: 0,
            paddingHorizontal: 8,
            paddingVertical: 5,
            borderRadius: 5,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface2,
          }}
        >
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12 }}>{label}</Text>
        </View>
      )}
    </View>
  );
}
