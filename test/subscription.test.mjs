import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import { loadTypeScript } from "./load-typescript.mjs";

const require = createRequire(import.meta.url);
const clientEntry = require.resolve("@getpaseo/client");
const { OwnedSubscriptions } = createRequire(clientEntry)("./connection/owned.js");
const primary = { id: "primary", provider: "codex", workspaceId: "workspace" };
const secondary = { ...primary, id: "secondary" };

function startPlugin(context, responses) {
  const timers = new Map();
  const pills = new Map();
  const owner = new OwnedSubscriptions({ async release() {}, failed() {} });
  context.after(() => owner.close());
  let requests = 0;
  let registrations = 0;
  let subscriptionId;
  const { default: contribute } = loadTypeScript(new URL("../index.client.tsx", import.meta.url), {
    modules: {
      "@getpaseo/plugin/client": {},
      "./client/goal": { createGoalIcon: () => () => null },
      "./client/shortcuts": { ShortcutSettings: () => null },
    },
    globals: {
      console: { warn() {} },
      setTimeout(callback, delay) {
        const token = Symbol();
        timers.set(token, { callback, delay });
        return token;
      },
      clearTimeout(token) { timers.delete(token); },
    },
  });
  owner.restore();
  const stop = contribute({
    addComposerItem() { return () => {}; },
    addSettingsScreen() { return () => {}; },
    addComposerPill({ agentId, workspaceId }) {
      assert.ok(!pills.has(agentId));
      registrations++;
      pills.set(agentId, workspaceId);
      return { update() {}, remove() { pills.delete(agentId); } };
    },
    paseo: {
      agents: {
        async list({ signal }) {
          const subscription = owner.observe(async (accept) => {
            requests++;
            const response = responses.shift();
            if (response instanceof Error) throw response;
            assert.ok(response, "Expected a subscription response");
            subscriptionId = `subscription-${requests}`;
            const snapshot = { subscriptionId, entries: response.map((agent) => ({ agent })) };
            accept(snapshot);
            return snapshot;
          }, signal);
          return { ...(await subscription.ready), subscription };
        },
      },
    },
  });

  return {
    pills,
    timers,
    stop,
    get requests() { return requests; },
    get registrations() { return registrations; },
    async advance(expectedDelay) {
      assert.equal(timers.size, 1);
      const [token, timer] = timers.entries().next().value;
      assert.equal(timer.delay, expectedDelay);
      timers.delete(token);
      timer.callback();
      await setImmediate();
    },
    async reconnect() {
      owner.disconnected();
      owner.restore();
      await setImmediate();
    },
    send(agent, kind) {
      owner.receive({ type: "agent_update", payload: { subscriptionId, kind, agent, agentId: agent.id } });
    },
  };
}

test("recovers composer pills after the initial subscription fails", async (context) => {
  const plugin = startPlugin(context, [new Error("Offline"), new Error("Still offline"), [primary]]);
  await setImmediate();
  assert.equal(plugin.pills.size, 0);
  await plugin.advance(1_000);
  assert.equal(plugin.pills.size, 0);
  await plugin.advance(2_000);
  assert.deepEqual([...plugin.pills.keys()], ["primary"]);
  assert.equal(plugin.timers.size, 0);
  plugin.stop();
});

test("reconciles pills on reconnect and clears pending retries on teardown", async (context) => {
  const plugin = startPlugin(context, [
    [primary, secondary], [primary], new Error("Reconnect failed"), [primary], new Error("Offline again"),
  ]);
  await setImmediate();
  assert.deepEqual([...plugin.pills.keys()], ["primary", "secondary"]);

  await plugin.reconnect();
  assert.deepEqual([...plugin.pills.keys()], ["primary"]);
  assert.equal(plugin.registrations, 2);

  await plugin.reconnect();
  await plugin.advance(1_000);
  assert.equal(plugin.timers.size, 0);
  plugin.send(secondary, "upsert");
  assert.deepEqual([...plugin.pills.keys()], ["primary", "secondary"]);
  plugin.send(secondary, "delete");
  assert.deepEqual([...plugin.pills.keys()], ["primary"]);

  await plugin.reconnect();
  assert.equal(plugin.timers.size, 1);
  assert.equal(plugin.requests, 5);
  plugin.stop();
  assert.equal(plugin.timers.size, 0);
  assert.equal(plugin.pills.size, 0);
});
