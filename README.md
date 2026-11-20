# Quiz Hub Backend

Modular-monolith REST API for the Quiz Hub examination platform, using Node.js 22, Express 5, MongoDB Atlas, Mongoose and Joi.

## Scope

- 250 simultaneous exam candidates per slot; six slots (~1,500 attempts).
- Student-facing flow has **no signup or login**; the exam-entry credential/session protocol is a later module. Roll number alone is not authentication.
- Admin will get authenticated access, indexed search, cursor pagination and complete CSV export.
- Private answer keys and idempotent final submissions are mandatory in later phases.

> Phase 1 builds the infrastructure only. It does **not** contain exam, grading or authentication APIs and is **not** ready for a live exam.

## Local setup

1. Install Node.js 22+.
2. Run `npm install`. Commit the generated `package-lock.json` before a production release. npm registry access was unavailable in the authoring environment.
3. Copy `.env.example` to `.env`. Replace the MongoDB connection URI and list exact allowed frontend origins under `CORS_ORIGINS`.
4. Run `npm run dev`, `npm run check` and `npm test`.

Never commit `.env` or any MongoDB credentials.

## Foundation endpoints

- `GET /api/v1/health`: process liveness, independent of database connectivity
- `GET /api/v1/ready`: returns HTTP 200 only when MongoDB is connected; otherwise HTTP 503

## Development roadmap

1. Backend foundation (this PR)
2. Admin authentication
3. Exam and question management
4. Student eligibility and slots
5. Attempts and enforced deadlines
6. Autosave, submission and violations
7. Trusted scoring and results publication
8. Admin dashboard: cursor pagination, search, statistics and export
9. Security and 250-concurrent-user staging tests
10. Frontend migration and AWS deployment

A single Express service and MongoDB are sufficient to begin. No Redis, queues or microservices without a validated need.
