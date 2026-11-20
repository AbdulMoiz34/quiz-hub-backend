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
