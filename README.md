# Quiz Hub Backend

Node.js 22+ · Express 5 · MongoDB Atlas. Simple modular monolith without Redis, slots, or per-question timers.

## Product behavior

- Admin creates quizzes and publishes them. Published quizzes are available at any time; no schedules or capacity seats.
- Student enters full name, email and phone, selects a quiz, then starts. One attempt **per normalized email per quiz**, enforced by MongoDB's unique index. No roll numbers or account signup.
- A single quiz-wide deadline starts when the attempt begins (`durationMinutes`; e.g. 60 minutes). The server enforces `expiresAt`. Question time limits do not exist.
- Student answers are versioned and autosaved. Refresh or reconnect can restore the current attempt with its signed cookie. Final submission is idempotent and server-graded for MCQ/True-False; coding/short text is reviewed by admin.
- The browser may report `tab_hidden`, `window_blur`, and `fullscreen_exit` through an authenticated endpoint. The server counts unique event IDs and terminates the attempt at `maxViolations` (default 3). These are **client-reported events**, not proof of cheating; a modified browser can suppress them.
- Admin can **permanently delete an attempt**, including submitted/expired/terminated ones, to release the email key so the candidate can reattempt. This destroys its answers and result and immediately invalidates the old attempt cookie.

## Setup and migration

1. Install Node.js 22+, `npm install`; set up `.env` from `.env.example` (MongoDB URI, exact CORS origins, JWT secret and admin credentials). Rotate any exposed Atlas secrets.
2. **Before switching an existing database to this release**, finish all active slot-based attempts and take a verified MongoDB backup. Legacy attempts without email are preserved for historical access.
3. First run `npm run db:migrate:check` to inspect the actual target database. After confirming a verified backup, run `npm run db:migrate -- --expect-db=YOUR_DATABASE_NAME` with the production environment. It first creates the unique `{quiz:1,email:1}` partial index, then drops the obsolete roll/seat indexes. It **refuses** if any old attempt lacking email is currently active. The old `slots` collection is left in MongoDB, untouched.
4. Deploy the new backend and compatible frontend together (the old frontend roll/slot API payload will be rejected). The only startup entry point is `src/server.js`: use `npm run dev` or `npm start`. Verify `npm test` and `npm run db:check`.
5. Configure a periodic one-shot `npm run attempts:finalize` to finalize expired unsent attempts from their last persisted drafts. No background worker is installed.

**Critical production release gate:** `npm run db:migrate:check` must report
`readyForNewStudents: true` before opening registration. A leftover
`quiz_1_rollNo_1` unique index can reject **every new email-based candidate**
with `Unable to reserve attempt`. MongoDB treats missing `rollNo` values as
null. A green load test on a clean test database does **not** detect old indexes
remaining on the production Atlas database.

The API now refuses startup if a conflicting unique attempt index exists or if
the required partial `{quiz:1,email:1}` unique index is missing. This prevents
a false "ready" state while real candidates cannot start.

If the read-only check reports unsafe indexes, **pause new registrations**.
Finish any active legacy attempts and take a **verified database backup**. Then
run `npm run db:migrate -- --expect-db=YOUR_EXACT_DATABASE_NAME` on EC2
with its production environment; the migration creates/verifies the email
constraint before dropping only the known obsolete indexes and refuses unknown
unique constraints. Rerun `npm run db:migrate:check` and confirm
`readyForNewStudents: true` before restarting PM2. Do not delete attempts or
run test scripts against production. Never drop unknown unique indexes blindly.

## Run on EC2 with PM2 (no CI/CD)

After configuring `.env`, connecting Atlas, and verifying any required index migration:

```bash
npm install --omit=dev
npm run db:check
pm2 start src/server.js --name quiz-hub-api --time
pm2 logs quiz-hub-api --lines 30
curl -i http://127.0.0.1:5000/api/v1/ready
```

Run `pm2 startup`, execute the command it prints, and run `pm2 save` to restore the service after reboot. Keep `HOST=127.0.0.1` and proxy through Nginx (ports 80/443); do not expose port 5000 publicly.

Older deployments using `pm2 start src/app.js` **must delete that PM2 process** and start `src/server.js` instead. `src/app.js` only defines the Express app so tests can import it without starting a server.

## Student API

Prefix: `/api/v1/student`. Credentials/cookies are required for existing attempts; write calls must originate from an allowed origin.

| Endpoint | Purpose |
| --- | --- |
| `GET /quizzes` | List published quizzes |
| `POST /attempts/start` | Body: `quizId, studentName, email, phone, startKey` |
| `GET /attempts/current` | Load current questions, deadline, server time, saved draft, violation count |
| `PUT /attempts/draft` | Versioned answer snapshot: `{ version, answers: [{questionId, answer}] }` |
| `POST /attempts/submit` | Final answer snapshot: `{ version, answers, reason: "student" }` |
| `POST /attempts/violations` | Body: `{ eventId: UUIDv4, type: "tab_hidden" | "window_blur" | "fullscreen_exit" }` |

The browser must generate and persist one UUIDv4 `startKey` for retrying the same start request, and a new UUIDv4 `eventId` for each observable violation. Retries of the same violation use the **same** eventId. Reusing an email with a different startKey returns HTTP 409, even if the prior attempt was completed. `X-Expected-Attempt-Id` on draft/submit/violation writes helps prevent a stale tab using a different attempt cookie.

When the timer expires, late changes are rejected and only saved answers are eligible for expiry finalization. If violation threshold is reached, status becomes `terminated`, questions and writes are blocked, and the attempt is not scored as a normal submission.

## Admin API

All endpoints use the admin cookie.

- `POST /api/v1/admin/quizzes` · `GET /api/v1/admin/quizzes` · `PUT /api/v1/admin/quizzes/:id` · `PATCH /api/v1/admin/quizzes/:id/publish`: manage/publish quiz.
- `GET /api/v1/admin/results?quizId=<id>&limit=25`: paginated results, cursor pagination. Optional exact `email`, `status`, `gradingStatus` filters.
- `GET /api/v1/admin/results/stats?quizId=<id>`: live attempt counts.
- `GET /api/v1/admin/results/export?quizId=<id>`: streamed CSV of all matching results, spreadsheet-formula safe.
- `GET /api/v1/admin/attempts/:id`: attempt details including violations and saved answers.
- `PATCH /api/v1/admin/attempts/:id/grade`: manual grades on submitted short-text/coding responses.
- `DELETE /api/v1/admin/attempts/:id`: **destructive** reset; requires a confirmation UI. Allows same email to start again.

No quiz deletion or separate student/profile collection has been introduced.

## Testing and release gate

- `npm test`: mocked unit/API regressions (not a load proof).
- `npm run test:db`: five HTTP exam journeys against a separate database explicitly named `quiz_hub_test`.
- `npm run test:load`: 250 simultaneous student journeys; supports `node src/scripts/testExamJourney.js --users=300`.
- `npm run test:races`: real MongoDB autosave-vs-submit/restart tests.
- `npm run test:journey`: real MongoDB duplicate-email race, expiry, violation termination, admin deletion and reattempt tests.
- `npm run attempts:finalize`: one-shot expiry cleanup.

Real DB tests require `TEST_MONGODB_URI` and must **never** run against production. Verify 200, 250, and 300 realistic students and test lost responses, retries, browser recovery, violation races and admin resets before live exams. A green GitHub Actions check alone does not establish production capacity.
