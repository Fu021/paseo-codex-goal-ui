import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTypeScript } from "./load-typescript.mjs";

const shared = loadTypeScript(new URL("../shared/shortcuts.ts", import.meta.url));
const { shortcutSettings } = shared;
const { matchShortcut } = loadTypeScript(new URL("../client/shortcuts.tsx", import.meta.url), {
  modules: {
    "react-native": {},
    "@getpaseo/plugin/client": {},
    "@getpaseo/plugin/client/ui": {},
    "../shared/shortcuts": shared,
    "./messages": {},
  },
});
const defaults = shortcutSettings.schema.parse({});
const event = (key, options = {}) => ({
  key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, nativeEvent: {}, ...options,
});

test("shortcut settings default, persist blank values, and reject duplicate assignments", () => {
  assert.deepEqual(defaults, { save: "Enter", edit: "E", pauseResume: "P", clear: "Delete", retry: "R" });
  const disabled = { save: "", edit: "", pauseResume: "", clear: "", retry: "" };
  assert.deepEqual(shortcutSettings.schema.parse(disabled), disabled);
  assert.equal(shortcutSettings.schema.safeParse({ clear: "E" }).success, false);
  assert.equal(shortcutSettings.schema.safeParse({ clear: "Backspace" }).success, false);
});

test("goal editor handles only the configured submit chord outside IME composition", () => {
  const modified = { ...defaults, save: "Mod+Enter" };
  assert.equal(matchShortcut(event("Enter"), defaults, true), "save");
  assert.equal(matchShortcut(event("Enter", { shiftKey: true }), defaults, true), undefined);
  assert.equal(matchShortcut(event("Enter", { nativeEvent: { isComposing: true } }), defaults, true), undefined);
  assert.equal(matchShortcut(event("Enter", { nativeEvent: { keyCode: 229 } }), defaults, true), undefined);
  assert.equal(matchShortcut(event("Enter"), { ...defaults, save: "" }, true), undefined);
  assert.equal(matchShortcut(event("Enter", { ctrlKey: true }), modified, true), "save");
  assert.equal(matchShortcut(event("Enter", { metaKey: true }), modified, true), "save");
  assert.equal(matchShortcut(event("Enter", { ctrlKey: true, altKey: true }), modified, true), undefined);
  assert.equal(matchShortcut(event("Enter"), modified, true), undefined);
  assert.equal(matchShortcut(event("Delete"), defaults, true), undefined);
});

test("panel commands accept reassignment and leave host chords and Esc alone", () => {
  const custom = { ...defaults, edit: "K", clear: "" };
  assert.equal(matchShortcut(event("Delete"), defaults, false), "clear");
  assert.equal(matchShortcut(event("e"), defaults, false), "edit");
  assert.equal(matchShortcut(event("p"), defaults, false), "pauseResume");
  assert.equal(matchShortcut(event("r"), defaults, false), "retry");
  assert.equal(matchShortcut(event("e"), custom, false), undefined);
  assert.equal(matchShortcut(event("k"), custom, false), "edit");
  assert.equal(matchShortcut(event("k", { metaKey: true }), custom, false), undefined);
  assert.equal(matchShortcut(event("r", { ctrlKey: true }), custom, false), undefined);
  assert.equal(matchShortcut(event("Delete"), custom, false), undefined);
  assert.equal(matchShortcut(event("Escape"), defaults, false), undefined);
});
