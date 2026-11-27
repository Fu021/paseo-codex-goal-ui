import { type KeyboardEvent, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { type PluginSurfaceProps, useSettings, useTranslation } from "@getpaseo/plugin/client";
import { Modal, SettingsAction, SettingsCard, SettingsRow, SettingsSection, SettingsSelect, TextInput } from "@getpaseo/plugin/client/ui";
import { commandShortcuts, type CommandShortcut, type GoalShortcuts, saveKeys, shortcutSettings } from "../shared/shortcuts";
import { messages } from "./messages";

type ShortcutAction = keyof GoalShortcuts;

export function shortcutLabel(key: string | undefined) {
  return key === "Mod+Enter" ? "Ctrl/⌘+Enter" : key || undefined;
}

function ShortcutKeyButton({
  theme, label, accessibilityLabel, disabled, onPress,
}: Pick<PluginSurfaceProps, "theme"> & {
  label: string;
  accessibilityLabel?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { colors } = theme;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center", justifyContent: "center", minWidth: 44, minHeight: 44,
        paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border,
        backgroundColor: pressed ? colors.surface2 : colors.surface1, opacity: disabled ? 0.55 : 1,
      })}
    >
      <Text style={{ color: colors.foreground }}>{label}</Text>
    </Pressable>
  );
}

export function ShortcutSettings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(shortcutSettings);
  const { t } = useTranslation(messages);
  const [resetFailed, setResetFailed] = useState(false);
  const [editing, setEditing] = useState<CommandShortcut | null>(null);
  const [keyError, setKeyError] = useState<CommandShortcut | "invalid" | null>(null);
  const option = <Key extends string,>(key: Key) => ({ value: key, label: shortcutLabel(key) ?? t("shortcuts.none") });
  const { colors } = theme;
  const errorStyle = { color: colors.foreground };
  const reset = async () => {
    setResetFailed(false);
    setResetFailed(!await settings.reset());
  };
  function assign(key: string) {
    if (!editing || settings.status !== "ready" || settings.saving) return;
    const { values, revision } = settings;
    const conflict = key && commandShortcuts.find((action) => action !== editing && values[action] === key);
    if (conflict) {
      setKeyError(conflict);
      return;
    }
    setEditing(null);
    if (values[editing] !== key) {
      setResetFailed(false);
      void settings.save({ ...values, [editing]: key }, revision);
    }
  }
  function enterKey(text: string) {
    if (!text) return;
    if (/^[a-z]$/i.test(text)) assign(text.toUpperCase());
    else setKeyError("invalid");
  }

  return (
    <SettingsSection title={t("shortcuts.title")}>
      <Text style={{ color: colors.foregroundMuted }}>{t("shortcuts.detail")}</Text>
      {settings.status === "ready" ? (
        <SettingsCard>
          <SettingsSelect
            label={t("shortcuts.save")}
            hint={t("shortcuts.saveHint")}
            value={settings.values.save}
            options={saveKeys.map(option)}
            disabled={settings.saving}
            onValueChange={(save) => {
              setResetFailed(false);
              void settings.save({ ...settings.values, save }, settings.revision);
            }}
          />
          {commandShortcuts.map((action) => {
            const label = t(`shortcuts.${action}`);
            const keyLabel = option(settings.values[action]).label;
            return (
              <SettingsRow key={action} label={label}>
                <ShortcutKeyButton
                  theme={theme}
                  label={keyLabel}
                  accessibilityLabel={`${label}: ${keyLabel}`}
                  disabled={settings.saving}
                  onPress={() => {
                    setKeyError(null);
                    setEditing(action);
                  }}
                />
              </SettingsRow>
            );
          })}
        </SettingsCard>
      ) : (
        <Text accessibilityLiveRegion="polite" style={errorStyle}>
          {t(settings.status === "loading" ? "shortcuts.loading" : "shortcuts.loadFailed")}
        </Text>
      )}
      <Modal title={editing ? t(`shortcuts.${editing}`) : t("shortcuts.title")} open={editing !== null}
        onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <Modal.Content contentContainerStyle={{ gap: 12 }}>
          <Text style={{ color: colors.foregroundMuted }}>{t("shortcuts.assignHint")}</Text>
          <TextInput
            accessibilityLabel={t("shortcuts.letter")}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            onChangeText={enterKey}
            placeholder="A–Z"
            placeholderTextColor={colors.foregroundMuted}
            value=""
            style={{
              alignSelf: "flex-start", minWidth: 80, minHeight: 44, paddingHorizontal: 12,
              borderRadius: 8, borderWidth: 1, borderColor: colors.border, color: colors.foreground,
            }}
          />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {["Delete", ""].map((key) => (
              <ShortcutKeyButton key={key} theme={theme} label={option(key).label} onPress={() => assign(key)} />
            ))}
          </View>
          {keyError && (
            <Text accessibilityRole="alert" style={errorStyle}>
              {keyError === "invalid" ? t("shortcuts.invalidKey") :
                t("shortcuts.keyConflict", { action: t(`shortcuts.${keyError}`) })}
            </Text>
          )}
        </Modal.Content>
      </Modal>
      {(settings.saveError || resetFailed) && (
        <Text accessibilityRole="alert" style={errorStyle}>{t("shortcuts.saveFailed")}</Text>
      )}
      {(settings.status === "error" || settings.status === "invalid" || settings.saveError) && (
        <SettingsAction label={t("shortcuts.reload")} actionLabel={t("action.retry")} disabled={settings.saving}
          onPress={() => { setResetFailed(false); void settings.reload(); }} />
      )}
      {(settings.status === "ready" || settings.status === "invalid") && (
        <SettingsAction label={t("shortcuts.reset")} actionLabel={t("shortcuts.resetAction")} disabled={settings.saving}
          onPress={() => void reset()} />
      )}
    </SettingsSection>
  );
}

