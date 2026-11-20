import assert from "node:assert/strict";
import { once } from "node:events";
import { Readable } from "node:stream";
import test from "node:test";
import mongoose from "mongoose";
import { createApp } from "../src/app.js";
import { Admin } from "../src/models/admin.model.js";
import { Attempt } from "../src/models/attempt.model.js";
import { generateAdminJwt } from "../src/utils/generateJwt.js";
import { csvCell } from "../src/utils/resultHelpers.js";
import { listResultsSchema, exportResultsSchema } from "../src/validations/results.validation.js";

const quiz = new mongoose.Types.ObjectId();
const otherQuiz = new mongoose.Types.ObjectId();
const admin = {
  _id: new mongoose.Types.ObjectId(),
  email: "admin@example.com",
  sessionVersion: 0,
};
const origin = "http://localhost:5173";
const secret = "admin-results-test-secret-which-is-long-enough-123";

const rows = Array.from({ length: 1505 }, (_, i) => ({
  _id: new mongoose.Types.ObjectId((i + 1).toString(16).padStart(24, "0")),
  quiz: quiz,
  email: "student" + String(i + 1).padStart(5, "0") + "@example.test",
  phone: "+923001234567",
  violationCount: 0,
  studentName: i === 0 ? '=HYPERLINK("http://example.com")' : "Student " + (i + 1),
  status: i % 8 === 0 ? "started" : "submitted",
  startedAt: new Date("2026-11-20T09:00:00Z"),
  expiresAt: i % 8 === 0 ? new Date(Date.now() - 60_000) : new Date(Date.now() + 60_000),
  submittedAt: i % 8 === 0 ? null : new Date("2026-11-20T09:30:00Z"),
  score: 7,
  maxScore: 10,
  gradingStatus: i % 8 === 0 ? "ungraded" : "graded",
  pendingReviewCount: 0,
  answeredCount: 7,
  unansweredCount: 3,
  answers: [{ answer: "SECRET_PRIVATE_ANSWER" }],
  startKeyHash: "PRIVATE_START_KEY",
  manualGrades: { "private-question": 2 },
}));

function fakeMatch(filter, row) {
  if (filter.quiz && String(filter.quiz) !== String(row.quiz)) return false;
  if (filter.status && filter.status !== row.status) return false;
  if (filter.gradingStatus && filter.gradingStatus !== row.gradingStatus) return false;
  if (filter.email && filter.email !== row.email) return false;
  if (filter._id?.$lt && !(String(row._id) < String(filter._id.$lt))) return false;
  return true;
}

function limitedQuery(data) {
  let limit;
  return {
    select() { return this; },
    sort() { return this; },
    limit(n) { limit = n; return this; },
    lean() { return this; },
    then(resolve, reject) { return Promise.resolve(limit ? data.slice(0, limit) : data).then(resolve, reject); },
    cursor() { return Readable.from(data); },
  };
}

async function withMockDb(callback) {
  const originalFind = Attempt.find;
  const originalAggregate = Attempt.aggregate;
  const originalAdmin = Admin.findById;
  let lastFilter = null;
  let lastMatch = null;
  let lastLimit = null;

  Attempt.find = (filter) => {
    lastFilter = filter;
    const matched = rows.filter((row) => fakeMatch(filter, row)).sort((a,b) =>
      String(b._id).localeCompare(String(a._id))
    );
    const query = limitedQuery(matched);
    const originalLimit = query.limit;
    query.limit = function(n) { lastLimit = n; return originalLimit.call(this,n); };
    return query;
  };
  Attempt.aggregate = async (stages) => {
    lastMatch = stages[0].$match;
    const docs = rows.filter((row) => fakeMatch(lastMatch, row));
    return docs.length ? [{
      _id: null,
      totalAttempts: docs.length,
      inProgress: docs.filter((r) => r.status === "started" && r.expiresAt > new Date()).length,
      expiredPendingFinalization: docs.filter((r) => r.status === "started" && r.expiresAt <= new Date()).length,
      submitted: docs.filter((r) => r.status === "submitted").length,
      terminated: 0,
      pendingManualReview: 0,
      graded: docs.filter((r) => r.status === "submitted" && r.gradingStatus === "graded").length,
    }] : [];
  };
  Admin.findById = () => ({ select: async () => admin });

  try {
    await callback({
      lastFilter: () => lastFilter,
      lastMatch: () => lastMatch,
      lastLimit: () => lastLimit,
    });
  } finally {
    Attempt.find = originalFind;
    Attempt.aggregate = originalAggregate;
    Admin.findById = originalAdmin;
  }
}

