import {
  type PluginButtonContentProps,
  type PluginButtonIconProps,
  type PluginHostProps,
  useHosts,
  useRpc,
  useSettings,
  useTranslation,
} from "@getpaseo/plugin/client";
import { Icon, ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AppState, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import {
  changeGoal,
  formatDuration,
  GoalError,
  matchesExpectedGoal,
  readGoal,
  reservedObjectives,
  unwrapGoal,
  type Goal,
  type GoalAction,
  type GoalSnapshot,
} from "../shared/goal";
import { type GoalShortcuts, shortcutSettings } from "../shared/shortcuts";
import { messages } from "./messages";
import { GoalKeyboardScope, shortcutLabel } from "./shortcuts";

function goalKey(hostId: string, agentId: string) {
  return ["codex-goal", hostId, agentId];
}

function useGoal(hostId: string, agentId: string) {
  const read = useRpc(readGoal);
  const host = useHosts().find(({ serverId }) => serverId === hostId);
  const reachable = !host || host.status === "online";
  const state = useQuery({
    queryKey: goalKey(hostId, agentId),
    queryFn: () => unwrapGoal(read({ agentId })),
    enabled: reachable,
    staleTime: 1000,
    retry: 1,
    retryDelay: 750,
    refetchInterval: ({ state }) =>
      state.status === "error" || state.data?.goal?.status === "active" ? 3000 : 10000,
  });

  const { isError, errorUpdatedAt, dataUpdatedAt, refetch } = state;
  const readFailed = isError || errorUpdatedAt > dataUpdatedAt;
  useEffect(() => {
    if (Platform.OS === "web" || !reachable || !readFailed) return;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void refetch({ cancelRefetch: false });
    });
    return () => subscription.remove();
  }, [reachable, readFailed, refetch]);

  return { state, readFailed };
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

const goalStatusIcons = {
  unset: { name: "Target", color: "#6d7988" },
  active: { name: "CirclePlay", color: "#31844d" },
  paused: { name: "CirclePause", color: "#9b7d15" },
  blocked: { name: "OctagonX", color: "#c8475d" },
  usage_limited: { name: "Clock", color: "#1d8690" },
  budget_limited: { name: "CircleDollarSign", color: "#8a64c4" },
  complete: { name: "BadgeCheck", color: "#3a78c9" },
  unavailable: { name: "TriangleAlert", color: "#c0672d" },
} satisfies Record<Goal["status"] | "unset" | "unavailable", { name: string; color: string }>;

function GoalStatusIcon({ status, size }: { status: keyof typeof goalStatusIcons; size: number }) {
  const { name, color } = goalStatusIcons[status];
  return <Icon name={name} color={color} size={size} />;
}

function GoalPillIcon({ status, chineseLabel = false }: { status: keyof typeof goalStatusIcons; chineseLabel?: boolean }) {
  return (
    <View style={{ transform: [{ translateY: chineseLabel ? 0.5 : -0.5 }] }}>
      <GoalStatusIcon status={status} size={16} />
    </View>
  );
}

const panelStatusIconSize = 22;

function GoalWarningIcon() {
  return (
    <View style={{ flexShrink: 0 }}>
      <GoalStatusIcon status="unavailable" size={panelStatusIconSize} />
    </View>
  );
}

export function createGoalIcon(
  updateButton: (label: string, title: string) => void,
  useSubscriptionStatus: () => GoalSubscriptionStatus,
) {
  return function GoalIcon(props: PluginButtonIconProps) {
    const status = useSubscriptionStatus();
    const { t } = useTranslation(messages);
    const unavailable = status !== "ready";
    const failureTitle = props.layout.compact ? "Goal" : t("syncFailed");
    useEffect(() => {
      if (unavailable) updateButton("Goal", failureTitle);
    }, [unavailable, failureTitle]);
    if (unavailable) {
      return <GoalPillIcon status="unavailable" />;
    }
    return props.context === "agent" ? <GoalIndicator {...props} updateButton={updateButton} /> : null;
  };
}

