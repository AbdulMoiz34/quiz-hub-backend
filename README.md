# Quiz Hub Backend

Node.js 22 + Express + MongoDB Atlas — one modular monolith. Code style follows the existing Rakhshinda Art backend: a single `src/app.js`, explicit routes, small controllers, Joi validations, Mongoose models, seed scripts and minimal shared helpers.

**Status:** Foundation, single-admin authentication and admin-side quiz creation. **Not ready for a real exam** until student eligibility, exam attempts, autosave, scoring, results and 250-user load testing exist.

## Local setup

1. `npm install` (commit generated `package-lock.json` before production).
2. `cp .env.example .env` (on PowerShell: `Copy-Item .env.example .env`).
3. Configure MongoDB Atlas connection, exact CORS origins, a 32+ character random `JWT_SECRET` and private admin credentials. Rotate any previously shared database password; URL-encode password special characters.
4. `npm run db:check` then `npm run db:seed` (safe to rerun, does not overwrite existing admin).
5. `npm run dev`, `npm run check`, `npm test`.

## Endpoints

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/health` | Public |
| GET | `/api/v1/ready` | Public |
| POST | `/api/v1/admin/auth/login` | Admin password |
| GET | `/api/v1/admin/auth/me` | Admin |
| POST | `/api/v1/admin/auth/logout` | Admin |
| GET | `/api/v1/admin/quizzes` | Admin; summaries only |
| POST | `/api/v1/admin/quizzes` | Admin |
| GET | `/api/v1/admin/quizzes/:id` | Admin; full question bank |
| PUT | `/api/v1/admin/quizzes/:id` | Admin; unpublished only |
| PATCH | `/api/v1/admin/quizzes/:id/publish` | Admin; only `{ "isPublished": true }` |

All admin responses use `{ success, message, data }`. Admin cookie is HttpOnly; browser requests use `credentials: "include"`. Admin POST/PUT/PATCH requests require an allowed `Origin`. For cross-site Vercel/AWS, HTTPS + `COOKIE_SAME_SITE=none` in production may be required; same-site subdomains with `lax` are preferable.

## Security and scope

Quiz model embeds questions and their correct answers in one MongoDB document for simplicity; **only admin-authenticated routes expose them**. Student question delivery must be added later through a verified attempt API which explicitly removes answer keys and private coding test cases. No public question bank API has been added.

Editing is blocked after publishing. Publishing currently activates a quiz for future student/session flows; closing or unpublishing during active attempts needs rules in the upcoming attempt module. No grading or sandboxed code execution is implemented.

No extra packages, Redis, sockets, queues or microservices.