export function matchShortcut(event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "nativeEvent">,
  bindings: GoalShortcuts, inEditor: boolean): ShortcutAction | undefined {
  if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.altKey) return;
  const modified = event.ctrlKey || event.metaKey;
  if (inEditor) {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (modified && event.ctrlKey === event.metaKey) return;
    if (bindings.save === (modified ? "Mod+Enter" : "Enter")) return "save";
    return;
  }
  if (modified || event.shiftKey) return;
  const key = /^[a-z]$/i.test(event.key) ? event.key.toUpperCase() : event.key;
  return commandShortcuts.find((action) => bindings[action] !== "" && bindings[action] === key);
}

export function GoalKeyboardScope({
  bindings, actions, children,
}: {
  bindings?: GoalShortcuts;
  actions: Partial<Record<ShortcutAction, () => void>>;
  children: ReactNode;
}) {
  const scope = useRef<View>(null);
  const initializedFocus = useRef(false);
  const lastFocused = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (Platform.OS !== "web" || !(scope.current instanceof HTMLElement)) return;
    const panel = scope.current;
    if (panel.getClientRects().length === 0) return;
    const previous = lastFocused.current;
    const lostFocus = previous && document.activeElement === document.body &&
      (!panel.contains(previous) || previous.matches(":disabled"));
    if ((!initializedFocus.current || lostFocus) && !panel.contains(document.activeElement)) {
      panel.focus({ preventScroll: true });
    }
    initializedFocus.current = true;
  });

  function onKeyDownCapture(event: KeyboardEvent<HTMLElement>) {
    if (!bindings || event.defaultPrevented || !(event.target instanceof HTMLElement)) return;
    if (!event.currentTarget.contains(document.activeElement) || !event.currentTarget.contains(event.target)) return;
    const input = event.target.closest("textarea,input,[contenteditable]:not([contenteditable='false'])");
    if (input && !(input instanceof HTMLTextAreaElement)) return;
    const action = matchShortcut(event, bindings, Boolean(input));
    if (!action || (action !== "save" && !actions[action])) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) actions[action]?.();
  }

  function onFocus(event: { target: unknown }) {
    if (event.target instanceof HTMLElement) lastFocused.current = event.target;
  }

  const webProps = Platform.OS === "web" ? { tabIndex: 0 as const, onFocus, onKeyDownCapture } : {};
  return <View ref={scope} {...webProps} style={{ gap: 12 }}>{children}</View>;
}
