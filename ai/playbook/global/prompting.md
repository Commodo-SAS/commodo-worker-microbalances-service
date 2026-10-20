# Prompting Guidelines

## Gold Standard
1. **Context Loading:** Always load `ai/contexts/global/company-context.md` and `ai/contexts/global/stack-context.md`.
2. **Specific Role:** "You are a Senior NestJS Backend Engineer..."
3. **Chain of Thought:** "Think step by step..." (or use models that do this natively).
4. **Reference Files:** Don't describe code; paste the file paths or content.

## Efficiency & Cost (Official Guidelines)
- **Planning:** Use **Gemini Pro / High / Flash** (Max Context, Lower Cost).
- **Implementation:** Use **Claude Code (Sonnet / Opus)** (Precision).
- **Tests:** Use **Claude Code / Gemini** (Balance).
- **QA:** Use **TestSprite** (Free Tier).
- **Constraint:** Using expensive models without justification is considered a bad practice. Efficiency is a mandatory KPI.

## Common Patterns
### The "Refinement" Loop
1. Ask Agent to generate a plan.
2. User reviews plan.
3. User asks Agent to "Critique your own plan for edge cases".
4. Agent generates v2.
5. User approves.

### The "Test-First" Prompt
"Before writing implementation, write the Jest spec file for this requirement. Ensure it fails."
