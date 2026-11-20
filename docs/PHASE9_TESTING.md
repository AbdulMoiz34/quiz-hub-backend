# Phase 9 — Real MongoDB reliability checks

Quiz Hub supports a peak of roughly **250 students per exam slot**. Previous unit tests mocked the database. These scripts test the full Express HTTP flow against a **real, isolated MongoDB Atlas database** without adding dependencies.

## 1. Prerequisites

- Node.js 22+, `npm install`
- A *separate* database `quiz_hub_test` on Atlas. Your database user must have read/write permissions on it, and Atlas Network Access must allow your development IP.
- Rotate any previously shared database password. Keep the password private.
- Do **not** point these scripts at your real `quiz_hub` database. The script checks that the selected DB name is exactly `quiz_hub_test` **before writing any fixtures**.
- This script never reads the application's `MONGODB_URI`. It uses `TEST_MONGODB_URI` only.

PowerShell example (enter the URI privately on your own machine; URL-encode password special characters):

```powershell
$env:TEST_MONGODB_URI="mongodb+srv://USERNAME:ENCODED_PASSWORD@YOUR_CLUSTER.mongodb.net/quiz_hub_test?retryWrites=true&w=majority"
npm run test:db
npm run test:load
Remove-Item Env:TEST_MONGODB_URI
```

Run `test:db` **first**. Only run the load test after the smoke test passes.

## 2. What the real-DB smoke test does

Runs five real HTTP student journeys (one isolated quiz + one slot):

1. Creates a temporary published quiz with a private MCQ answer key and a test slot.
2. Initializes unique MongoDB indexes required for duplicate-attempt prevention.
3. Concurrently starts students with numeric roll numbers; checks no answer key leaks.
4. Saves answers, submits each attempt, and verifies the actual MongoDB records.
5. Retries the same start and submit; confirms one attempt and immutable final answers.
6. Verifies different start key cannot claim an existing roll.
7. Checks admin statistics, paginated results and complete CSV export.
8. Verifies server-side MCQ scoring.
9. Verifies a late submit **does not overwrite the last saved draft**.
10. Restarts the HTTP server and checks the existing session still works.

The script removes only its temporary Quiz/Slot/Attempt/Admin records in `finally`, even after a failure. If the script is force-killed, inspect `quiz_hub_test` for a leftover `Integration Test` fixture.

## 3. What the 250-user load test does

`npm run test:load` starts **250 simultaneous independent HTTP clients**. Every client calls:

`start → current → draft autosave → submit`

It reports:

- Number of successful / failed journeys (plus initial errors)
- Actual MongoDB attempt, submission and slot-admission counts
- Total runtime and approximate p95 latency for each request type

A pass requires 250 successful complete journeys, exactly 250 corresponding attempt documents, 250 submitted statuses, and 250 slot admissions. Failure exits with nonzero status. These results depend on the *actual Atlas plan, network and computer* used in the test. **Passing once is not a production guarantee.**

**Caveats:** This is a single-process synthetic test; real browsers, different client networks, tab switching, autosave frequency, sustained traffic and server restarts under load need separate staging validation. This script does not test the maximum safe sustained requests/second or prove your AWS EC2 capacity. Use a separate database to prevent interference with exam students.

## 4. Release checklist

- [ ] `npm run check` passes
- [ ] `npm test` passes (unit/API-mock tests)
- [ ] `npm run db:check` using authorized private DB URI passes
- [ ] `npm run test:db` passes on dedicated Atlas test database
- [ ] `npm run test:load` completes 250/250 in a staging setup with no data mismatches
- [ ] Passwords/keys rotated and stored outside Git; `package-lock.json` committed
- [ ] Real browser end-to-end: admin creates quiz/slot, student enters numeric roll, autosaves, refreshes, submits
- [ ] Admin result pagination/CSV checked with 1,500+ records
- [ ] Timers, expiry scheduling, retries and interrupted network submissions checked
- [ ] Frontend Firebase services migrated to Express
- [ ] AWS EC2 HTTPS, cookies, CORS, firewall, backups and monitoring verified

**Stop-ship:** A failed admission/submit, duplicate roll acceptance, lost saved answer, stale final score, exposed answer key or unconfirmed production MongoDB capacity blocks live launch.


## WriteConflict root cause and regression check

Earlier versions reserved a seat by incrementing a shared
`Slot.admittedCount` document *inside each student's transaction*.
At 250 concurrent starts this caused MongoDB
`WriteConflict` / `TransientTransactionError` (code 112).
Adding retries to the same contended transaction does not remove the
shared-document hotspot.

The corrected implementation assigns a unique `Attempt.seatNumber`
using the MongoDB unique index `{ slot: 1, seatNumber: 1 }`.
Students do not update the same Slot document. The load script
now checks all reserved seat numbers are distinct, within capacity,
and that the 251st new student gets HTTP 409.

If a previous live slot contains old attempts without seat numbers,
new admissions are deliberately blocked until those records are migrated.
For load tests, each run creates a new independent quiz and slot inside
`quiz_hub_test`, and attempts cleanup afterward.

**Please record:** `requestedStudents`, `successfulJourneys`,
`failures`, `databaseAttempts`, `databaseSubmissions`,
`slotAdmissions`, and p95 latencies. If any step fails, do not
proceed to an actual examination.


## Diagnosing 250-user `fetch failed` errors (2026-11-20)

The 250-user burst reported 232 successful journeys and 18 generic `fetch failed`
exceptions, with a **31.6-second p95 start latency for successful requests**.
The successful 232 attempt/submission/seat counts matched. This is **not a pass**.

