# Quality Gates

These are the requirements the pipeline and the PR must satisfy. The agent runs them locally only when the
developer explicitly asks for validation (see [AGENTS](../../../AGENTS.md)); do not lower or skip a gate to get a green result.

## Minimum Requirements
- **Build:** Must compile (`pnpm build`) without errors.
- **Lint:** Zero warnings on modified files.
- **Test Coverage:** Goal of >60% line coverage on *new* business logic.
- **Performance:** Endpoints must respond < 500ms (p95) for standard loads.

## Testing Stack (Backend)
- **Unit:** Jest
- **E2E:** Supertest + Jest
- **Mocking:** `jest.mock` or `@golevelup/ts-jest`
