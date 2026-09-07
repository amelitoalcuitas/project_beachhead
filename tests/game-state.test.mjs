import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSessionState,
  isActive,
  isCombat,
} from "../src/game/game-state.ts";

test("createSessionState starts on title screen", () => {
  const session = createSessionState();
  assert.equal(session.state, "title");
  assert.equal(session.playerHp, 1000);
  assert.equal(session.wave, 1);
});

test("isActive covers combat and intermission only", () => {
  const session = createSessionState();
  session.state = "combat";
  assert.equal(isActive(session), true);
  session.state = "intermission";
  assert.equal(isActive(session), true);
  session.state = "paused";
  assert.equal(isActive(session), false);
  session.state = "title";
  assert.equal(isActive(session), false);
});

test("isCombat is narrower than isActive", () => {
  const session = createSessionState();
  session.state = "combat";
  assert.equal(isCombat(session), true);
  session.state = "intermission";
  assert.equal(isCombat(session), false);
});
