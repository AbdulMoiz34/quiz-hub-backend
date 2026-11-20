import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createApp } from "../src/app.js";
import { createSlotSchema, updateSlotSchema } from "../src/validations/slot.validation.js";

const quizId = "507f1f77bcf86cd799439011";
const future = new Date(Date.now() + 86_400_000);
const later = new Date(Date.now() + 2 * 86_400_000);
const slot = {
  quizId, name: "Morning batch", startsAt: future.toISOString(),
  endsAt: later.toISOString(), capacity: 250,
};

test("validates a future slot with capacity", () => {
  const { error, value } = createSlotSchema.validate(slot);
  assert.equal(error, undefined);
  assert.equal(value.name, "Morning batch");
  assert.equal(value.capacity, 250);
});

test("rejects slots ending before they start", () => {
  const { error } = createSlotSchema.validate({
    ...slot, endsAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  assert.ok(error);
});

test("rejects invalid capacity and quiz IDs", () => {
  assert.ok(createSlotSchema.validate({ ...slot, capacity: 0 }).error);
  assert.ok(createSlotSchema.validate({ ...slot, capacity: 501 }).error);
  assert.ok(createSlotSchema.validate({ ...slot, quizId: "not-an-id" }).error);
});

test("rejects empty edits and invalid time intervals", () => {
  assert.ok(updateSlotSchema.validate({}).error);
  assert.ok(updateSlotSchema.validate({
    startsAt: later.toISOString(), endsAt: future.toISOString(),
  }).error);
});

test("slot APIs require admin authentication", async () => {
  const app = createApp({
    allowedOrigins: ["http://localhost:5173"],
    jwtSecret: "test-secret-with-over-32-characters-and-entropy",
    nodeEnv: "test", cookieSameSite: "lax", isDbReady: () => true,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const base = "http://127.0.0.1:" + server.address().port;
    const list = await fetch(base + "/api/v1/admin/slots?quizId=" + quizId);
    assert.equal(list.status, 401);

    const create = await fetch(base + "/api/v1/admin/slots", {
      method: "POST",
      headers: { Origin: "http://localhost:5173", "Content-Type": "application/json" },
      body: JSON.stringify(slot),
    });
    assert.equal(create.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