The original runner discarded each fetch exception's `cause`, which made it
impossible to tell whether the error was a TCP connection timeout,
socket reset, network abort or something else. The diagnostic runner now
reports each failure's `step`, `causeName`, `causeCode`, `httpStatus`,
`elapsedMs`, and aggregate `failureCounts`. It does **not** print
cookies, passwords, student answer payloads or MongoDB URIs.

Run only against a dedicated `quiz_hub_test` database, with the private
`TEST_MONGODB_URI` configured in your local PowerShell session:

```powershell
npm run test:db
npm run test:load
npm run test:load -- --ramp-ms=5000
node src/scripts/testExamJourney.js --users=300
```

Use the **burst** (`rampMs: 0`) as the actual simultaneous-entry test.
The optional 5-second ramp is strictly diagnostic, and must not be
reported as a 250-simultaneous-student success result.

Interpret the new results:

- `UND_ERR_CONNECT_TIMEOUT`: Client TCP connection timeout; examine
  connection burst, event-loop responsiveness, OS/network and HTTP
  acceptance. It does not by itself prove a MongoDB write error.
- `ECONNRESET` or `UND_ERR_SOCKET`: Socket closed/reset; correlate with
  backend termination, request errors and system resource pressure.
- `TimeoutError`: The configured full-request timeout expired.
- `http_status:500`: Application request failed; inspect backend logs
  and MongoDB error codes (without exposing credentials).
- `http_status:409`: Check seat capacity, roll uniqueness and scheduling.

After each run, verify the independent **databaseAttempts**,
**databaseSubmissions**, and **slotAdmissions** counts, and the 250
unique-seat assertion. If any count is wrong or any journey failed,
the run failed irrespective of the successful-request p95.

**Next decision:** diagnose the exact failure category before changing
MongoDB pool sizes, adding retries, increasing HTTP timeouts or
restructuring the seat allocator. In particular, blindly retrying a
request after an unclear response can lead to ambiguity; use the
existing persisted `startKey` and idempotent API instead.


## 2026-11-20: 250-user ECONNREFUSED diagnosis

One **real** burst of 250 students finished 232/250. All 18 failures were
`start:ECONNREFUSED` for students 233–250 (approximately 765–773 ms).
The other 232 journeys had equal attempt/submission/seat counts.
Start p95 among successful requests was 41,278 ms. **Not a pass.**

These 18 errors happen while opening an HTTP connection: no Express HTTP
response was received. That does not prove a MongoDB query failed.

To distinguish local Windows HTTP accept/burst behavior from slow
Atlas/seat-allocation requests, run these **in this order**:

```powershell
# No TEST_MONGODB_URI needed. The local server uses GET /health only.
node src/scripts/testExamJourney.js --users=250 --transport-only

# Real Atlas integration (requires private TEST_MONGODB_URI targeting
# exactly quiz_hub_test; do NOT run against live quiz_hub):
npm run test:load

# Diagnostic arrival ramp only (NOT a 250-at-once success criterion):
npm run test:load -- --ramp-ms=5000
```

The HTTP-only probe creates **no MongoDB connection or fixture**.
It reports `tcpConnectionsAccepted`, failure codes and successful
health latency. It uses the **same local Node.js Express listener** as
the real test, without database work.

Interpret the comparison:

- **HTTP-only burst also refuses connections:** local Windows/Node
  TCP accept backlog or socket handling is the leading suspect;
  verify with a separate-process/external load generator, not MongoDB tuning.
- **HTTP-only burst succeeds but real exam start fails:** HTTP listener
  can accept an idle burst, so investigate HTTP/DB request pressure,
  seat collisions, Atlas tier, Mongo query latency and event-loop load.
  This does not automatically prove which subsystem is responsible.
- **Ramped exam test works but simultaneous burst fails:** suggests
  burst sensitivity. Do not count a ramped pass as meeting the burst goal.
- **Both pass:** repeat several times and verify p95 and MongoDB counts.
  A single success is not a production readiness certificate.

The server is started with the Node default `listen()` backlog. Node
documents a **requested default of 511**, but the operating system
determines the effective queue. On Windows, Winsock may refuse
connections when the pending queue is full. These are possibilities
to be measured, **not established root causes**.

No production `app.js`, MongoDB pool configuration, seat logic, retry
policy or dependencies are modified by this diagnostic.


## Phase 11: real MongoDB concurrent-write regression tests

The 250-user journey test checks total students and server-side results.
It does not deliberately race autosave vs autosave, autosave vs submit, or
submit vs submit on **the same** attempt.

The separate `npm run test:races` script targets those invariants against
**only** the explicitly selected `quiz_hub_test` database. It runs
five iterations of four race cases plus one HTTP restart/recovery case:
out-of-order draft versions, duplicate final submissions with conflicting
answers, a newer draft versus stale final submit, and late submit versus
expiration finalization. It independently reads all persisted Attempt
documents to verify immutable submissions, trusted grading and record counts.

```powershell
# Set the private TEST_MONGODB_URI locally to a dedicated quiz_hub_test DB.
npm run test:races
```

There are no new services or npm dependencies. Test fixtures are deleted
by their temporary quiz ID after the run. A forced process termination can
leave only test fixtures in `quiz_hub_test`; inspect them manually if needed.
GitHub CI checks syntax, but this real database test **does not run in CI**
without a separate authorized test database.

**Passing this race regression does not resolve** the previously observed
Windows simultaneous TCP connection refusals, the slow 250-user start p95,
or frontend/production deployment readiness.
