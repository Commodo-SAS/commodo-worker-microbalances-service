# Playbook Global de Agentes — Commodo AI-First

## Flujo Oficial

General Agent
→ Agent Planning
→ Agent Code
→ Agent Tests
→ Agent QA
→ Agent Security
→ Agent Performance
→ Agent CI & CD
→ Agent Reviewer
→ Agent Release
→ Agent Docs

> **Autorización por etapa.** El flujo describe el orden y los roles posibles, no una
> ejecución automática. Según [AGENTS](../../../AGENTS.md), cada etapa (crear tests,
> documentar, ejecutar validaciones) requiere indicación explícita del developer; una petición de
> implementar código no autoriza las siguientes. Al terminar cada etapa se reportan los pendientes.

---

## Agentes Oficiales

### General Agent
Orquesta el modelo AI-First y gobierna el workspace.

### Agent Planning
Diseña la solución técnica antes del código.

### Agent Code Implementation
Implementa exactamente lo planeado.

### Agent Tests
Crea pruebas automáticas.

### Agent QA
Valida funcionalidad y reglas de negocio.

### Agent Security
Revisa permisos y datos sensibles.

### Agent Performance
Evalúa carga, jobs y escalabilidad.

### Agent CI & CD
Gobierna integración y despliegue continuo: quality gates, pipelines, release y rollback.

### Agent Reviewer
Aprueba o bloquea merges.

### Agent Release
Controla despliegues y rollback.

### Agent Docs
Mantiene documentación viva.

---

## Overlays por Repo

### Backend
- Arquitectura hexagonal obligatoria
- Transacciones DB explícitas
- Eventos post-commit

### Frontend
- Sin lógica financiera
- Manejo claro de estados de error

### Mobile
- Validaciones de input
- Manejo offline

### Pay
- Flujos de pago críticos
- Webhooks y conciliación

---

## Modelos Recomendados

| Agente        | Modelo |
|---------------|--------|
| Planning      | Gemini Pro / Flash |
| Code          | Claude |
| Tests         | Claude / Gemini Pro / GPT |
| QA            | Gemini Pro / GPT |
| Security      | Gemini Pro / GPT |
| Performance   | Gemini Pro / GPT |
| CI & CD       | Claude / Gemini Pro / GPT |
| Reviewer      | Gemini Pro / GPT |
| Docs          | Gemini Pro / GPT |

---

## KPIs
- Bugs post-release
- Tiempo humano ahorrado
- Tokens usados vs valor
- Pipeline success rate
- Time to production
