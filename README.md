# Quiz Hub Backend

**Stack:** Node.js 22+, Express 5, MongoDB Atlas, Mongoose, Joi — one Painting-style modular monolith. Single `src/app.js`; small models, controllers, routes, validations and helpers. No Redis or new packages.

**Current PR:** student autosave + final submission on top of the existing admin, quiz, slot and attempt-start modules.

## Setup

1. `npm install`, then copy `.env.example` to `.env`.
2. Put the rotated Atlas credential in `MONGODB_URI`; keep private credentials out of GitHub and chats.
3. Configure exact `CORS_ORIGINS` and a unique random `JWT_SECRET`. Set private `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
4. `npm run db:check`, `npm run db:seed`, `npm run dev`, `npm test`.
5. Commit the generated `package-lock.json` before production releases so CI can use `npm ci`.

## APIs

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/health` | Public |
| GET | `/api/v1/ready` | Public |
| POST / GET / POST | `/api/v1/admin/auth/login`, `/me`, `/logout` | Admin |
| GET / POST / GET / PUT / PATCH | `/api/v1/admin/quizzes`, `/:id`, `/:id/publish` | Admin |
| GET / POST / PATCH | `/api/v1/admin/slots`, `/:id` | Admin |
| GET | `/api/v1/student/quizzes` | Public summaries |
| POST | `/api/v1/student/attempts/start` | Student name + numeric roll + UUIDv4 startKey |
| GET | `/api/v1/student/attempts/current` | Signed attempt cookie |
| PUT | `/api/v1/student/attempts/draft` | Signed attempt cookie |
| POST | `/api/v1/student/attempts/submit` | Signed attempt cookie |

## Autosave and final submit

**Only digits are allowed in student roll numbers**, stored as strings to preserve leading zeroes. No student accounts or predefined roster. A signed HttpOnly attempt cookie controls access to the already-created attempt.

**PUT /api/v1/student/attempts/draft**

```json
{
  "version": 1,
  "answers": [
    {
      "questionId": "507f1f77bcf86cd799439011",
      "answer": "A",
      "timeSpent": 12,
      "timedOut": false
    }
  ]
}
```

- Send the entire known answer snapshot, not only the last changed answer.
- Increment `version` for every new snapshot; resend the **same version and content** for retry after an unclear network response.
- Only matching question IDs are accepted. No score, `testResults` or answer keys from the browser.
- If stale writes arrive out of order, they receive HTTP 409. `GET /current` returns the latest server-saved `draft: {version, answers, savedAt}` for recovery.
- Batch/debounce writes instead of writing on every keystroke. Keep a local draft too; last unsynced answers can be lost on device failure.

**POST /api/v1/student/attempts/submit**

```json
{
  "version": 8,
  "reason": "student",
  "answers": [
    {
      "questionId": "507f1f77bcf86cd799439011",
      "answer": "A",
      "timeSpent": 12,
      "timedOut": false
    }
  ]
}
```

- Allowed `reason`: `student`, `time_ended`, `violation_limit`. They are **client-reported**, not independent evidence of cheating.
- Final submission saves the latest answers and changes `status` in one conditional MongoDB update. Repeated submission returns the same receipt and does not overwrite finalized answers.
- Server enforces the deadline. Requests arriving **after expiry** finalize the last successfully stored draft, **ignoring new answers in the late request**.
- Finalized attempts cannot be edited. An attempt that expires with no subsequent request is **not automatically finalized yet**; batch finalization will be added before admin results go live.
- Objective scoring, manual/coding grading, audit violations, admin result indexes/pagination and 250-user load testing are **future phases**.

## Deployment caveats

The frontend still uses Firebase and **has not** been migrated. For browser requests to the new Express API send `credentials: "include"`. POST/PUT routes require the configured `Origin`. Cross-site Vercel/AWS cookies will require HTTPS, `COOKIE_SAME_SITE=none`, and browser compatibility checks; use same-site domains when possible.

GitHub Actions tests mock MongoDB operations: **they do not prove Atlas Free transactions, server memory usage or 250-way concurrency**. Complete real database integration and staging load tests before any actual exam.
