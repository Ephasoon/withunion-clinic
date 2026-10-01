# WithUnion Clinic Management System

Phase 2 foundation. No clinical UI yet — this is auth, RBAC, database
migrations, config, logging, validation, and testing scaffolding only,
per the approved Phase 1 blueprint (`docs/phase1-discovery.md`).

## Structure

```
withunion-clinic/
├── server/                 Node.js + TypeScript + Express API
│   ├── src/
│   │   ├── config/         env loading, db pool
│   │   ├── db/migrations/  node-pg-migrate migrations
│   │   ├── middleware/     auth, rbac, validation, error handling, logging
│   │   ├── modules/
│   │   │   ├── auth/       login, logout, password reset, sessions
│   │   │   ├── users/      user CRUD (owner-only), self profile
│   │   │   └── roles/      role constants + permission table
│   │   ├── utils/
│   │   ├── types/
│   │   ├── app.ts          Express app assembly (no listen())
│   │   └── server.ts       entrypoint
│   ├── tests/               Jest + Supertest
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
├── nginx/
│   └── nginx.conf.example
├── docker-compose.yml
├── docs/
│   └── phase1-discovery.md  (copy of the approved blueprint)
└── README.md
```

## Setup (local development)

```bash
cd server
cp .env.example .env      # fill in real values
npm install
npm run migrate:up        # run PostgreSQL migrations
npm run dev                # start API with reload
npm test                   # run auth/RBAC test suite
```

Tests run against a separate database (`TEST_DATABASE_URL`, which must name a `*_test` database) so they never write into dev data. Locally that database lives on a private, test-only PostgreSQL server on port 5433, run under your own OS account (no admin rights needed). One-time setup:

```bash
initdb -D ~/pgdata/withunion-test -U postgres -W -A scram-sha-256 -E UTF8
# then append to ~/pgdata/withunion-test/postgresql.conf:
#   port = 5433
#   listen_addresses = 'localhost'
pg_ctl -D ~/pgdata/withunion-test -l ~/pgdata/withunion-test.log start
psql -h localhost -p 5433 -U postgres -c "CREATE ROLE withunion LOGIN PASSWORD '<same as TEST_DATABASE_URL>'"
psql -h localhost -p 5433 -U postgres -c "CREATE DATABASE withunion_clinic_test OWNER withunion"
```

It is not a system service, so start it before running tests (and after a reboot) with the `pg_ctl ... start` line above; stop it with `pg_ctl -D ~/pgdata/withunion-test stop`.

`npm test` migrates the test database (`npm run migrate:test`) before running the suite. Vitest refuses to start if `TEST_DATABASE_URL` is unset or doesn't end in `_test`.

`npm test` is a wrapper script (`scripts/run-tests.mjs`) and ignores extra arguments, so `npm test -- <file>` won't target one file — run a single file directly with `npx vitest run tests/<file>.test.ts`.

## What exists after Phase 2

- Working PostgreSQL schema for: users, roles, sessions, audit_logs
  (the identity/foundation tables — clinical tables land in Phase 3+).
- Login → session cookie → authenticated request → role-checked route,
  end to end, with tests proving:
  - a valid login succeeds and sets a session,
  - an invalid login is rejected,
  - a deactivated user cannot log in,
  - a role without permission is rejected by a protected route (403),
  - an unauthenticated request is rejected (401).
- Centralized error handling that never leaks stack traces or raw DB
  errors to the client.
- Structured request/error logging.
- Environment-based configuration with no secrets committed to git.
- Docker Compose for local Postgres + API, and an Nginx reverse-proxy
  config for production, matching the Phase 1 infrastructure diagram.

## What does NOT exist yet (by design)

No patient, visit, queue, nursing, consultation, lab, pharmacy,
inventory, billing, or dashboard code. Those are Phase 3 onward, built
on top of this verified foundation.
