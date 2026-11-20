# Quiz Hub Backend

Node.js 22 + Express + Mongoose + MongoDB Atlas. One modular monolith.

## Development phases

1. Foundation: Express, MongoDB, error handling, health checks
2. **Admin authentication: one seeded admin, login, logout, /me** (this branch)
3. Exam/question management
4. Student eligibility + exam slots (no student signup/login)
5. Attempts, deadlines, autosave + submissions
6. Scoring, results, pagination + exports
7. Staging load tests, frontend integration, AWS deployment

**Not ready for live exams until the remaining modules and tests are completed.**

## Local setup

1. Install Node.js 22+, then `npm install`.
2. Copy `.env.example` to `.env` (PowerShell: `Copy-Item .env.example .env`).
3. In MongoDB Atlas, create or rotate your database user's password; grant access only to the required `quiz_hub` database. Add your current IP in Atlas **Network Access**. Do not put passwords in GitHub or chat.
4. Set `MONGODB_URI` in `.env`. A URI password containing `#`, `@`, `/` or other special characters must be URL-encoded. In Node: `encodeURIComponent("your-new-password")`. Include `/quiz_hub` in the URI.
5. Generate a random `JWT_SECRET` with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Paste that output into the private `.env`.
6. Set your own `ADMIN_EMAIL` and a unique `ADMIN_PASSWORD` (12–72 UTF-8 bytes) in `.env`. Do not leave placeholders.
7. Run `npm run db:check`; when it succeeds, run `npm run seed:admin`. Seeding **does not overwrite an existing admin**.
8. Run `npm run dev`, `npm run check`, and `npm test`. The server starts on `http://127.0.0.1:5000` by default.
9. Run `npm install` to generate `package-lock.json`; commit the lockfile before a production release so CI can switch to `npm ci`.

## Endpoints

| Method | URL | Access |
| --- | --- | --- |
| GET | `/api/v1/health` | Public liveness |
| GET | `/api/v1/ready` | Public DB readiness |
| POST | `/api/v1/admin/auth/login` | Admin email + password; rate limited |
| GET | `/api/v1/admin/auth/me` | Admin cookie required |
| POST | `/api/v1/admin/auth/logout` | Admin cookie required |

Example login request (use your **real private credentials** locally):

```http
POST /api/v1/admin/auth/login
Origin: http://localhost:5173
Content-Type: application/json

{"email":"your-admin@example.com","password":"your-own-strong-password"}
```

Admin session is an HttpOnly JWT cookie, valid for 12 hours; logout invalidates previous sessions. For browser requests, use `credentials: "include"`. Every state-changing admin API requires an allowed `Origin` header as additional CSRF protection.

For Vercel frontend + different-site AWS API later, set exact HTTPS frontend origin under `CORS_ORIGINS`; use `NODE_ENV=production`, `COOKIE_SAME_SITE=none` if cross-site cookies are required. Prefer same-site custom domains and `lax` when possible. Nginx should expose HTTPS publicly while Express listens privately on 127.0.0.1.

Current MongoDB configuration uses one shared 15-connection Mongoose pool. No Redis, queue, microservice, or AWS setup at this phase.
