import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const panelKeys = ["", "Delete", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
export const saveKeys = ["", "Enter", "Mod+Enter"] as const;

const panelKey = z.string().refine((key) => panelKeys.includes(key));

export const commandShortcuts = ["edit", "pauseResume", "clear", "retry"] as const;
export type CommandShortcut = typeof commandShortcuts[number];

export const shortcutSettings = defineSettings({
  id: "shortcuts",
  scope: "host",
  version: 1,
  schema: z.object({
    save: z.enum(saveKeys).default("Enter"),
    edit: panelKey.default("E"),
    pauseResume: panelKey.default("P"),
    clear: panelKey.default("Delete"),
    retry: panelKey.default("R"),
  }).refine((values) => {
    const assigned = commandShortcuts.map((action) => values[action]).filter(Boolean);
    return new Set(assigned).size === assigned.length;
  }),
});

export type GoalShortcuts = z.output<typeof shortcutSettings.schema>;
