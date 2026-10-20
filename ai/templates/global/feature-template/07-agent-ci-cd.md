# 07 CI & CD (Agent CI & CD)

**Agent:** CI & CD
**Status:** APPROVED | REJECTED

## Contexto (copiar desde 00-brief)
- **Producto / Módulo**:
- **Repo**: backend | frontend | mobile | pay
- **Branch destino**: develop | main | release/*

---

## 1. Hallazgos del Repo

### Scripts disponibles
| Script | Comando | Existe |
|--------|---------|--------|
| Lint | `TODO` | ✅ / ❌ |
| Format | `TODO` | ✅ / ❌ |
| Build | `TODO` | ✅ / ❌ |
| Unit Tests | `TODO` | ✅ / ❌ |
| Integration Tests | `TODO` | ✅ / ❌ |

### CI/CD actual
- **Plataforma**: GitHub Actions / GitLab CI / Jenkins / Otro
- **Workflows detectados**: ...
- **Ambientes**: dev / qa / staging / prod

---

## 2. Gaps de Calidad

| Gap | Severidad | Acción requerida |
|-----|-----------|------------------|
| ... | Alta/Media/Baja | ... |

---

## 3. Pipeline Recomendado

```
PR Created
  → lint/format
  → build
  → unit tests
  → [integration tests]
  → [security checks]
  → ✅ Ready for Review

Merge to develop
  → build
  → deploy to dev
  → smoke tests

Merge to main / release
  → build
  → deploy to staging
  → QA approval (manual gate)
  → deploy to prod
  → health checks
```

---

## 4. Gates para PR (qué bloquea merge)

- [ ] Lint/format pasa
- [ ] Build exitoso
- [ ] Tests unitarios pasan (cobertura >= X%)
- [ ] Sin vulnerabilidades críticas (si aplica)
- [ ] Al menos 1 approval de reviewer

---

## 5. Estrategia de Deploy y Rollback

### Deploy
- **Estrategia**: Rolling / Blue-Green / Canary
- **Feature flags**: Sí / No (especificar cuáles)
- **Ventana de deploy**: Horario permitido

### Rollback
- **Mecanismo**: Redeploy versión anterior / Revert commit / Feature flag off
- **Tiempo estimado de rollback**: X minutos
- **Responsable**: DevOps / Tech Lead

---

## 6. Checklist Final

### Pre-merge
- [ ] Pipeline CI pasa en todas las etapas
- [ ] Code review aprobado
- [ ] Tests de regresión ejecutados
- [ ] Documentación actualizada (si aplica)

### Pre-deploy
- [ ] Migración de DB revisada (si aplica)
- [ ] Variables de entorno configuradas
- [ ] Rollback plan documentado
- [ ] Comunicación a stakeholders

---

## Riesgos & Mitigaciones
| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| ... | Alta/Media/Baja | Alto/Medio/Bajo | ... |

---

## Evidencia requerida
- Completar `evidence/ci-cd.md` con logs de pipeline y screenshots.

---

## Reglas del Agente
❌ No inventar scripts: si no existen, usar `TODO: definir comando real`
❌ No proponer CD agresivo sin rollback
❌ No mezclar ambientes
✅ Priorizar seguridad, repetibilidad y trazabilidad
