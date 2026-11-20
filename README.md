# Quiz Hub Backend

Single Express.js app + MongoDB Atlas (Mongoose) modular monolith, using the Painting backend's simple controllers/models/routes/validations/utils architecture. No Redis, queues, microservices or new packages.

**Current state:** Admin authentication, quiz management, slot scheduling, student attempt start/recovery, versioned autosave, final submission and trusted server-side scoring are implemented in stacked feature branches. **Admin result listing, pagination, CSV export, frontend migration, production scheduling and 250-student load testing are NOT implemented yet. Not ready for a live exam.**

## Local setup

1. Node.js 22+: `npm install` and commit generated `package-lock.json` before deployment.
2. `Copy-Item .env.example .env` in PowerShell; set exact `CORS_ORIGINS`, `MONGODB_URI`, strong `JWT_SECRET` and admin credentials privately.
3. Rotate any credentials previously exposed in chat; URL-encode MongoDB URI password special characters.
4. `npm run db:check`, `npm run db:seed`, `npm run dev`, `npm test`.

## Student exam flow

- `GET /api/v1/student/quizzes` — available published quiz metadata.
- `POST /api/v1/student/attempts/start` — name, numeric-only roll string and UUIDv4 `startKey`. No student login/signup.
- `GET /api/v1/student/attempts/current` — safe questions and server-saved draft; never returns private answer keys.
- `PUT /api/v1/student/attempts/draft` — complete answer snapshot and increasing version; safe retries and stale-write protection.
- `POST /api/v1/student/attempts/submit` — save final answers and trusted grading in **one conditional MongoDB update**. Duplicate retries return the original receipt.

For submit/draft, send `{ "version": 1, "answers": [{ "questionId": "507f1f77bcf86cd799439011", "answer": "A", "timeSpent": 5, "timedOut": false }] }`; submit optionally accepts `"reason": "student"`. Use `credentials: "include"` in browser requests. Roll number must contain only ASCII digits; it remains a string to preserve leading zeros.

## Scoring rules

- MCQ and True/False: scored **only** against private MongoDB answer keys.
- Short-text and coding answers: **manual review required** when answered. No browser-provided test results or points are trusted, and user JavaScript is never executed in this backend.
- Unanswered manual questions are awarded zero without review.
- Score starts as partial while `gradingStatus = "pending_review"`. Final score is complete only when `gradingStatus = "graded"`.
- Grade fields (`score, maxScore, objectiveScore, pendingReviewCount, gradingStatus, manualGrades`) live on the same `Attempt` document; no extra result collection.
- Students never receive admin scores in the submit receipt. Student result publication policy and UI are later-phase work.

## Admin review APIs (admin JWT cookie required)

- `GET /api/v1/admin/attempts/:id`: read an attempt's stored answers and grading state.
- `PATCH /api/v1/admin/attempts/:id/grade`: manual grade one answered coding/short-text question.

Example:

```json
{ "questionId": "507f1f77bcf86cd799439011", "pointsAwarded": 2 }
```

Grades are validated against the question's maximum marks, recomputed server-side and protected against conflicting admin updates by `gradingVersion`. All admin state-changing requests require trusted `Origin`.

## Expired-attempt processing

```sh
npm run attempts:finalize
```

This one-shot command finds expired-but-unsubmitted attempts, saves the **last successfully autosaved draft** (never late client answers) and grades them. It is idempotent and safe to rerun.

On AWS EC2, schedule the command every minute using an OS cron job **after the deployment phase**. A scheduler is not configured yet. The script does not run automatically during local development.

## Limitations and release checklist

- Any name + numeric roll number is allowed; **roll number alone cannot verify identity**. First claimant controls that attempt.
- The frontend still uses Firebase and accepts alphanumeric rolls. Frontend migration and numeric validation remain necessary.
- Current tests mock database operations. **Actual Atlas transaction capacity, concurrent write consistency, 250-user load and browser recovery still require staging verification**.
- Untrusted code execution, automatic coding grading, and real-time anti-cheating detection are intentionally not implemented.
- Admin pagination/search/CSV and optional result publishing are next phases.
- MongoDB Atlas Free limits may require reduced autosave frequency and batch testing under the 250-student peak load.