function GoalIndicator({
  host, agentId, layout, updateButton,
}: Extract<PluginButtonIconProps, { context: "agent" }> & {
  updateButton: (label: string, title: string) => void;
}) {
  const { state: { data, dataUpdatedAt }, readFailed } = useGoal(host.id, agentId);
  const { t, locale } = useTranslation(messages);
  const goal = data?.goal;
  const status = readFailed ? t("readFailed") : goal ? t(`status.${goal.status}`) : null;
  const { seconds } = useGoalTime(data, dataUpdatedAt, readFailed);
  const elapsed = seconds === undefined ? null : formatDuration(seconds);
  const showReadFailure = readFailed && elapsed === null;
  const label = elapsed ?? (showReadFailure ? t("pillReadFailed") : "Goal");
  const title = layout.compact ? "Goal" :
    ["Codex Goal", status, elapsed && t("elapsed", { time: elapsed })].filter(Boolean).join(" · ");
  useEffect(() => updateButton(label, title), [label, title, updateButton]);
  return (
    <GoalPillIcon
      status={readFailed ? "unavailable" : goal?.status ?? "unset"}
      chineseLabel={showReadFailure && locale.startsWith("zh")}
    />
  );
}

type SubscriptionRetry = { retrying: boolean; onRetry: () => void };

export function GoalPopover(props: PluginButtonContentProps & { sync?: SubscriptionRetry }) {
  const { width, height } = useWindowDimensions();
  const settings = useSettings(shortcutSettings);
  if (props.context !== "agent") return null;

  const bindings = Platform.OS === "web" && settings.status === "ready" ? settings.values : undefined;
  const contentWidth = props.layout.compact ? undefined : Math.min(394, Math.max(0, width - 56));
  const maxObjectiveHeight = props.layout.compact ? undefined : Math.min(300, Math.max(112, height - 168));
  return (
    <View style={{ width: contentWidth, marginTop: props.layout.compact ? -16 : undefined }}>
      {props.sync && (
        <GoalKeyboardScope bindings={bindings} actions={{ retry: props.sync.retrying ? undefined : props.sync.onRetry }}>
          <GoalSubscriptionNotice theme={props.theme} {...props.sync} shortcut={bindings?.retry} />
        </GoalKeyboardScope>
      )}
      <View style={props.sync ? { display: "none" } : undefined}>
        <GoalControls key={props.agentId} {...props} bindings={props.sync ? undefined : bindings} maxObjectiveHeight={maxObjectiveHeight} />
      </View>
    </View>
  );
}

