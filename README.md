# Quiz Hub Backend

Simple Node.js + Express + MongoDB Atlas examination API. Code style follows Rakhshinda Art: **one `src/app.js` entry point**, small controllers, centralized models, validation and route files.

**Current status:** Backend foundation, admin auth, admin quiz/question management and admin **exam slot scheduling**. Not ready for a live exam: student eligibility, secure attempts, autosave, grading, result pagination and concurrency tests are still needed.

## Setup

1. Node.js 22+, `npm install`.
2. Copy `.env.example` to `.env`, set `MONGODB_URI`, `CORS_ORIGINS`, `JWT_SECRET`, `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
3. Rotate any previously shared MongoDB password. URL-encode URI password special characters and configure Atlas IP access.
4. `npm run db:check`, `npm run db:seed`, `npm run dev`, `npm test`.
5. Commit the generated `package-lock.json` before a production deployment.

## Admin API (requires secure admin session except login)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/admin/auth/login` | Admin login |
| GET | `/api/v1/admin/auth/me` | Current admin |
| POST | `/api/v1/admin/auth/logout` | Logout |
| GET | `/api/v1/admin/quizzes` | Summaries (no answer keys) |
| POST | `/api/v1/admin/quizzes` | Create |
| GET | `/api/v1/admin/quizzes/:id` | Full private quiz |
| PUT | `/api/v1/admin/quizzes/:id` | Edit only before publishing |
| PATCH | `/api/v1/admin/quizzes/:id/publish` | Publish |
| GET | `/api/v1/admin/slots?quizId=...` | Slots for a quiz |
| POST | `/api/v1/admin/slots` | Schedule new slot |
| PATCH | `/api/v1/admin/slots/:id` | Edit future slot |

Create slot example:

```json
{
  "quizId": "507f1f77bcf86cd799439011",
  "name": "Slot 1",
  "startsAt": "2026-11-21T09:00:00+05:00",
  "endsAt": "2026-11-21T10:00:00+05:00",
  "capacity": 250
}
```

Dates are stored in UTC in MongoDB. Include timezone offsets in requests (Pakistan: `+05:00`).

Slots cannot overlap for the same quiz, and cannot be edited after starting. **Capacity is metadata for now; it will be enforced by the attempt module.** Scheduling alone does not verify student identity. Student login/signup is not planned, but the secure student-entry method and roster policy still need agreement before attempt issuance.

No new dependencies, Redis, workers or microservices. AWS and frontend migration are deferred.
