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