export function GoalSubscriptionNotice({
  theme, retrying, onRetry, shortcut,
}: Pick<PluginHostProps, "theme"> & SubscriptionRetry & { shortcut?: string }) {
  const { colors } = theme;
  const { t } = useTranslation(messages);
  return (
    <View style={{ gap: 10, paddingVertical: 4 }}>
      <View style={styles.statusRow}>
        <GoalWarningIcon />
        <Text style={[styles.statusLabel, { color: colors.foreground, fontWeight: "600" }]}>{t("syncFailed")}</Text>
      </View>
      <Text accessibilityLiveRegion="polite" style={{ color: colors.foregroundMuted }}>
        {t(retrying ? "syncing" : "syncFailedDetail")}
      </Text>
      <Pressable
        {...webShortcutProps(shortcut)}
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

function GoalReadError({ theme, message }: Pick<PluginHostProps, "theme"> & { message: string }) {
  return (
    <View style={styles.statusRow}>
      <GoalWarningIcon />
      <Text accessibilityLiveRegion="polite" style={[styles.statusLabel, { color: theme.colors.foreground }]}>
        {message}
      </Text>
    </View>
  );
}

function GoalControls({
  theme, host, agentId, layout, maxObjectiveHeight, bindings,
}: Extract<PluginButtonContentProps, { context: "agent" }> & { maxObjectiveHeight?: number; bindings?: GoalShortcuts }) {
  const { state, readFailed } = useGoal(host.id, agentId);
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
  const actionProps = { theme, compact: layout.compact };
  const snapshot = state.data;
  const readError = state.error instanceof GoalError ? t(`error.${state.error.code}`) :
    readFailed ? t("error.readRequest") : null;
  const changeError = mutation.error instanceof GoalError ? t(`error.${mutation.error.code}`) :
    mutation.error ? t("error.changeRequest") : null;
  const retry = readFailed && !state.isFetching ? () => void state.refetch({ cancelRefetch: false }) : undefined;
  const retryAction = readFailed && (
    <Action {...actionProps} icon="RotateCw" label={t("action.retry")} shortcut={bindings?.retry} onPress={retry} />
  );
  if (!snapshot) {
    return (
      <GoalKeyboardScope bindings={bindings} actions={{ retry }}>
        {readError ? (
          <GoalReadError theme={theme} message={readError} />
        ) : (
          <Text style={{ color: colors.foreground }} accessibilityLiveRegion="polite">{t("loading")}</Text>
        )}
        {retryAction}
      </GoalKeyboardScope>
    );
  }

  const goal = snapshot.goal;
  const busy = mutation.isPending || readFailed;
  const editing = !confirmClear && (Boolean(draft) || !goal);
  const staleDraft = draft && !matchesExpectedGoal(snapshot, draft.base.threadId, draft.base.goal);
  const staleConfirmation = confirmClear && !matchesExpectedGoal(snapshot, confirmClear.threadId, confirmClear.goal);
  const objective = draft?.objective ?? "";
  const normalized = objective.trim();
  const invalidObjective = reservedObjectives.test(normalized);
  const actionError = staleDraft || staleConfirmation ? t("error.staleAction") :
    invalidObjective ? t("error.invalidObjective") : changeError;
  const submit = (action: GoalAction, base = snapshot) => mutation.mutate({ action, base });
  const dismiss = () => {
    setDraft(null);
    setConfirmClear(null);
    mutation.reset();
  };
  const canResume = goal && ["paused", "blocked", "usage_limited"].includes(goal.status);
  const viewing = !editing && !confirmClear;
  const save = !busy && editing && !staleDraft && normalized && !invalidObjective && normalized !== goal?.objective
    ? () => submit({ kind: "set", objective: normalized }, draft?.base) : undefined;
  const edit = !busy && viewing && goal ? () => setDraft({ objective: goal.objective, base: snapshot }) : undefined;
  const clear = !busy && viewing && goal ? () => setConfirmClear(snapshot) : undefined;
  const pauseResume = !busy && viewing && (goal?.status === "active" || canResume)
    ? () => submit({ kind: goal?.status === "active" ? "pause" : "resume" }) : undefined;
  const desktop = maxObjectiveHeight !== undefined;
  const currentText = editing ? objective : goal?.objective ?? "";
  const sizingText = currentText === "" || currentText.endsWith("\n") ? `${currentText}\u200B` : currentText;

  return (
    <GoalKeyboardScope bindings={bindings} actions={{ save, edit, clear, pauseResume, retry }}>
      <View style={{ gap: 8 }}>
        <View style={styles.statusRow}>
          <View
            aria-hidden
            style={[styles.statusTile, { backgroundColor: colors.surface1, borderColor: colors.border }]}
          >
            <GoalStatusIcon status={goal?.status ?? "unset"} size={panelStatusIconSize} />
          </View>
          <View style={styles.statusText}>
            <Text style={[styles.statusLabel, { color: colors.foreground, fontWeight: "600" }]}>{goal ? t(`status.${goal.status}`) : t("setup")}</Text>
            {goal && (
              <GoalTime theme={theme} snapshot={snapshot} receivedAt={state.dataUpdatedAt} stale={readFailed} />
            )}
          </View>
        </View>
        {goal?.status === "blocked" && (
          <Text style={{ color: colors.foregroundMuted }}>{t("blockedDetail")}</Text>
        )}
      </View>

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
            autoFocus={Platform.OS === "web" && (!layout.compact || Boolean(draft))}
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

      {readError && <GoalReadError theme={theme} message={readError} />}
      {actionError && (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.foreground }}>
          {actionError}
        </Text>
      )}

      {confirmClear && (
        <Text style={{ color: colors.foreground }}>{t("confirmClear")}</Text>
      )}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {confirmClear ? (
          <>
            <Action {...actionProps} key="confirm-clear" icon="Trash2" label={t("action.confirmClear")} destructive
              onPress={busy || staleConfirmation ? undefined : () => submit({ kind: "clear" }, confirmClear)} />
            <Action {...actionProps} key="cancel-clear" icon="X" label={t("action.cancel")} focusOnMount
              onPress={mutation.isPending ? undefined : dismiss} />
          </>
        ) : editing ? (
          <>
            <Action
              {...actionProps}
              icon={goal ? "Check" : "Play"}
              label={t(goal?.status === "active" ? "action.save" : goal ? "action.saveAndResume" : "action.start")}
              shortcut={bindings?.save}
              onPress={save}
            />
            {(goal || staleDraft) && (
              <Action {...actionProps} icon="X" label={t("action.cancel")} onPress={mutation.isPending ? undefined : dismiss} />
            )}
          </>
        ) : (
          <>
            {goal?.status === "active" && (
              <Action {...actionProps} icon="Pause" label={t("action.pause")} shortcut={bindings?.pauseResume} onPress={pauseResume} />
            )}
            {canResume && (
              <Action {...actionProps} icon="Play" label={t("action.resume")} shortcut={bindings?.pauseResume} onPress={pauseResume} />
            )}
            {goal && (
              <Action {...actionProps} icon="Pencil" label={t("action.edit")} shortcut={bindings?.edit} onPress={edit} />
            )}
            <Action {...actionProps} icon="Trash2" label={t("action.clear")} shortcut={bindings?.clear} destructive onPress={clear} />
          </>
        )}
        {retryAction}
      </View>
      {mutation.isPending && (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.foregroundMuted }}>{t("updating")}</Text>
      )}
    </GoalKeyboardScope>
  );
}

