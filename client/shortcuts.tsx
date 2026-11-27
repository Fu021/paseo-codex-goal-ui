import { type KeyboardEvent, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { Platform, Text, View } from "react-native";
import { type PluginSurfaceProps, useSettings, useTranslation } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { commandShortcuts, type GoalShortcuts, panelKeys, saveKeys, shortcutSettings } from "../shared/shortcuts";
import { messages } from "./messages";

type ShortcutAction = keyof GoalShortcuts;

export function shortcutLabel(key: string | undefined) {
  return key === "Mod+Enter" ? "Ctrl/⌘+Enter" : key || undefined;
}

export function ShortcutSettings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(shortcutSettings);
  const { t } = useTranslation(messages);
  const [resetFailed, setResetFailed] = useState(false);
  const option = <Key extends string,>(key: Key) => ({ value: key, label: shortcutLabel(key) ?? t("shortcuts.none") });
  const errorStyle = { color: theme.colors.foreground };
  const reset = async () => {
    setResetFailed(false);
    setResetFailed(!await settings.reset());
  };
  return (
    <SettingsSection title={t("shortcuts.title")}>
      <Text style={{ color: theme.colors.foregroundMuted }}>{t("shortcuts.detail")}</Text>
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
          {commandShortcuts.map((action) => (
            <SettingsSelect
              key={action}
              label={t(`shortcuts.${action}`)}
              value={settings.values[action]}
              options={panelKeys.filter((key) => !key || !commandShortcuts.some(
                (other) => other !== action && settings.values[other] === key,
              )).map(option)}
              disabled={settings.saving}
              onValueChange={(key) => {
                setResetFailed(false);
                void settings.save({ ...settings.values, [action]: key }, settings.revision);
              }}
            />
          ))}
        </SettingsCard>
      ) : (
        <Text accessibilityLiveRegion="polite" style={errorStyle}>
          {t(settings.status === "loading" ? "shortcuts.loading" : "shortcuts.loadFailed")}
        </Text>
      )}
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
