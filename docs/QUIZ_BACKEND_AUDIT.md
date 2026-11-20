# Quiz Hub Backend — Evidence-Based Architecture, QA & Production Readiness Audit

**Audit date:** 20 November 2026  
**Repository:** `AbdulMoiz34/quiz-hub-backend`  
**Audited baseline:** `main` commit `df5c97d29eae248d30ba49cd4e7196cd94159da3` (tree `6a14114103c4e5b2cb4362ccfef8330c1d0cd37a`)  
**Scope:** All tracked application JavaScript, routes/controllers/models/validators/middleware/config/utils/scripts, dependency manifests, GitHub CI, existing tests, and documented API behavior. This is a **read-only application audit**. No application source or test code has been modified by this audit.

> **Verdict: NOT PRODUCTION-READY / NO-GO for a 200–300-student live exam.** The code includes sound database-level protections, but successful real Atlas runs at the intended load, full-browser recovery and failure testing, and enforcement of any required per-question or violation policy are **not verified**. Do not confuse GitHub's passing mocked tests with an Atlas capacity benchmark.

## 1. Method, evidence and limitations

- **Repository evidence:** inspected the source files in the audited GitHub commit, including every declared route, controllers, models, Joi validators, middlewares, config, helpers, scripts and the nine tracked `test/*.test.js` files. File references below use **actual `main` file paths and 1-based line numbers** from that commit. [Open audited tree](https://github.com/AbdulMoiz34/quiz-hub-backend/tree/df5c97d29eae248d30ba49cd4e7196cd94159da3).
- **CI evidence:** GitHub Actions run [44677114693](https://github.com/AbdulMoiz34/quiz-hub-backend/actions/runs/44677114693) completed successfully on that commit, running `npm install`, `npm run check`, and `npm test` per `.github/workflows/ci.yml:12–22`. **This indicates CI passed, not that its mocked database assertions constitute a real load test.**
- **Real MongoDB evidence:** a previously supplied terminal screenshot showed `MongoServerError` code **112** (`WriteConflict`, `TransientTransactionError`) at the former transaction-based attempt start; the source at this audited commit uses a different unique-seat insertion path (`src/controllers/attempt.controller.js:64–115`). **There is no supplied or independently executed post-fix 250-student success report.** This is a historical observed failure, **not** proof that the current fix has failed.
- **Independent execution:** GitHub source content was accessible through the connected repository. Container Git clone failed with DNS resolution (`Could not resolve host: github.com`), so `npm test`, `test:db` and `test:load` were **not independently executed in the audit environment**. No Atlas credentials, index inspection, query `explain()`, runtime profiler or network telemetry were available. Do not infer latency, throughput, index build success or actual record counts.
- **Classification:** **Confirmed code finding** = directly observable missing/enabled behavior or logic path; **demonstrated historic failure** = user's screenshot, not reproduced on current commit; **conditional design risk** = plausible but needs targeted integration/security test; **acceptable/no change** = retain existing implementation. Severity considers the live-exam consequence, not certainty of reproduction.

## 2. Architecture inventory & dependency review

### Actual layout and data flow

`src/app.js:17–55,58–90` is a **single Express app and startup entry point**. It configures Helmet, explicit credentialed CORS allowlist, a 1 MB JSON limit, cookie parsing, liveness/readiness, trusted-origin checks, admin and student routers, JSON 404/error handling. Startup connects MongoDB, initializes the Attempt and Slot models, then starts HTTP. **No separate `server.js`**; splitting it again is not justified.

`src/config/`: environment (`env.js`), one MongoDB pool (`db.js`, `maxPoolSize:15`), admin/attempt cookie options (`cookies.js`). `src/models/`: **Admin**, **Quiz** (embedded Questions), **Slot**, **Attempt** (embedded Answers and grading). `src/routes/{admin,student}/`: two small route trees. `src/controllers/`: admin auth, quiz CRUD/publishing, slots, student discovery/attempt start, draft/submit, grading and result queries. `src/validations/`: Joi input/query schemas. `src/middlewares/`: JWT authorization, trusted Origin, error handler and Joi validator. `src/utils/`: JWT, response shapes, safe question projection, grading, draft validation, expired-attempt finalization and result/CSV helpers. `src/seeds/adminSeed.js` is the one-time admin seeder; `src/scripts/` has DB ping, one-shot expiry finalization and a synthetic real-DB journey runner. No `services/`, repository-interface layer, Redis, worker or queue framework exists.

**Actual external dependencies (`package.json:20–30`):** `express`, `mongoose`, `joi`, `jsonwebtoken`, `bcryptjs`, `cookie-parser`, `express-rate-limit`, `cors`, `helmet`, `dotenv`. Every declared runtime dependency has an observed import or purpose in the inspected source. **No unused dependency was confirmed; no package-removal recommendation.** Node >=22 required (`package.json:6–7`). GitHub CI currently uses `npm install`, and **no `package-lock.json` appears in the tracked tree**, so dependency resolution is not locked (`.github/workflows/ci.yml:16–18`). This is a repeatability concern, not proof of a runtime defect.

### Model relationships and invariants

- `Admin`: one seeded operator; unique lowercase email, bcrypt hash private by default, session version for logout revocation (`src/models/admin.model.js:3–7`; `src/seeds/adminSeed.js:7–29`). No admin registration API.
- `Quiz`: embedded questions and private `correctAnswer`/`testCases`; title/duration/per-question timing/violations/published flags; denormalized `questionCount` (`src/models/quiz.model.js:3–31`). Only admin endpoints return the entire document.
- `Slot`: quiz reference, start/end, capacity, active flag; unique `{quiz,name}` plus `{quiz,startsAt}` index (`src/models/slot.model.js:3–13`). The code models arbitrary slots, not a hardcoded six-slot fixed array.
- `Attempt`: quiz, slot, numeric roll as **string**, name, start-key hash, seat number, status and deadlines, versioned embedded answers, scoring/manual review (`src/models/attempt.model.js:3–37`). Unique `{quiz,rollNo}` prevents a second attempt for the same roll/quiz; unique **partial** `{slot,seatNumber}` enforces seat exclusivity for numbered attempts (`:39–49`). Database index existence and correctness on the real Atlas cluster remain **unverified**.
- A student is **not** a database account: the name and roll are freely entered, and a signed HTTP-only cookie represents one attempt (`src/validations/attempt.validation.js:3–10`; `src/middlewares/auth.middleware.js:41–70`). Identity impersonation is an acknowledged product trade-off, not an undiscovered code exploit.

**Judgment:** The modular monolith is appropriately sized. Embedded questions and attempt answers are reasonable for the present scale and support atomic single-document updates. **No change recommended** to the basic architecture, single app file, four model families or shared validation/auth helpers.

## 3. Verified API inventory — all 23 routes

All paths below have prefix `/api/v1`. Every response ultimately comes from the referenced controller via `successResponse`/`errorResponse` or middleware. Write routes under `/admin` and `/student` require an allowed `Origin` (`src/app.js:48–52`; `src/middlewares/origin.middleware.js:3–10`). Admin routes besides login require the admin JWT cookie; attempt `/current`, `/draft` and `/submit` require an attempt JWT cookie. Authentication is **not** inferred solely from CORS.

| # | Method and path | Actual handler / validation | Storage and verified outcome |
|---|---|---|---|
| 1 | `GET /health` | `app.js:35–38` | HTTP 200 liveness; no DB dependence. |
| 2 | `GET /ready` | `app.js:39–46` | Mongoose ready state; HTTP 200/503. |
| 3 | `POST /admin/auth/login` | `auth.routes.js:20`, `adminLogin`; Joi and 5/15min/IP limiter | Admin lookup, bcrypt compare, signed 12h HTTP-only cookie; 400/401/429. |
| 4 | `GET /admin/auth/me` | `auth.routes.js:21`, `adminMe` | JWT + Admin sessionVersion DB check; admin identifier/email. |
| 5 | `POST /admin/auth/logout` | `auth.routes.js:22`, `adminLogout` | Increments sessionVersion and clears cookie; revokes all prior sessions. |
| 6 | `GET /admin/quizzes` | `quiz.routes.js:13`, `listQuizzes` | Admin quiz summaries, no answer arrays; currently unpaginated. |
| 7 | `POST /admin/quizzes` | `quiz.routes.js:14`, `createQuiz`; `quizSchema` | Validated embedded questions and private answer keys saved; 201 with ID. |
| 8 | `GET /admin/quizzes/:id` | `quiz.routes.js:15`, `getQuiz` | Entire quiz including correct answers/coding cases for admin. |
| 9 | `PUT /admin/quizzes/:id` | `quiz.routes.js:16`, `updateQuiz`; `quizSchema` | Replaces specified validated fields only when unpublished; CAS by `isPublished:false`; 409 otherwise. |
| 10 | `PATCH /admin/quizzes/:id/publish` | `quiz.routes.js:17`, `publishQuiz` | Sets `isPublished:true`; no unpublish endpoint. |
| 11 | `GET /admin/slots?quizId=` | `slot.routes.js:11`, `listSlots` | Slot list by quiz ID. |
| 12 | `POST /admin/slots` | `slot.routes.js:12`, `createSlot`; Joi | Creates future slot; checks quiz and overlap before insert. |
| 13 | `PATCH /admin/slots/:id` | `slot.routes.js:13`, `updateSlot`; Joi | Edits future slot, checks overlap; started slots rejected. |
| 14 | `GET /admin/attempts/:id` | `grading.routes.js:11`, `getAttemptForReview` | Admin read of answers and grading fields; 400/404 handled. |
| 15 | `PATCH /admin/attempts/:id/grade` | `grading.routes.js:12`, `gradeManualAnswer`; Joi | Manual score for answered short-text/coding; gradeVersion CAS. |
| 16 | `GET /admin/results` | `results.routes.js:17`, `listResults`; Joi query | MongoDB keyset pagination with `limit<=100`; quiz/slot/status/grade/exact numeric roll filters. |
| 17 | `GET /admin/results/stats` | `results.routes.js:15`, `resultsStats` | DB aggregation for all attempts (active, expired, submitted, terminated, reviewed). |
| 18 | `GET /admin/results/export` | `results.routes.js:16`, `exportResults` | Streaming UTF-8 CSV of **all** filtered attempts, not one page; no raw answers. |
| 19 | `GET /student/quizzes` | `student/index.js:8`, `availableQuizzes` | Active slots counted by Attempt, then published quiz metadata only. |
| 20 | `POST /student/attempts/start` | `attempt.routes.js:23`, `startAttempt`; Joi; limiter | Checks published quiz + active slot; attempts unique seat insert; 409 on duplicate/full/closed; returns signed 6h attempt cookie. |
| 21 | `GET /student/attempts/current` | `attempt.routes.js:24`, `currentAttempt` | Signed cookie; nonexpired started attempt returns safe question projection + persisted draft; expired/finished hides questions. |
| 22 | `PUT /student/attempts/draft` | `attempt.routes.js:25`, `saveDraft`; Joi | Single conditional update (`status`, `expiresAt`, monotonically higher version); 200 saved / 409 stale or ended. |
| 23 | `POST /student/attempts/submit` | `attempt.routes.js:26`, `submitAttempt`; Joi | Server scores answers; one conditional finalization update; retry gets stored receipt; late submit finalizes last saved draft. |

**Not present in the registered routes:** student account registration, roster/roll verification, student results lookup/publication, server violation-log/strike API, quiz deletion or unpublishing, and an API that starts automatically from an exam schedule. Their absence must not be disguised as tested functionality.

## 4. Complete admin journey assessment

1. **Seed/login:** `src/seeds/adminSeed.js:7–29` validates secret length, refuses to overwrite an existing admin; `src/controllers/auth/admin.controller.js:7–17` checks bcrypt and signs admin JWT; `src/middlewares/auth.middleware.js:8–39` validates issuer/audience/HS256/sessionVersion. Login rate limiting in `src/routes/admin/auth.routes.js:12–22`. **Implemented; mocked route/auth tests exist. Real Atlas/login from a browser not verified in this audit.**
2. **Quiz creation/questions:** Admin-only create, view and update, Joi checks MCQ options/correct answer and true/false normalization (`quiz.validation.js:3–43`, `quiz.controller.js:8–36`). Published questions cannot be updated via PUT. Short-text/coding stored but evaluated manually. **Implemented; no full admin UI test performed.**
3. **Publishing:** sets `isPublished:true`; student start checks it (`quiz.controller.js:39–46`; `attempt.controller.js:46–48`). No automated timetable publication; slot must be open. **Implemented, subject to schedule race below.**
4. **Scheduling:** slots must be future, end after start and nonoverlapping by precheck (`slot.controller.js:8–13,27–49,53–77`). **Potential overlapping-slot concurrency race** remains because read-check and insert/update are not one atomic constraint. See F-04.
5. **Review/results:** authenticated attempt detail and manual grading with grade-version CAS (`grading.controller.js:9–65`); keyset-paginated list, stats and streaming CSV (`results.controller.js:12–100`); formulas quoted/guarded (`resultHelpers.js:37–61`). **Implemented; 1,505-row test uses a mocked database and proves neither real cursor performance nor index plans.**
6. **Failure cases:** 400 Joi validation, 401 auth, 403 Origin/CORS, 404 missing entity, 409 logical conflicts, 429 login rate limit, 500 generic error middleware (`error.middleware.js:3–10`). Unexpected DB errors become 500; no documented retry/alert/incident procedure. **Actual Atlas outage handling not verified.**

## 5. Complete student journey assessment

1. **Identification:** any name + roll string containing only ASCII digits 0–9 (1–25 chars), no signup, no roster (`attempt.validation.js:3–10`). Leading zeros preserved. **Implemented as specified. Identity cannot be proven; first claimant can consume a roll.**
2. **Discovery/start:** `GET /student/quizzes` discovers open published quizzes; `POST /start` checks quiz, active slot and unique `{quiz,rollNo}`; uses UUIDv4 start key SHA256 hash to permit exact network retries; seat choice spread across unique indexes (`attempt.controller.js:33–115`). **Legacy unnumbered slots are deliberately blocked** (`:58–62`). A unique seat index is essential; real Atlas build not verified. The old shared-counter transaction and observed `WriteConflict` have been removed in source, but the 200–300-user objective is **not revalidated**.
3. **Questions and isolation:** `/current` uses signed attempt cookie and an explicit safe projection without `correctAnswer`/`testCases` (`attempt.controller.js:118–150`; `studentQuestions.js:12–37`). Question/option order is stable per attempt. **No direct answer-key leak found in this path.**
4. **Draft saving:** `/draft` validates every question ID and accepts one complete snapshot, with version comparison and server expiry check in the MongoDB update (`submission.controller.js:31–67`). Old versions cannot overwrite newer drafts; identical retry gets 200 if answer ordering also matches. **The server acknowledges only persisted versions; any unsent browser-local changes are outside its guarantee.**
5. **Resume/reconnect:** signed cookie + `/current` reconstructs questions and stored draft/version while attempt is started (`attempt.controller.js:118–150`). Recovery from expired JWT, lost cookie/startKey, a second device, broken cross-site cookies or browser storage deletion is **not implemented**. Real restart/reconnect test not witnessed.
6. **Timers:** overall deadline is stored in `Attempt.expiresAt` and checked for drafts/submission (`attempt.controller.js:74–90`; `submission.controller.js:35–36,49–50,80–82,96–97`). **Per-question `timeSeconds`, quiz-wide `questionTimeSeconds`, submitted `timeSpent`/`timedOut`, and `maxViolations` are not enforced by any server-side attempt-save/submit logic.** Treat those as client-facing metadata unless product rules explicitly require enforcement. See F-02/F-03.
7. **Final submission/scoring:** `/submit` checks question IDs, computes trusted MCQ/true-false scores and manual-review state, then performs one `Attempt.findOneAndUpdate` with `status:"started"` and version/deadline predicates (`submission.controller.js:69–129`; `gradeAttempt.js:9–57`). Concurrency with a late autosave is guarded by status and draftVersion predicates. **No confirmed double-submission creation bug found.** The exact cutoff race (F-05) is not exercised by real-DB tests.
8. **Results:** Students receive an attempt submission receipt, **not a result lookup**. `showScoreToStudent` and `resultsPublished` exist in the Quiz model but do not provide a student result API (`quiz.model.js:24–26`; `student/index.js:5–11`). **Incomplete student result journey, not an exposed result.**

## 6. Findings register: confirmed bugs, risks, security and operations

| ID | Severity | Classification | Evidence | Consequence / smallest justified action |
|---|---|---|---|---|
| **F-01** | **Blocker** | **Missing evidence**, not a code bug | `package.json:17–18` caps the actual runner at **250** (`testExamJourney.js:14–22`); CI only runs `npm test` (`ci.yml:16–22`); user previously showed WriteConflict 112, no post-fix metrics supplied | **200–300 concurrent users are unproven.** Run isolated real Atlas 200, 250 and 300-user suites with verified DB counts and latencies. The present runner must be adjusted to test 300; do not silently claim 300 passed. |
| **F-02** | **High if required by exam rules** | Confirmed absent server enforcement | `quiz.model.js:10,20`; `studentQuestions.js:22`; `submission.controller.js:31–129` checks only global expiry, not per-question deadlines | Student can submit an answer to a question after its advertised per-question time while global time remains. Decide explicitly whether per-question limits are binding. If yes, track trusted per-question timing server-side and reject or ignore late answers with tests; **do not add this behavior without business approval.** |
| **F-03** | **High if required by exam rules** | Confirmed feature gap | `quiz.model.js:21`, `attempt.model.js:17,25`, `submission.validation.js:26`; no registered violation event API or strike counter | `maxViolations` is advertised, but a student can keep submitting until global expiry; a client-provided `reason:"violation_limit"` is only metadata. If violations must end exams, specify observable events and implement a minimal server-owned violation count/transition. Browser cannot reliably prove intent. |
| **F-04** | Medium | **Code-level race**, not observed under load | `slot.controller.js:8–13,36–43,66–75`; unique index is `{quiz,name}`, not a temporal exclusion constraint (`slot.model.js:12–13`) | Two concurrent admin writes with different slot names can each see no overlap and create overlapping schedules. Reproduce with 2 authenticated concurrent slot creates; then serialize the admin operation or add an appropriate guard **only if this case is operationally possible**. Never claim overlap is atomically prevented. |
| **F-05** | High | **Timing-window risk**, not empirically reproduced | `submission.controller.js:77–112`: computes `now` before scoring and uses fixed `expiresAt:{$gt:now}` in later DB update | Submission accepted using the pre-scoring timestamp may commit after cutoff if validation/scoring/DB scheduling straddles expiry. Specify rule: request arrival vs DB acceptance. Test near-boundary with injected delay; use execution-time condition if strict deadline is required. |
| **F-06** | High | Confirmed deployment dependency | `attempt.controller.js:58–62` explicitly refuses slots with old unnumbered attempts; `attempt.model.js:40–44` partial unique seat index | Upgrade during a currently active legacy slot can block all new students. Before launch inspect existing slots/attempts; finish old slots first or create a carefully tested one-time migration. Do **not** delete student attempts to bypass guard. |
| **F-07** | Medium | Confirmed operational gap | `scripts/finalizeExpired.js:8–29` is manually invoked; no cron config in repo; `README.md:22–23` says not scheduled | Attempts with no final request remain `started` after expiry; result stats report `expiredPendingFinalization`. Schedule existing one-shot job at deployment and test reruns/restarts; **no Redis/queue needed**. |
| **F-08** | Medium | Confirmed supply-chain repeatability gap | Missing tracked `package-lock.json`; `package.json:20–30`, `ci.yml:16–18` use floating compatible versions and `npm install` | CI/deploy may resolve different dependency versions. Commit a verified lockfile and switch CI to `npm ci`; no new dependency. |
| **F-09** | Medium | Conditional security/abuse risk inherent in product decision | Open enrollment in `attempt.validation.js:3–10`; one attempt per roll in `attempt.model.js:39`; `attempt.routes.js:15–23` only IP-based 1000/15min limit | Anyone who knows another roll can take it first; an actor can fill 250 seats using many rolls. Requirement is intentional, so **do not silently add login/roster**. Decide on operational supervision, a shared time-limited access code, or rate/monitoring adjustments if first-claim abuse is unacceptable. |
| **F-10** | Medium | Unverified performance risk | `student.controller.js:9–25` executes one `Attempt.countDocuments()` per active slot per availability request; `db.js:3–7` pool is 15; `attempt.controller.js:68–115` probes occupied seat indexes until success/full | Repeated discovery and high occupancy may drive query/write latency; a 250-user one-question load does not prove normal workload. Measure query counts, p95/p99 and duplicate-key retries before changing admission algorithm or introducing aggregation. |
| **F-11** | Medium | Missing test coverage | `test/attempt.test.js:115–224` stubs models; `test/submission.test.js:54–110` fakes atomic updates; `test/results.test.js:68–118` simulates DB; `testExamJourney.js:145–174` creates **one MCQ and only one autosave** | No real-DB tests for simultaneous save-vs-submit, lost submit response, multiple autosaves, 20–50 questions, DB failover, app kill, 300 users, or multiple processes. Build targeted deterministic integration tests and separately examine persisted DB records after each scenario. |
| **F-12** | Medium | Confirmed sensitive caching gap | `quiz.controller.js:21–25` and `grading.controller.js:9–18` return private quiz answer banks / student answers without explicit `Cache-Control:no-store`; student and results routes do set it (`app.js:49–52`, `results.controller.js:24,80–82`) | Make sensitive admin detail responses explicitly non-cacheable, preserving payload and auth. Test headers. No change to authorization required. |
| **F-13** | Low/conditional | Data-schema/config ambiguity | `quiz.model.js:10,20` and `quiz.validation.js:10,37` independently define per-question and quiz-wide question time with the same default; `/current` sends both (`attempt.controller.js:141`, `studentQuestions.js:22`) | Timer precedence is undefined in backend; resolve product semantics and document one source of truth before any UI changes. This is not evidence of current data corruption. |
| **F-14** | Medium | Feature gap, not security leak | `quiz.model.js:24–26`, student routes `student/index.js:5–11`; no route for student result access or admin publish-results | A complete public result journey cannot be demonstrated. If product requires publication, add a deliberately authorized read-only endpoint; never expose scores just because flag exists. |
| **F-15** | Low | Confirmed environment validation gap | `config/env.js:39–47` parses port via `Number(env.PORT||5000)` but does not validate integer/range; production `trust proxy=1` in `app.js:20` assumes exactly one trusted reverse proxy | Fail fast on invalid `PORT`, and confirm actual proxy hop/HTTPS/cookie configuration before AWS. Cannot assert a deployed proxy misconfiguration without infrastructure evidence. |

**Confirmed good protections — no change recommended:** JWT issuer/audience/algorithm separation (`auth.middleware.js:15–19,49–53`), HTTP-only cookie options (`config/cookies.js:4–19`), trusted Origin on state-changing browser routes (`origin.middleware.js:3–10`), Joi rejecting client scoring fields (`submission.validation.js:5–27`), explicit student question projection (`studentQuestions.js:14–25`), unique roll and seat indexes (`attempt.model.js:39–49`), versioned save (`submission.controller.js:45–66`), finalization CAS/idempotency (`:92–127`), grade-version CAS (`grading.controller.js:49–65`), bounded result pages (`results.controller.js:12–29`), and streaming CSV with injection protection (`results.controller.js:67–100`; `resultHelpers.js:37–61`). They are source-level observations, **not stress-test certifications**.

## 7. MongoDB concurrency and failure-mode analysis

**Start admission** (`attempt.controller.js:33–115`): precheck for same `{quiz,rollNo}`, check published/active slot, reject legacy unnumbered attempts, derive hash-distributed starting seat, try `Attempt.create` for each seat until a unique insert or capacity exhausted; duplicate-key collisions retry, while duplicate roll returns same session only for matching startKey. This avoids the **historically demonstrated shared Slot transaction write hotspot**. **Do not reintroduce that transaction or an in-memory slot counter.** Risk: worst-case seat probes near full occupancy are many DB round trips; quantify rather than guessing. Index build must be verified on staging (`getIndexes()`); existing data compatibility checked before cutover.

**Save vs save** (`submission.controller.js:45–66`): conditional `{status:'started', expiresAt:{$gt:...}, draftVersion:{$lt:incoming}}` is an atomic one-document update. Old versions return 409; exact same version/content retry returns 200. **No lost-update bug established from code.** Test identical payload with reordered answers; current `sameAnswers` compares array positions (`attemptAnswers.js:27–35`) and may return 409 even if semantic content matches — a minor retry ergonomics issue, not corruption.

**Save vs submit** (`submission.controller.js:45–55,92–113`): both update the same Attempt with predicates. If submission wins, drafts must fail on `status`; if higher draft version wins, old submit fails on version, requiring reload; if submit with valid greater version wins, final answers and grading are written together. **Source-level invariant is sound; real race test is missing.** Force 100 concurrent mixed operations and independently inspect a single final document/score.

**Submit vs submit** (`submission.controller.js:69–129`): only a `started` attempt matches the final update, then later requests get receipt. No second Attempt document is created by `/submit`. Test 20 repeated simultaneous submit requests and verify exactly one immutable result/receipt.

**Time expiry** (`finalizeExpiredAttempt.js:8–44`): loads last stored draft, grades it and uses status/deadline/version CAS with up to five attempts; late submit uses it (`submission.controller.js:80–82,124–126`). This is proportionate protection. Cron must actually be installed and exercised for expiry without traffic. Confirm finalization behavior under a concurrent last-second save and a simulated clock boundary.

**Schedule race** (`slot.controller.js:8–13,36–43`): no atomic overlap exclusion; test two concurrent admin requests to create different-name slots with overlapping windows. If scheduling is always single-admin/manual and rare, severity can be downgraded after evidence.

**Indexes:** `{quiz,rollNo}` unique, `{slot,seatNumber}` unique partial, `{slot,status}`, `{quiz,_id:-1}`, `{quiz,slot,_id:-1}`, `{status,expiresAt}` (`attempt.model.js:39–49`). Verify actual Atlas `getIndexes()`, index build errors, query planner `explain('executionStats')`, write contention, connections and rate limiting; code declarations alone are not database verification. Quiz and slot also have indexes (`quiz.model.js:31`; `slot.model.js:12–13`).

## 8. Security assessment

- **Authentication/authorization:** admin uses bcrypt and rotating `sessionVersion`; attempt JWT uses a distinct audience and database lookup; admin and student routes are separately protected. No confirmed unauthenticated answer-key disclosure route. Keep these checks.
- **Student identity:** numeric roll is a user-supplied identifier, not proof of identity. Given the explicitly open-entry requirement, **impersonation and seat exhaustion remain intentional security/business risks**, not solvable by schema validation alone.
- **Input trust:** Joi strips nothing implicitly but validators reject unknown fields (`validateReq.middleware.js:3–11`), including client scores, test results, and duplicate answer IDs (`submission.validation.js:5–27`). No arbitrary student JavaScript is executed in the inspected backend; coding responses are manually graded.
- **CORS/CSRF:** exact origin allowlist in `app.js:22–31`, write Origin middleware `origin.middleware.js:3–10`. Check actual frontend/HTTPS/cookies and reverse proxy; open GETs or `Origin`-less machine requests are not an authentication bypass.
- **Secrets and errors:** `.gitignore:1–8` excludes `.env`, `.env.example` contains placeholders; no real secrets identified in audited tracked configs. Real database credentials were previously shared in chat and **must be rotated**. Unexpected 500 responses return a generic message (`error.middleware.js:3–10`) while raw errors are logged server-side (`:9`); restrict log access and audit redaction before production.
- **Privacy/cache:** admin full quiz and manual-review detail lack explicit no-store headers (F-12). Results listing/export/student endpoints are no-store. CSV quotes and prefixes potentially dangerous cells (`resultHelpers.js:37–61`).
- **Availability:** public start is rate limited to 1,000/15 minutes per IP (`attempt.routes.js:15–23`), chosen to tolerate shared school Wi-Fi. In-memory counters across multiple Node processes would be independent; this is a deployment caveat, **not a justification for Redis** at the planned single-process scale. No rate limiter exists on `/draft`/`submit`; abuse/load handling needs measurement, not blind throttling that could drop students' answers.

## 9. Required test matrix — planned versus observed

| Scenario | Test design / independent DB assertion | Observed on audited commit |
|---|---|---|
| 5-user smoke | Real Atlas isolated `quiz_hub_test`, start→current→draft→submit→DB count and score | **NOT RUN by auditor** |
| 200 students | 200 simultaneous starts; 2–5 autosaves/student over time; submit. DB: 200 distinct rolls, seats, attempts, immutable final scores | **NOT VERIFIED** |
| 250 students | Current `npm run test:load` runs 250 synthetic one-MCQ journeys; verify 250 started/250 submitted/250 seats, then repeat runs | **NOT VERIFIED POST-FIX**; historical previous WriteConflict recorded |
| **300 students** | Extend runner limit and fixture capacity to 300; 300 parallel starts, bursts of saves and submits; validate 300/300/300 and latency/error distribution | **NOT SUPPORTED by current runner; NOT VERIFIED** |
| Duplicate roll race | 20 concurrent starts with identical quiz+roll, different startKeys; DB exactly one Attempt and one seat | **Only mocked unit-level / one sequential real-script retry; full race unverified** |
| Full slot | N valid starts then N+1 with new roll; 409; no phantom insert | **Real script asserts 251st in 250-run if script completes; unverified** |
| Autosave ordering | Simulate v3 arriving before v2, retries and reordering; final DB answer = v3 | **Mock unit test exists; real Atlas unverified** |
| Save vs submit | Simultaneous PUT/POST 100 iterations, both win orders; DB one immutable final answer and correct score | **No real race test** |
| Submit vs submit | 20 parallel POSTs, changed answer content; same final receipt, unchanged saved answer and grade | **Sequential retry test only** |
| Deadline boundary | Submit before/at/after expiry with delayed DB write; late answers not committed | **No boundary test** |
| Network fail/restart | Drop response after committed draft/submit; retry with same key/version; kill/restart process; reconnect | **Test script only restarts HTTP server after completed journey; genuine failures unverified** |
| DB outage/failover | Break Atlas connectivity during save/submit; log errors; restore and retry; verify persisted outcome | **NOT TESTED** |
| Admin results/export | Create 1,500+ real Attempt docs across slots; traverse all cursors, CSV count and result totals match DB | **1,505-row mock test only** |
| Browser/cookie | Real HTTPS and cross-site/same-site cookie flow, reload and multiple tabs/devices | **NOT TESTED in backend audit** |
| Long quiz/coding | Realistic 20–50+ questions, code answers, payload sizes, multiple autosaves | **NOT TESTED by current one-MCQ runner** |

**Mandatory measurements:** successful journeys, HTTP 409/429/5xx rates (with reason), final DB counts by status, unique seat and roll counts, score mismatches, missing draft versions, p50/p95/p99 per endpoint, max pool wait, CPU/RAM, Atlas connections/ops/CPU/latency and total elapsed time. The **test runner's observed p95 is not known**. For production go/no-go: zero lost confirmed writes, zero duplicates/overbookings, zero unauthorized answer leaks, zero incorrect final scores, and an explicit acceptable latency budget agreed before testing. Preserve test logs and sanitized DB assertion output. A single passing 250-user run alone does not cover 300 users or real browsers.

**Test isolation:** only use `TEST_MONGODB_URI` pointing to `quiz_hub_test` (`testExamJourney.js:16–26,135–143`), with controlled fixture IDs and cleanup (`:291–314`). Run this outside any live exam. Avoid reusing previously exposed credentials. The current test runner's `--users` bound is **2–250** (`:20–22`), so extending to 300 is a proposed later code change, **not performed in this audit**.

## 10. Mandatory over-engineering / unused-code register

A finding in this table describes **what actually exists**, not a reason to rewrite the app. "Verified usage" refers to call sites in source; it does not imply runtime execution. Distinguish confirmed redundancy from a design preference.

| ID | Assessment and exact location | Verified use | Why it may be unnecessary; smallest safe alternative | Regression test / recommendation |
|---|---|---|---|---|
| **OE-01** | **Confirmed premature constraint**: `src/validations/quiz.validation.js:27–29` requires **both** `starterCode` and nonempty `testCases` for a coding question; stored fields in `src/models/quiz.model.js:11–13`. | `src/utils/gradeAttempt.js:34–46` grades coding answers only by manual review; `studentQuestions.js:14–25` intentionally excludes `testCases`; `grading.controller.js:35–50` provides manual grading. | Requiring cases for manual-only coding questions is unused by the present backend and unnecessarily blocks otherwise valid questions. If manual grading is the actual requirement, make test cases optional **in the existing Joi schema only**, retaining private storage if needed. If an automatic evaluator is truly planned, document that product dependency instead of assuming it is implemented. | Validate coding quiz with no cases; ensure manual grading still works; assert no test cases leak to students. **Targeted change after requirement confirmation**, no new files. |
| **OE-02** | **Confirmed redundant DB projection**: `src/utils/attemptAnswers.js:3–14` loads private `questions.correctAnswer`, `type` and `points` every call. | Called from `saveDraft` (`submission.controller.js:39`), `submitAttempt` (`:77`), expired finalization (`finalizeExpiredAttempt.js:15`), and manual grading (`grading.controller.js:32`). Draft only needs question IDs. | Autosave needlessly reads scoring keys from MongoDB; does **not** leak them in HTTP response. A small optional projection for draft-only validation would reduce DB field transfer without a new service layer. | Verify saved drafts still accept only valid question IDs; compare real DB payload/query profiles. **Low-priority efficiency cleanup**, no demonstrated incident. |
| **OE-03** | **Potential duplicate configuration**: `quiz.model.js:10,20`, `quiz.validation.js:10,37` store both per-question `timeSeconds` and quiz-wide `questionTimeSeconds`. | `attempt.controller.js:141` returns quiz-wide setting; `studentQuestions.js:22` returns question-specific setting. Server submit does not enforce either. | Two knobs may convey conflicting semantics. **Do not delete either until UI/business timer precedence is agreed**; document current behavior and eventually keep only necessary configuration. | Mixed question-duration quiz; verify UI and backend expected cutoff once policy is defined. **Conditional, not confirmed dead code**. |
| **OE-04** | **Current no-op feature flags**: `quiz.model.js:24–26` stores `showScoreToStudent` and `resultsPublished`. | `quiz.validation.js:41` accepts the first flag; no student result route or publication handler reads either. | Flags are not an implemented permission system. Smallest safe action: clarify result-publication requirements, then either implement a properly scoped API or remove unused configuration with a compatibility plan. Do not expose scores merely because a flag exists. | Student cannot fetch grades until explicitly published; unpublished remains private. **No immediate schema removal recommended.** |
| **OE-05** | **N+1-like discovery queries**: `student.controller.js:9–25` performs `countDocuments` for every active Slot. | Each `GET /student/quizzes` runs this routine. | Query count grows with number of active slots, but the planned deployment may have only six. A single grouped count query could reduce calls **if profiling proves it matters**; no aggregation framework needed preemptively. | Measure DB ops/p95 for discovery at peak. **No change recommended without evidence.** |
| **OE-06** | **Useful shared helpers, not over-engineering**: `utils/responseHandler.js:1–5`, `utils/generateJwt.js:3–20`, `utils/finalizeExpiredAttempt.js:8–44`, `middlewares/validateReq.middleware.js:3–22`. | Reused across many controllers, two JWT audiences, late-submit and one-shot finalizer, body and query validators. | Removing/splitting these would increase duplication or weaken consistency. | **No change recommended.** Preserve current code and tests. |
| **OE-07** | **No confirmed unnecessary packages, microservices, Redis, queues, separate Result or Student model.** `package.json:20–30`, source tree and models. | All installed runtime packages are used; the four models reflect actual core entities. | There is no evidence to justify adding infra, adding a repositories layer, or splitting the single `app.js` into multiple bootstraps. | **No change recommended.** |
| **OE-08** | **Existing test-runner scope is intentionally narrower than production target**: `src/scripts/testExamJourney.js:14–22,145–174,256–286`. | One 1-MCQ quiz, exactly one autosave per client, 250-client max, synthetic same-host requests. | Not unnecessary code, but insufficient evidence for a 200–300-user exam. Extend scenarios **inside the same runner/test files** rather than inventing load services. | Add 300 clients, mixed requests, failure injection, independent DB assertions. **Test improvement, not application refactor.** |

**Dead-code register:** No entirely unused runtime dependency, controller, model or route was confirmed from the inspected imports and route registration. Any unconsumed *fields* are listed above; they must not be described as full unused modules. The small shared helpers and multi-file organization serve real reuse; a blanket "simplify everything" rewrite would add risk without a verified benefit.

## 11. Prioritized minimal remediation plan

### P0 — release gates (no code rewrite)

1. **Do not launch yet.** Obtain sanitized real-Atlas output for 5, then 200/250, then **300** concurrent users in dedicated `quiz_hub_test`. The current runner must be extended for 300 in a *future implementation PR*. Confirm unique rolls, unique seats, completed attempts, immutable submission versions and scoring **directly from MongoDB** after requests finish.
2. Complete deterministic real-DB races: duplicate starts with different keys; autosave vN vs vN+1; save-vs-submit; submit-vs-submit; expiry around cutoff; process restart and failed response; DB connection interruption. Reproduce each at least multiple times. Failure means **no go**.
3. Confirm production dependencies: active unique indexes, actual Atlas tier/metrics, secret rotation, browser cookie behavior, admin seed/login, backup restore, and that the expiry finalizer runs on the deployed schedule. Review/resolve legacy unnumbered attempts before opening any old slot.
4. Decide whether **per-question time** and **violation limits** are mandatory. If so, implement the minimum server-owned enforcement with tests **before** accepting exam results as authoritative. Do not mislabel browser-only heuristics as secure enforcement.

### P1 — targeted source fixes, only after specific tests/decisions

5. Reproduce and address overlapping-slot concurrent edits (F-04), near-deadline submit timing (F-05), and sensitive admin no-store headers (F-12), with one small targeted change per finding and regression test.
6. Commit a lockfile, use `npm ci` in CI/deploy; validate PORT and reverse-proxy configuration. No extra package needed.
7. Complete student results/publication only if required by actual product acceptance criteria; preserve privacy and administrative control.

### P2 — evidence-led simplification

8. Confirm coding grading scope, then remove the unused `testCases` *requirement* if grading is manual-only (OE-01); avoid adding an evaluator without approval.
9. Measure whether draft-time private answer-key projection or N+1 discovery queries materially affect latency; simplify locally if measured (OE-02/OE-05). Document timer precedence (OE-03). **Retain the single app, CAS updates, unique indexes and shared helpers.**

## 12. Final production-readiness verdict

| Dimension | Verdict | Basis |
|---|---|---|
| Architecture/readability | **Acceptable** | Single modular monolith, small controllers, practical shared helpers, no unsupported infra. |
| Admin access and quiz management | **Implemented; integration unverified** | Verified routes, Joi, JWT, DB operations; CI mocks, no live browser audit. |
| Student open-entry start | **Implemented; high-load unverified** | Unique roll/seat indexes and hash-based seat probes; historical counter WriteConflict was changed in source. |
| Autosave/duplicate submit | **Sound code-level invariants; real races unverified** | Atomic Mongo update predicates and server-side grade; dedicated race evidence missing. |
| Timers/violations | **Incomplete if advertised as enforced** | Only global expiry is enforced; per-question/strikes are metadata. |
| Results and CSV | **Implemented; real data-scale unverified** | Keyset pagination, query filters, aggregate stats, CSV stream; 1,505-row test is mocked. |
| Security/privacy | **Reasonable baseline; open-entry abuse risk** | No direct answer-key leak found, admin/attempt auth separate, but numeric roll does not verify identity. |
| 200–300 concurrent users | **FAILED: 250-client test** | User-provided real Atlas run completed 232/250 journeys, with 18 generic transport errors; 300 not tested. |
| Deployment/recovery | **NOT VERIFIED** | No production cron, frontend cutover, backup restore, Atlas outage or production HTTPS tests. |

**Decision: NO-GO for a live 200–300-student exam until P0 gates are evidenced and any required exam-policy enforcement is resolved.** The principal recommendation is **test and make a few localized fixes**, not rewrite. Where implementation is already correct and maintainable: **No change recommended.**

## 13. Post-audit evidence update: real 250-client test (20 November 2026)

**Provenance:** User-provided PowerShell output from `npm run test:load` on a
dedicated `quiz_hub_test` database after the unique-seat code. This result
was not produced by the auditor and cannot be reproduced here without private
Atlas access. It supersedes this report's earlier **unverified** status for
the 250-user run; the real test **failed**.

| Metric | Observed |
|---|---:|
| Requested student journeys | 250 |
| Successful complete journeys | 232 (92.8%) |
| Failed journeys | 18 (7.2%) |
| Failure text | `fetch failed` (all first eight samples identical) |
| Persisted Attempt documents | 232 |
| Persisted submitted attempts | 232 |
| Persisted slot admissions | 232 |
| Total test time | 40,781 ms |
| Successful start p95 latency | 31,592 ms |
| Successful current p95 | 4,767 ms |
| Successful draft p95 | 6,888 ms |
| Successful submit p95 | 6,806 ms |

**What this proves:** The 232 journeys recorded as successful had matching
attempt, submission and admission counts; no unmatched Attempt documents are
visible in these aggregate counts. The application did **not** complete the
required 250 journeys. The successful-request start p95 was high.

**What this does not prove:** `fetch failed` is a generic Node.js client
exception, not a MongoDB error code. The original test client discarded
`error.cause` and the failing HTTP stage. Therefore, client connection
timeout/socket reset, HTTP server resource pressure and DB-driven queueing
cannot yet be separated. No claim of data corruption, repeated roll numbers
or a confirmed root cause is supported by this output. A 300-user run remains
unverified.

**Follow-up:** Separate diagnostic-only [PR #14](https://github.com/AbdulMoiz34/quiz-hub-backend/pull/14)
adds safe failure `step`, `causeCode`, `httpStatus` and latency output,
plus an optional ramp comparison. CI runs mocks and syntax checks; its success
does not replace the real-Atlas retest. Do not change connection pools,
HTTP timeouts, seat allocation or dependencies before measuring the failure
category. **Production verdict remains NO-GO.**