async function withServer(callback) {
  const server = createApp({
    allowedOrigins: [origin], jwtSecret: secret,
    nodeEnv: "test", cookieSameSite: "lax", isDbReady: () => true,
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const cookie = "quiz_hub_admin=" + generateAdminJwt(admin, secret);
  try {
    await callback("http://127.0.0.1:" + server.address().port, cookie);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("results APIs reject requests without admin credentials", async () => {
  await withServer(async (base) => {
    for (const url of [
      "/api/v1/admin/results?quizId=" + quiz,
      "/api/v1/admin/results/stats?quizId=" + quiz,
      "/api/v1/admin/results/export?quizId=" + quiz,
    ]) {
      const res = await fetch(base + url);
      assert.equal(res.status, 401);
    }
  });
});

test("query validation rejects malformed cursor and email", () => {
  assert.ok(listResultsSchema.validate({ quizId: String(quiz), cursor: "invalid" }).error);
  assert.ok(listResultsSchema.validate({ quizId: String(quiz), email: "invalid-email" }).error);
  assert.ok(listResultsSchema.validate({ quizId: String(quiz), limit: 101 }).error);
  assert.ok(exportResultsSchema.validate({ quizId: String(quiz), cursor: String(quiz) }).error);
});

test("pagination fetches only a bounded page; cursor gives unique records", async () => {
  await withMockDb(async (db) => withServer(async (base, cookie) => {
    const get = (params) => fetch(base + "/api/v1/admin/results?" + params, { headers: { Cookie: cookie } });
    const first = await get("quizId=" + quiz + "&limit=25");
    assert.equal(first.status, 200);
    const one = (await first.json()).data;
    assert.equal(one.items.length, 25);
    assert.equal(one.hasMore, true);
    assert.equal(db.lastLimit(), 26);
    assert.ok(one.nextCursor);
    assert.equal(one.items[0].email, "student01505@example.test");
    assert.ok(!("answers" in one.items[0]));
    assert.ok(!("startKeyHash" in one.items[0]));
    assert.ok(!("manualGrades" in one.items[0]));

    const next = await get("quizId=" + quiz + "&limit=25&cursor=" + one.nextCursor);
    const two = (await next.json()).data;
    assert.equal(two.items.length, 25);
    assert.notEqual(one.items.at(-1).id, two.items[0].id);
    const all = new Set([...one.items, ...two.items].map(r=>r.id));
    assert.equal(all.size, 50);
  }));
});

test("email and status filters apply to MongoDB, not just current page", async () => {
  await withMockDb(async (db) => withServer(async (base, cookie) => {
    const res = await fetch(base + "/api/v1/admin/results?quizId=" + quiz +
      "&email=student00001@example.test&status=started", { headers: { Cookie: cookie } });
    assert.equal(res.status, 200);
    const result = (await res.json()).data;
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].email, "student00001@example.test");
    assert.equal(db.lastFilter().status, "started");
    assert.equal(db.lastFilter().email, "student00001@example.test");
    assert.equal(result.hasMore, false);
  }));
});

test("dashboard stats count all attempts, including unfinalized expirations", async () => {
  await withMockDb(async (db) => withServer(async (base, cookie) => {
    const r = await fetch(base + "/api/v1/admin/results/stats?quizId=" + quiz, { headers: { Cookie: cookie } });
    assert.equal(r.status, 200);
    const stats = (await r.json()).data;
    assert.equal(stats.totalAttempts, 1505);
    assert.ok(stats.expiredPendingFinalization > 0);
    assert.equal(stats.submitted + stats.expiredPendingFinalization, stats.totalAttempts);
    assert.equal(String(db.lastMatch().quiz), String(quiz));
  }));
});

test("CSV exports ALL 1505 attempts, escapes formula cells, no answers", async () => {
  await withMockDb(async () => withServer(async (base, cookie) => {
    const r = await fetch(base + "/api/v1/admin/results/export?quizId=" + quiz,
      { headers: { Cookie: cookie } });
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-disposition"), /attachment/);
    assert.match(r.headers.get("content-type"), /text\/csv/);
    const csv = await r.text();
    assert.equal(csv.trimEnd().split("\r\n").length, 1506);
    assert.ok(csv.includes("'=HYPERLINK"));
    assert.ok(!csv.includes("SECRET_PRIVATE_ANSWER"));
    assert.ok(!csv.includes("PRIVATE_START_KEY"));
    assert.ok(!csv.includes("private-question"));
  }));
});

test("CSV field quoting protects commas, newlines, quotes and formula prefixes", () => {
  assert.equal(csvCell('a,b"c'), '"a,b""c"');
  assert.equal(csvCell('=SUM(1,2)'), '"\'=SUM(1,2)"');
  assert.equal(csvCell(' -1+1'), '"\' -1+1"');
  assert.equal(csvCell(null), '""');
});

test("empty result query returns no next cursor and no records", async () => {
  await withMockDb(async () => withServer(async (base, cookie) => {
    const r = await fetch(base + "/api/v1/admin/results?quizId=" + otherQuiz, { headers: { Cookie: cookie } });
    const result = (await r.json()).data;
    assert.deepEqual(result.items, []);
    assert.equal(result.nextCursor, null);
    assert.equal(result.hasMore, false);
  }));
});
