# Definition of Done (Global)

For any feature or fix to be considered "Done" in the AI-First workflow.

Execution policy: the agent creates tests, writes documentation and runs checks **only when the developer
explicitly asks for each activity** (see [AGENTS](../../../AGENTS.md)). This list defines what must be true
before the PR/QA handoff; it is not an automatic instruction to run every command. Items not yet executed are
reported as pending, never as passed.

## 1. Documentation
- [ ] Requirement and scope are recorded (`00-brief.md` of the feature template, or the Jira ticket).
- [ ] The design decision is documented (`01-architecture.md`, or an ADR when it breaks a rule).
- [ ] The feature is documented in `docs/<feature-name>/` and open items are in `docs/todo/<feature-name>.md`.
- [ ] Code comments in English; JSDoc/TSDoc where complex or non-obvious.

## 2. Code Quality
- [ ] No ESLint errors on the affected files (run when validation is requested).
- [ ] Formatting applied on the affected files (run when validation is requested).
- [ ] No hardcoded secrets. Configuration is read only through `EnvironmentUtils` getters
      (`ConfigService` only inside the loader).

## 3. Testing
- [ ] **Unit tests:** behavior and risk of the change covered by Jest (`.spec.ts`).
- [ ] **Integration/e2e tests:** applicable endpoints or flows covered, proportional to the risk.
- [ ] Focused typecheck first, then the relevant tests, when validation is requested.
- [ ] Applicable coverage requirement met without trivial tests written to inflate it
      (see [testing guidelines](../../rules/testing-guidelines.md)).

## 4. Security
- [ ] External input validated at runtime (DTOs with `class-validator`, HTTP whitelist).
- [ ] Auth guards applied where the endpoint requires them (`@UseGuards(JwtAuthGuard)`).

## 5. Handoff
- [ ] Final report separates: implementation, tests written, tests executed, checks and documentation.
- [ ] PR includes ticket, impact, tests/CI, migrations, DevOps dependencies, UAT steps, risks and recovery.
