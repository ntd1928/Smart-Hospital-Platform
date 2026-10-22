# Smart Hospital Platform

Read `docs/development/CONTEXT.md`, `CONTRIBUTING.md` and the assigned issue before changing code. Read `docs/architecture/UPSTREAM.md` before modifying extracted Medplum modules. See `docs/development/DOCUMENTATION.md` for public/private boundaries. Do not depend on ignored local notes for required setup or architecture.

Current delivery is weeks 5–6: local infrastructure, real authentication, three role views, users, Patient/Practitioner CRUD/search, basic Appointment API and AI research documentation. Scheduling workflows, EHR, cloud deployment and an operating AI assistant are future work.

Keep Medplum attribution and SPDX headers. Prefer the existing FHIR repository and authentication mechanisms. Never replace backend authorization with menu hiding. Do not add a second user database or authentication stack.

For the container demo, use `docker compose up --build -d --wait --wait-timeout 600`; see `docs/development/DOCKER.md` for seed, persistence and testing. For source development, use Node from `.nvmrc`; run `npm ci`, `npm run services:up` (PostgreSQL/Redis only), `npm run seed`, `npm run dev:server` and `npm run dev:app`. Do not run both modes on the same ports. Verify with `npm run build`, `npm run typecheck`, `npm test`, `npm run test:api` and `npm run test:e2e`. Integration tests require the real server, PostgreSQL and Redis. Record exact environment and outcomes, including failures and blocked checks.

Use one owner per issue and feature branches. Record verification and unfinished work on the issue/PR; update public context after architectural changes. Keep sensitive planning and report drafts in the team's private workspace. Do not backdate commits or describe inherited code as original team work. Do not commit credentials, tokens, local databases or runtime logs. CI configuration does not prove a hosted run passed; report local and hosted results separately.
