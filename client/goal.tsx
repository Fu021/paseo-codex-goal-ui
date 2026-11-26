import {
  type PluginButtonContentProps,
  type PluginButtonIconProps,
  type PluginHostProps,
  useRpc,
  useTranslation,
} from "@getpaseo/plugin/client";
import { Icon, ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import {
  changeGoal,
  formatDuration,
  GoalError,
  readGoal,
  reservedObjectives,
  unwrapGoal,
  type GoalAction,
  type GoalSnapshot,
} from "../shared/goal";
import { messages } from "./messages";

function goalKey(hostId: string, agentId: string) {
  return ["codex-goal-ui", hostId, agentId];
}

function useGoal(hostId: string, agentId: string) {
  const read = useRpc(readGoal);
  return useQuery({
    queryKey: goalKey(hostId, agentId),
    queryFn: () => unwrapGoal(read({ agentId })),
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

const statusIcons = {
  active: "CirclePlay",
  paused: "CirclePause",
  complete: "CircleCheck",
} as const;

export function createGoalIcon(
  updateButton: (label: string, title: string) => void,
  useSubscriptionStatus: () => GoalSubscriptionStatus,
) {
  return function GoalIcon(props: PluginButtonIconProps) {
    const status = useSubscriptionStatus();
    const { t } = useTranslation(messages);
    const unavailable = status !== "ready";
    const failureTitle = t("syncFailed");
    useEffect(() => {
      if (unavailable) updateButton("Goal", failureTitle);
    }, [unavailable, failureTitle]);
    if (unavailable) {
      return <Icon name="TriangleAlert" color={props.theme.colors.statusWarning} size={props.size} />;
    }
    return props.context === "agent" ? <GoalIndicator {...props} updateButton={updateButton} /> : null;
  };
}

function GoalIndicator({
  host, agentId, color, size, theme, updateButton,
}: Extract<PluginButtonIconProps, { context: "agent" }> & {
  updateButton: (label: string, title: string) => void;
}) {
  const { data, dataUpdatedAt, isError } = useGoal(host.id, agentId);
  const { t } = useTranslation(messages);
  const goal = data?.goal;
  const status = isError ? t("readFailed") : goal ? t(`status.${goal.status}`) : null;
  const { seconds } = useGoalTime(data, dataUpdatedAt, isError);
  const elapsed = seconds === undefined ? null : formatDuration(seconds);
  const label = elapsed ?? (isError ? t("readFailed") : "Goal");
  const title = ["Codex Goal", status, elapsed && t("elapsed", { time: elapsed })].filter(Boolean).join(" · ");
  useEffect(() => updateButton(label, title), [label, title, updateButton]);
  const appearance = {
    active: theme.colors.accent,
    paused: theme.colors.statusWarning,
    complete: theme.colors.statusSuccess,
  };
  const iconStatus = goal?.status;
  if (isError) return <Icon name="TriangleAlert" color={theme.colors.statusWarning} size={size} />;
  if (iconStatus === "active" || iconStatus === "paused" || iconStatus === "complete") {
    return <Icon name={statusIcons[iconStatus]} color={appearance[iconStatus]} size={size} />;
  }
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
  const { t } = useTranslation(messages);
  return (
    <View style={{ gap: 10, paddingVertical: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
        <Icon name="TriangleAlert" color={colors.statusWarning} size={16} />
        <Text style={{ color: colors.foreground, fontWeight: "600", flexShrink: 1 }}>{t("syncFailed")}</Text>
      </View>
      <Text accessibilityLiveRegion="polite" style={{ color: colors.foregroundMuted }}>
        {t(retrying ? "syncing" : "syncFailedDetail")}
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
        <Text style={{ color: colors.foreground }}>{t(retrying ? "retrying" : "action.retry")}</Text>
      </Pressable>
    </View>
  );
}

function GoalControls({
  theme, host, agentId, maxObjectiveHeight,
}: Extract<PluginButtonContentProps, { context: "agent" }> & { maxObjectiveHeight?: number }) {
  const state = useGoal(host.id, agentId);
  const { t } = useTranslation(messages);
  const cache = useQueryClient();
  const change = useRpc(changeGoal);
  const key = goalKey(host.id, agentId);
  const [draft, setDraft] = useState<{ objective: string; base: GoalSnapshot } | null>(null);
  const [confirmClear, setConfirmClear] = useState<GoalSnapshot | null>(null);
  const mutation = useMutation({
    mutationFn: ({ action, base }: { action: GoalAction; base: GoalSnapshot }) => unwrapGoal(change({
      agentId, action, threadId: base.threadId, expected: base.goal,
    })),
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
  const error = mutation.error ?? state.error;
  const errorMessage = error instanceof GoalError ? t(`error.${error.code}`) :
    error ? t(mutation.error ? "error.changeRequest" : "error.readRequest") : null;
  if (!snapshot) {
    return (
      <View style={{ gap: 10 }}>
        <Text style={{ color: colors.foreground }} accessibilityLiveRegion="polite">
          {errorMessage ?? t("loading")}
        </Text>
        {state.isError && (
          <Action theme={theme} icon="RotateCw" label={t("action.retry")} disabled={state.isFetching} onPress={() => void state.refetch()} />
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
          <Text style={{ color: colors.foreground, fontWeight: "600" }}>{t(`status.${goal.status}`)}</Text>
          <GoalTime theme={theme} snapshot={snapshot} receivedAt={state.dataUpdatedAt} stale={state.isError} />
        </View>
      ) : (
        <Text style={{ color: colors.foreground, fontWeight: "600" }}>{t("setup")}</Text>
      )}

      <View>
        {desktop && (
          <ScrollView
            accessibilityLabel={editing ? undefined : t("currentGoal")}
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
            accessibilityLabel={t("objective")}
            editable={!busy}
            multiline
            placeholder={t("placeholder")}
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

      {(invalidObjective || errorMessage) && (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.foreground }}>
          {invalidObjective ? t("error.invalidObjective") : errorMessage}
        </Text>
      )}

      {confirmClear && (
        <Text style={{ color: colors.foreground }}>{t("confirmClear")}</Text>
      )}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {confirmClear ? (
          <>
            <Action theme={theme} icon="Trash2" label={t("action.confirmClear")} destructive disabled={busy} onPress={() => submit({ kind: "clear" }, confirmClear)} />
            <Action theme={theme} icon="X" label={t("action.cancel")} disabled={mutation.isPending} onPress={() => setConfirmClear(null)} />
          </>
        ) : editing ? (
          <>
            <Action
              theme={theme}
              icon={goal ? "Check" : "Play"}
              label={t(goal?.status === "active" ? "action.save" : goal ? "action.saveAndResume" : "action.start")}
              disabled={busy || !normalized || invalidObjective || normalized === goal?.objective}
              onPress={() => submit({ kind: "set", objective: normalized }, draft?.base)}
            />
            {goal && (
              <Action theme={theme} icon="X" label={t("action.cancel")} disabled={mutation.isPending} onPress={() => setDraft(null)} />
            )}
          </>
        ) : (
          <>
            {goal?.status === "active" && (
              <Action theme={theme} icon="Pause" label={t("action.pause")} disabled={busy} onPress={() => submit({ kind: "pause" })} />
            )}
            {canResume && (
              <Action theme={theme} icon="Play" label={t("action.resume")} disabled={busy} onPress={() => submit({ kind: "resume" })} />
            )}
            {goal && (
              <Action theme={theme} icon="Pencil" label={t("action.edit")} disabled={busy} onPress={() => setDraft({ objective: goal.objective, base: snapshot })} />
            )}
            <Action theme={theme} icon="Trash2" label={t("action.clear")} destructive disabled={busy} onPress={() => setConfirmClear(snapshot)} />
          </>
        )}
        {state.isError && (
          <Action theme={theme} icon="RotateCw" label={t("action.retry")} disabled={state.isFetching} onPress={() => void state.refetch()} />
        )}
      </View>
      {mutation.isPending && (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.foregroundMuted }}>{t("updating")}</Text>
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
  const { t } = useTranslation(messages);
  if (seconds === undefined) return null;
  return (
    <Text style={{ color: theme.colors.foregroundMuted, fontVariant: ["tabular-nums"] }}>
      {t("elapsed", { time: formatDuration(seconds) })}
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
