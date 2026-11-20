# Quiz Hub Backend

Express.js + MongoDB Atlas examination API. **Single `src/app.js` entry point**, following the simple layering in the Rakhshinda Art backend.

> This PR includes Phase 1 + Phase 2 (single-admin auth). **Exams, attempts, autosave, grading, results and load tests do not exist yet. This backend is not ready for tomorrow's examination.**

## Structure

```
src/
  app.js                      # Express configuration, routes and server startup
  config/                     # Database, environment, admin cookie
  controllers/auth/           # Small admin login / me / logout handlers
  middlewares/                # Auth, origin check, Joi validator, errors
  models/                     # Mongoose models
  routes/admin/               # Admin API routes
  validations/                # Joi request schemas
  utils/                      # Response and JWT helpers
  seeds/adminSeed.js          # One-time seed
  scripts/check-db.js         # Database connectivity check
test/                         # Unit and API contract tests
```

## Setup

1. Install Node.js 22 or newer.
2. `npm install` (commit the generated `package-lock.json` before production deployment).
3. Copy `.env.example` to `.env`. Never commit secrets.
4. Set `MONGODB_URI`, exact `CORS_ORIGINS`, a random `JWT_SECRET` (32+ characters), and a strong `ADMIN_EMAIL`/`ADMIN_PASSWORD` (12-72 bytes).
5. Set a **newly rotated Atlas password** because old credentials were shared in chat. URL-encode special characters in URI passwords, and grant Atlas Network Access only to your current IP.
6. `npm run db:check`
7. `npm run db:seed` (does not overwrite an existing admin).
8. `npm run dev` or `npm start`
9. `npm run check` and `npm test`

Generate a JWT secret locally:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

## APIs

| Method | Endpoint | Access |
|---|---|---|
| GET | `/api/v1/health` | Public |
| GET | `/api/v1/ready` | Public, database connectivity |
| POST | `/api/v1/admin/auth/login` | Email + password |
| GET | `/api/v1/admin/auth/me` | Admin session |
| POST | `/api/v1/admin/auth/logout` | Admin session |

Login returns `{ success, message, data: { id, email } }` and an HttpOnly cookie. Use `credentials: "include"` in the browser. POST login/logout requests require an exact allowed `Origin` header.

For cross-site Vercel / AWS requests use HTTPS with `NODE_ENV=production`, `COOKIE_SAME_SITE=none`, and exact frontend origin. Prefer same-site custom domain + `lax` when feasible.

## Roadmap

1. Foundation + single admin: done here
2. Exam and question management
3. Students and six exam slots, no signup/login
4. Attempt validation + server-side deadlines
5. Answer autosave, reliable submissions, violations
6. Trusted scoring and admin results with real MongoDB pagination
7. 250-concurrent-user staging test, frontend migration, AWS deployment

No Redis, Docker, microservices or third-party integrations have been added.
