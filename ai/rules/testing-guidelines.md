# Calidad verificable

## Etapa de validación local

Crear o modificar tests requiere indicación explícita del usuario. Documentar también
requiere indicación explícita independiente. Implementar código no autoriza esas etapas.
Al terminar la implementación y en cada entregable, comunicar por separado pendientes
de creación de tests, ejecución de pruebas, validaciones y documentación según AGENTS.
Sin solicitud documental, informar en la conversación sin crear archivos de pendientes.

La ejecución local de pruebas, typecheck, ESLint/lint, formato, checks documentales,
build, cobertura, E2E y Docker requiere indicación explícita del usuario según
[AGENTS](../../AGENTS.md). Implementar o crear tests no autoriza ejecutarlos.
No pedir permiso como paso rutinario: informar que los controles no fueron ejecutados.
La revisión por lectura y diff sigue siendo parte del trabajo.

Cuando el usuario solicite validar, seleccionar controles proporcionales al alcance:
primero typecheck focalizado para código tipado, después pruebas afectadas y los demás
controles pertinentes. No ampliar a toda la suite o build sin necesidad dentro de ese
alcance. No repetir éxitos sin cambios relevantes. Cortar un typecheck tras cinco minutos
sin salida y registrar timeout, nunca éxito. Esta política no modifica CI automático.
Typecheck, lint, pruebas y build son controles distintos. Transpile-only o webpack exitoso no los reemplazan.

## Contrato de scripts objetivo

| Comando | Responsabilidad |
|---|---|
| pnpm typecheck | Tipos, sin emitir artefactos |
| pnpm lint | ESLint sin modificar archivos, cero warnings |
| pnpm format:check | Formato sin escribir |
| pnpm format | Formateo explícito |
| pnpm test | Jest determinista |
| pnpm test:cov | Cobertura con exclusiones explícitas |
| pnpm test:integration | Integración con dependencias efímeras y aisladas |
| pnpm build | Compilación productiva reproducible |
| pnpm check:docs | Links locales y perfil/índice coherentes |

Los scripts están implementados salvo test:integration, aún pendiente; consultar el perfil antes de ejecutarlos. No añadir scripts que siempre devuelvan éxito o impriman "desactivado".

## Estrategia

Estas pautas aplican cuando se solicite crear tests o ejecutar pruebas; no autorizan
esas acciones por el solo hecho de modificar código.

- Jest y *.spec.ts junto al comportamiento; mocks por puertos y pruebas observables, sin acoplarse a métodos privados.
- Mantener el conjunto mínimo que cubra resultados y riesgos diferentes. No probar getters triviales, defaults, wiring interno ni matrices de validadores externos; un caso representativo basta cuando las variantes tienen el mismo efecto observable.
- Unitarias para reglas; integración para wiring/serialización/lifecycle; contratos para productor-consumidor y adaptadores.
- Dobles deterministas para proveedores; ninguna prueba normal envía notificaciones reales ni toca DB productiva.
- Comprobar errores, timeouts, retries, shutdown y ausencia de datos sensibles en logs.
- La cobertura es una señal secundaria y se consulta aparte. No añadir pruebas solo para alcanzar un porcentaje; el umbral corporativo aplicable se conserva y las excepciones se acuerdan con responsable; no reducirlo unilateralmente.
- Evitar pruebas que solo reproduzcan implementación, snapshots indiscriminados y exclusiones para inflar cobertura.
- TypeScript strict en código propio nuevo; migrar legado incrementalmente. Problemas de tipos en shared-libs se reportan/corrigen allí, sin ocultarlos con any/ts-ignore global.

## CI objetivo

Instalación frozen, tipos, lint, formato, pruebas, build, controles de dependencias y validación de imagen. Checks requeridos por branch protection después de confirmar permisos/plan de GitHub.
Tests de integración con recursos aislados; no levantar infraestructura persistente en cada unit test. Evidencia enlazada al commit evaluado.

## Política de feedback rápido

No añadir gates completos a start:dev ni hooks bloqueantes. Jest usa SWC y typecheck independiente; ESLint es sintáctico con caché. Cobertura solo con test:cov/CI. Evidencia y tiempos reales en [P1](../../docs/plans/p1-evidence.md). Antes de cambiar bundler o añadir plugins, medir el coste; no reducir validaciones para simular velocidad.



## Política corporativa aplicable

Fuentes: [Pruebas, v2](https://avanadecapital.atlassian.net/wiki/spaces/CEH/pages/386793473) y [Metodología oficial](https://avanadecapital.atlassian.net/wiki/spaces/CEH/pages/397049857), revisadas el 2026-10-16.
La guía Pruebas mantiene mínimo 80% en servicios y dominio nuevos/modificados, junto con unitarias, integración crítica y E2E focalizadas. Cobertura no sustituye escenarios observables ni autoriza tests triviales.
No bajar el umbral ni excluir código para obtener verde. Excepciones justificadas requieren riesgo, controles compensatorios, responsable y aprobación según la metodología.
Pruebas E2E usan base local dedicada y fixtures deterministas; nunca DB staging. Validación integrada en ambiente autorizado es una actividad distinta, con alcance registrado.
Registrar comando, resultado, entorno, commit/versión y límites. El permiso local del agente para ejecutar controles no elimina estos requisitos de PR/QA.
