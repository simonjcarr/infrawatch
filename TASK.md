# TASK.md — Current Session

## Session Goal
Complete Phase 0: auth middleware, user management UI, RBAC enforcement, feature flags, and licence scaffold.

## Scope

**In scope:**
- `middleware.ts` — protect dashboard routes, redirect unauthenticated to `/login`, redirect users without instance to `/onboarding`
- User management UI — list users in instance, invite by email, change role, deactivate
- Feature flag system — server-side `hasFeature(session, feature)` based on licence tier
- Licence key validation scaffold — offline-capable signed JWT with bundled public key
- System settings page — instance name, licence key entry
- Profile page — change name, change password, setup/remove TOTP
- Run Drizzle migrations (`drizzle-kit push` against a live DB or generate migration files)
- `npm run build` must pass with zero errors and zero lint warnings

**Out of scope:**
- Agent, gRPC, ingest service — Phase 1
- Monitoring, alerts — Phase 2
- Any enterprise SSO/SAML/OIDC — Phase 6
- Team / resource group tags (nice to have but defer to Session 3 if complex)

## Definition of Done
- [ ] Unauthenticated users cannot access any `/dashboard/*` route
- [ ] Users without an `instance_id` are redirected to `/onboarding` after login
- [ ] Admin can view list of team members
- [ ] Admin can invite a user by email (creates a pending invite record)
- [ ] Admin can change a user's role
- [ ] `hasFeature(session, 'sso')` returns false on community tier
- [ ] Licence key field exists in settings; entering a valid/invalid key shows feedback
- [ ] Profile page allows name change and password change
- [ ] TOTP setup flow is reachable from profile page
- [ ] `npm run build` passes with zero errors and zero lint warnings
- [ ] No `any` types in TypeScript

## Key Files To Create/Modify
```
apps/web/
├── middleware.ts                          # NEW — route protection
├── lib/
│   ├── auth/
│   │   └── session.ts                     # NEW — server-side session helper
│   ├── features.ts                        # NEW — feature flag functions
│   ├── licence.ts                         # NEW — licence key validation
│   └── actions/
│       ├── users.ts                       # NEW — invite, update role, deactivate
│       └── settings.ts                    # NEW — update instance, save licence key
├── app/(dashboard)/
│   ├── team/
│   │   └── page.tsx                       # MODIFY — real team management UI
│   ├── settings/
│   │   └── page.tsx                       # MODIFY — real settings UI
│   └── profile/
│       └── page.tsx                       # NEW — profile + TOTP
└── components/
    └── shared/
        └── feature-gate.tsx               # NEW — component that hides UI based on licence
```

## After This Session
Update PROGRESS.md:
1. Check off completed Phase 0 items
2. Record any new library choices or patterns
3. Update "What The Next Session Should Build" with Session 3 scope (Go agent scaffold)

---

## Session History

| Session | Goal | Status |
|---|---|---|
| 1 | Monorepo + Next.js scaffold + auth + Docker Compose | 🟢 Complete |
| 2 | User management, roles, teams, feature flags, licence scaffold | 🟡 In progress |
| 3 | Go agent scaffold + proto definitions + gRPC ingest | ⬜ Pending |
| 4 | Agent registration flow + approval UI + heartbeat | ⬜ Pending |
| 5 | Redpanda integration + metrics consumer + TimescaleDB | ⬜ Pending |
| 6 | Host inventory UI + real-time status | ⬜ Pending |
| 7 | Check definition system + check types | ⬜ Pending |
| 8 | Alert rules + alert state machine | ⬜ Pending |
| 9 | Notification channels (email/webhook/Slack) | ⬜ Pending |
| 10 | Certificate discovery + inventory UI | ⬜ Pending |
| 11 | Certificate expiry alerting + CSR workflow | ⬜ Pending |
| 12 | Service accounts + SSH keys + LDAP | ⬜ Pending |
| 13 | Air-gap bundlers (Jenkins, Docker, Ansible, Terraform) | ⬜ Pending |
| 14 | Runbook library + scheduled tasks | ⬜ Pending |
| 15 | Enterprise: SSO (SAML/OIDC) | ⬜ Pending |
| 16 | Enterprise: Audit log + compliance packs | ⬜ Pending |
