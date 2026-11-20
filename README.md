# Quiz Hub Backend

Node.js 22 + Express 5 + MongoDB Atlas, simple modular monolith. One `src/app.js` entry point, Painting-style routes/controllers/models/validators/utils, and no Redis or new packages.

## Current modules

- Single seeded admin authentication
- Quiz/questions management
- Six-slot scheduling
- Student exam entry (name + numeric-only roll number), attempt session and refresh recovery
- Versioned answer autosave and idempotent final submission
- Trusted MCQ/True-False scoring, manual review for short-text/coding
- **Admin results listing, database cursor pagination, filters, statistics and CSV export**

**Not production ready:** The existing frontend still uses Firebase. Real Atlas integration tests, load tests with 250 concurrent students, production expiry scheduling, and deployment verification have not been completed. A successful GitHub Actions run is not evidence of a load-tested backend.

## Local setup

1. Install Node.js 22+ and run `npm install`. Commit the generated `package-lock.json` before deployment.
2. Copy `.env.example` to `.env`, set `MONGODB_URI`, `CORS_ORIGINS`, random `JWT_SECRET` and private admin credentials.
3. Rotate previously shared Atlas credentials. URL-encode special characters in URI passwords and allowlist only the necessary IP addresses.
4. Run `npm run db:check`, `npm run db:seed`, `npm run dev`, `npm test`.
5. Optional one-shot expiry cleanup: `npm run attempts:finalize` (not yet scheduled).

## Admin results

Requires admin authentication cookie (and browser credentials).

`GET /api/v1/admin/results?quizId=<24-character MongoDB ID>&limit=25`

Response:

```json
{
  "success": true,
  "message": "Results fetched",
  "data": {
    "items": [],
    "hasMore": false,
    "nextCursor": null
  }
}
```

For the next page, pass `cursor=<nextCursor>` with the same quiz and filters. `limit` defaults to 25, max 100. Ordering is **attempt creation order** (`_id` descending) so a new grade/submission cannot move records between pages. The list never fetches private answer arrays, question keys or internal session hashes.

Optional filters: `slotId` (24-digit hexadecimal ObjectId), `status` (`started|submitted|terminated`), `gradingStatus` (`ungraded|pending_review|graded`), `rollNo` (exact 1–25 ASCII digits; leading zeros preserved). Filters operate in MongoDB, not locally on one page. Use a new pagination cursor when filters change.

- `GET /api/v1/admin/results/stats?quizId=<id>` — counts **all attempts**, separating active, expired-but-not-finalized, submitted, terminated, graded and pending manual reviews. Optional `slotId`.
- `GET /api/v1/admin/results/export?quizId=<id>` — CSV of **all filtered attempts** regardless of the current page. Supports `slotId`, `status`, `gradingStatus`, `rollNo`. Streaming cursor with batch size 100 limits application memory. CSV escapes quotes and protects user-entered cells from spreadsheet formulas.
- `GET /api/v1/admin/attempts/:id` — full review of an individual attempt, including answers.
- `PATCH /api/v1/admin/attempts/:id/grade` — manual grading of coding/short-text answers.

The dashboard should load the results page and statistics independently; do not compute total counts from a page of 25 rows or fetch all 1,500 answers for listing. CSV is admin-only, with `Cache-Control: no-store`.

## Remaining release work

1. Test real MongoDB transactions, unique indexes and failure/retry scenarios.
2. Connect and migrate frontend from Firebase, including numeric-only roll validation, autosave and admin pages.
3. Test 250 simultaneous starts, autosaves, final submits and result lookups.
4. Confirm Atlas Free cluster and AWS limits/monitoring, schedule expiry finalization and backups.

Roll number alone **cannot verify identity**; open enrollment allows a first claimant to impersonate another roll number. If stronger identity protection is required, use an individual exam code or supervised verification.