const styles = StyleSheet.create({
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  statusTile: {
    width: 36,
    height: 36,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  statusText: {
    flexShrink: 1,
    gap: 3,
  },
  statusLabel: {
    flexShrink: 1,
    includeFontPadding: false,
  },
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
    <Text style={[styles.statusLabel, { color: theme.colors.foregroundMuted, fontVariant: ["tabular-nums"] }]}>
      {t("elapsed", { time: formatDuration(seconds) })}
    </Text>
  );
}

function webShortcutProps(shortcut: string | undefined) {
  const ariaKey = shortcut === "Mod+Enter" ? "Control+Enter Meta+Enter" : shortcut;
  return Platform.OS === "web" && ariaKey ? { "aria-keyshortcuts": ariaKey } : {};
}

function Action({
  theme, compact, icon, label, destructive, onPress, shortcut, focusOnMount,
}: Pick<PluginHostProps, "theme"> & {
  compact: boolean;
  icon: string;
  label: string;
  destructive?: boolean;
  onPress?: () => void;
  shortcut?: string;
  focusOnMount?: boolean;
}) {
  const { colors } = theme;
  const { t } = useTranslation(messages);
  const [hovered, setHovered] = useState(false);
  const button = useRef<View>(null);
  const disabled = !onPress;
  const key = shortcutLabel(shortcut);
  useEffect(() => {
    if (Platform.OS === "web" && focusOnMount) button.current?.focus();
  }, [focusOnMount]);
  const height = compact ? 44 : 36;
  return (
    <View style={{ position: "relative", zIndex: hovered ? 1 : 0 }}>
      <Pressable
        ref={button}
        {...webShortcutProps(shortcut)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        style={({ pressed }) => ({
          width: compact ? 44 : 40,
          height,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: hovered || pressed ? colors.surface2 : colors.surface1,
          opacity: disabled ? 0.55 : 1,
        })}
      >
        <Icon name={icon} size={20} color={destructive ? colors.statusDanger : colors.foreground} />
      </Pressable>
      {hovered && (
        <View
          pointerEvents="none"
          aria-hidden
          style={{
            position: "absolute",
            bottom: height + 4,
            left: 0,
            paddingHorizontal: 8,
            paddingVertical: 5,
            borderRadius: 5,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface2,
          }}
        >
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12 }}>
            {key ? t("shortcutHint", { action: label, key }) : label}
          </Text>
        </View>
      )}
    </View>
  );
}
