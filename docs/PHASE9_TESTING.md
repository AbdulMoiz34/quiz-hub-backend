# Real MongoDB reliability and load testing

> **Current guide for the email-based, slot-free Quiz Hub API.** Historical November 20 investigations of the retired roll/seat allocator are summarized below for context only. Do not reuse the old slot-based instructions.

## Safety

- Use Node.js 22+ and install dependencies with `npm install`.
- Use a **dedicated MongoDB database named `quiz_hub_test`**, not the production database. Tests enforce this name before fixture writes.
- Set `TEST_MONGODB_URI` privately. Never commit it or paste its credentials into tickets.
- If your test database already has obsolete unique roll/seat indexes, finish its old active attempts, back it up, and perform the index migration against **that test database** with `MONGODB_URI` temporarily pointing to `quiz_hub_test`. Do not conflate `TEST_MONGODB_URI` (for tests) with `MONGODB_URI` (for migration/app).
- Do not infer live exam capacity from mocked GitHub Actions tests.

PowerShell example:

```powershell
$env:TEST_MONGODB_URI="mongodb+srv://USER:PASSWORD@HOST/quiz_hub_test?retryWrites=true&w=majority"
npm run test:db
npm run test:races
npm run test:journey
npm run test:load
node src/scripts/testExamJourney.js --users=300
Remove-Item Env:TEST_MONGODB_URI
```

## Coverage and interpretation

| Command | Purpose |
| --- | --- |
| `npm test` | Fast mocked API/unit tests for email uniqueness, validation, submissions, violations, admin delete and result filters |
| `npm run test:db` | Five actual HTTP start → current → draft → submit journeys with real MongoDB |
| `npm run test:races` | Real autosave-vs-submit and duplicate-submit race regressions |
| `npm run test:journey` | Real HTTP/DB registration, expiry, parallel duplicate-email starts, violations, admin deletion and reattempt |
| `npm run test:load` | 250 simulated HTTP student journeys with unique emails |
| `node src/scripts/testExamJourney.js --users=200` | 200 simultaneous clients |
| `node src/scripts/testExamJourney.js --users=300` | 300 simultaneous clients |
| `node src/scripts/testExamJourney.js --users=250 --transport-only` | No-database HTTP burst diagnostic |

Each integration test creates an isolated published quiz and temporary attempts, verifies the number of persisted results and scores, then deletes its own fixtures. The basic journey uses one MCQ; it is **not** a realistic large quiz. Add manual/staging coverage with 20–50 questions, sustained autosaves, mixed latency and reconnects.

`--ramp-ms=5000` spreads starts across five seconds. It is useful diagnostically, **not proof** that 250 clients can start simultaneously. A green test must show all requested journeys completed and the database contains exactly the expected attempts and final submissions. Report failures and p95 latencies, not just successful counts.

## Release checklist

- [ ] All active old slot attempts finished; backups and correct MongoDB index migration completed
- [ ] `npm run check` and `npm test` pass
- [ ] `npm run test:db`, `npm run test:races` and `npm run test:journey` pass with an isolated real MongoDB
- [ ] 200, 250, and 300 client bursts pass repeatedly, no lost answers or duplicates
- [ ] Real-browser registration, 60-minute countdown, recover after refresh/disconnect and cutoff tested
- [ ] Violation event retries, threshold termination and post-termination write blocking tested
- [ ] Admin deletes an active/submitted/expired/terminated attempt; old token rejected; email can start again
- [ ] Admin results/CSV/manual review and the updated frontend verified
- [ ] HTTPS/CORS/cookies, process restarts, expiry finalization, secrets, backups and monitoring verified

**Stop-ship:** Missing/duplicated attempt records, lost answer snapshots, late unauthorized edits, leaked answer keys, broken reattempt reset, or unexplained load-test errors.

## Historical diagnostic evidence — November 20, 2026

Earlier slot-based builds encountered MongoDB `WriteConflict` when writing a shared Slot document. A later unique-seat version removed that shared-document counter, but at least one 250-student run still completed only **232/250**. Eighteen `start:ECONNREFUSED` failures were observed and successful starts were unusually slow. Those results were **not a pass**.

The new email-only design removes seat allocation and shared capacity entirely. However, this change alone does **not** prove that those HTTP/TCP connection failures have disappeared. Repeat the isolated transport-only test and the real 250/300-user bursts, then identify any remaining error type before tuning MongoDB pools, retries, listener backlog or hosting limits. Keep credentials and signed cookies out of diagnostic logs.
