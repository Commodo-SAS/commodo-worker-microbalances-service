# Feature Template — Nueva Funcionalidad

Este template se usa para **implementar nuevas funcionalidades** con trazabilidad completa entre:
- requerimiento → arquitectura/plan → implementación → pruebas → validaciones (QA/Sec/Perf) → review final

## Cómo usar
1. Copia la carpeta `feature-template` a `docs/<nombre-feature>/` (ej: `docs/gift-vouchers/`), según
   [AGENTS](../../../../AGENTS.md). Reemplaza este `README.md` por el de la feature (punto de entrada) y enlaza
   desde allí sus pendientes en `docs/todo/<nombre-feature>.md`. Documentar requiere indicación explícita.
2. Completa en orden (solo los pasos que el developer haya autorizado):
   - `00-brief.md` (User / PM)
   - `01-architecture.md` (Agent Planning)
   - `02-agent-code.md` (Agent Code)
   - `03-agent-tests.md` (Agent Tests)
   - `04-agent-qa.md` (Agent QA)
   - `05-agent-security.md` (Agent Security)
   - `06-agent-performance.md` (Agent Performance)
   - `07-agent-ci-cd.md` (Agent CI & CD)
   - `08-review.md` (Agent Reviewer)
3. Adjunta evidencias en `evidence/` según la lista.

## Regla de oro
Si falta evidencia crítica para un agente, el estado debe quedar en **REJECTED / REWORK**.

