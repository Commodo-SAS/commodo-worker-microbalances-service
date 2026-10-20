# Alineación del skeleton con Confluence

Revisión documental: **2026-10-20**. Reglas locales **2.6.0**. Las fuentes no releídas conservan su versión histórica de 2026-10-16.
Este registro sustituye la antigua evaluación de notifications copiada al skeleton; no acredita ejecución, CI, despliegue ni release de este repositorio.

## Fuentes leídas

| Página canónica | Versión Confluence consultada | Aplicación local |
|---|---|---|
| [Cultura y metodología del Desarrollo](https://avanadecapital.atlassian.net/wiki/spaces/CEH/pages/386465793) | 13 (2026-10-20) | AGENTS 2.6.0, Docker, ubicación de repos y contratos 4.0.0 |
| [Metodología oficial de ingeniería](https://avanadecapital.atlassian.net/wiki/spaces/CEH/pages/397049857) | 5; documento v1.0 | Handoff, evidencia, ownership y Git Flow |
| [Secrets e infraestructura local](https://avanadecapital.atlassian.net/wiki/spaces/CEH/pages/386498581) | 6 | Loader LOCAL/AWS, provider único y adaptación |
| [Datos y migraciones](https://avanadecapital.atlassian.net/wiki/spaces/CEH/pages/386695169) | 5 (2026-10-20) | Dumps, historial y migración de idempotencia 4.0.0 |
| [SNS y SQS](https://avanadecapital.atlassian.net/wiki/spaces/CEH/pages/386760705) | 4 (2026-10-20) | Flujos, garantías, outbox transaccional y scopes 4.0.0 |
| [Pruebas](https://avanadecapital.atlassian.net/wiki/spaces/CEH/pages/386793473) | 2 | Typecheck, timeout, pruebas y evidencia |
| [Git y PR](https://avanadecapital.atlassian.net/wiki/spaces/CEH/pages/386498604) | 2 | Revisión, contenido PR y promoción |

Referencias de recorrido: [Iniciar backend](https://avanadecapital.atlassian.net/wiki/spaces/CEH/pages/386400261), [Docker](https://avanadecapital.atlassian.net/wiki/spaces/CEH/pages/386826241), [Implementación SNS/SQS](https://avanadecapital.atlassian.net/wiki/spaces/CEH/pages/403111938).
La versión de página identifica la lectura, no una copia sincronizada automáticamente.

## Reglas incorporadas

- Prohibición de usar DB staging desde desarrollo local, incluyendo túneles y clientes SQL.
- Dumps de `commodo-dump-files-stg` en cuenta AWS staging restaurados solo localmente; S3 no equivale a acceso a DB.
- ENV=LOCAL antes de arrancar, JSON privado, provider único, getAllVariables/adaptSecrets/useExisting; compilación separada de configuración runtime.
- DB, caché y brokers opcionales; notifications y Firebase son referencia, no capacidades universales del skeleton.
- Pruebas proporcionales, documentación progresiva, trazabilidad Jira/PR/Confluence y handoff con evidencia.
- Se consolidaron 11 archivos de docs/ai en 7, conservando sus reglas y actualizando enlaces. Las referencias históricas se preservan fuera del recorrido activo.

## Diferencias y límites explícitos

| Tema | Resolución / estado |
|---|---|
| Autorización del agente vs entrega completa | Se conserva la regla local de solicitar explícitamente creación de tests/documentación y ejecución de controles. No permite declarar Done/Ready for QA sin la evidencia corporativa; el agente entrega pendientes cuando una etapa no fue solicitada. |
| ConfigService | Confluence permite bootstrap/factories. El repo mantiene la frontera más estricta: solo loader/wiring; factories consumidoras usan EnvironmentUtils y getters propios. |
| Cobertura | Pruebas v2 exige 80% para servicios/dominio nuevos o modificados; metodología v1.0 pide proporcionalidad. Se conserva el mínimo aplicable sin crear tests triviales para inflarlo. Una excepción requiere responsable y aprobación, no bajar el gate unilateralmente. |
| Rama staging | La metodología oficial establece que staging/UAT son ambientes y exige mapeo en pipeline. La guía Git v2 usa una rama staging: no asumir que el nombre define el ambiente ni modificar ramas como parte de esta edición. |
| Validación en staging si no existe local | La metodología permite coordinar un entorno controlado; no deroga la prohibición específica de conectar desarrollo local a DB staging. Validar el servicio desplegado mediante el flujo autorizado. |
| Identidad del skeleton | package.json y código todavía contienen notifications. Perfil y evidencia se marcan como heredados; falta extracción y validación de plantilla genérica. |
| Estado Git histórico (2026-10-16) | status/diff devolvieron “this operation must be run in a work tree”, aunque rev-parse reconoce el checkout. HEAD consultado: e194388e2. No se modificó configuración Git; no se certifica checkout limpio. |

Pendientes de publicación del skeleton y del ejemplo se conservan en [registro existente](../../docs/todo/README.md).
La revisión original del 2026-10-16 no cambió código, pipelines, IAM, GitHub, Jira ni Confluence. La sincronización del 2026-10-20 se registra al final.
Revisar estas diferencias con el mantenedor antes de release; no inventar owner ni aprobación.

## Cómo mantenerlo

Al cambiar reglas, leer la página dueña, actualizar la síntesis local y esta tabla con versión/fecha; revisar perfil y enlaces de herramientas.
Conservar ejemplos sanitizados. No descargar páginas completas como nuevas reglas paralelas.
Si el cambio exige actualizar Confluence y no está dentro del alcance autorizado, registrar la brecha y el siguiente responsable.

## Ajuste 2.3.1 — configuración única

Solicitud del usuario 2026-10-16: `.env` local únicamente `ENV=LOCAL`; restante configuración de aplicación en JSON local/Secrets Manager; credenciales ECS automáticas por task role. No agregar variables para puertos, endpoints, flags, perfiles o keys. La página Confluence v6 conserva ejemplos anteriores con variables AWS: sincronización pendiente, no declarada completa.

## Ajuste 2.4.0 — AGENTS transversal

Solicitud del usuario 2026-10-16: `AGENTS.md` pasa a ser transversal y compartible entre repos; los criterios y reglas propios de cada repo viven en `docs/service-profile.md`. Cada feature se documenta en `docs/<nombre-feature>/` y sus pendientes en `docs/todo/<nombre-feature>.md`. Todo el desarrollo local corre en Docker; está prohibido arrancar la aplicación en el host.
Las guías de `docs/ai/` y esta alineación se movieron a `ai/rules/`. Se declaró la fuente canónica de `AGENTS.md` y las guías: este repo, rama `skeleton`. No se cambió runtime, pipelines ni Confluence.

## Ajuste 2.6.0 — contrato compartido de mensajería

Solicitud explícita del usuario el 2026-10-19: documentar en el skeleton el trabajo publicado en shared-libs 4.0.0. AGENTS resume las invariantes transversales; delivery-operations desarrolla enqueue con el manager de negocio, envío posterior al commit, claim por (consumer,event_id), scope NULL legado, estados/logs, migración y límites. El perfil distingue referencia documental de adopción real; no se modifica runtime ni dependencias.

Fuente de implementación: shared-libs a9693681c; evidencia/handoff 5a997067e. En la edición original del 2026-10-19 no se releyeron ni editaron páginas Confluence. La sincronización del 2026-10-20, registrada abajo, contrasta y actualiza SNS/SQS y datos/migraciones. Ninguna de estas ediciones cambia las políticas generales de validación. La excepción de omitir controles fue de la publicación de la librería, no del skeleton ni de sus consumers.

## Sincronización solicitada — 2026-10-20

Se revisó el diff completo contra HEAD y origin/skeleton. Los cambios pendientes eran documentales:
organización Docker en docker-config/, ubicación de repos hermanos, guía LocalStack Pro y contratos
de outbox/idempotencia publicados en shared-libs 4.0.0. No había cambios de aplicación, dependencias,
lockfile, migraciones ni runtime. AGENTS ya declaraba 2.6.0; esta sincronización conserva esa versión.

Se actualizaron y releyeron las páginas existentes, preservando su contenido y marcando los ejemplos
SNS anteriores a 4.0.0 como históricos:

| Página | Versión anterior → publicada |
|---|---|
| [Cultura y metodología](https://avanadecapital.atlassian.net/wiki/spaces/CEH/pages/386465793) | 12 → 13 |
| [Docker](https://avanadecapital.atlassian.net/wiki/spaces/CEH/pages/386826241) | 5 → 6 |
| [SNS y SQS](https://avanadecapital.atlassian.net/wiki/spaces/CEH/pages/386760705) | 3 → 4 |
| [Implementación SNS/SQS](https://avanadecapital.atlassian.net/wiki/spaces/CEH/pages/403111938) | 1 → 2 |
| [Datos y migraciones](https://avanadecapital.atlassian.net/wiki/spaces/CEH/pages/386695169) | 4 → 5 |

El resto de las páginas mantiene la evidencia histórica indicada; no se afirma revisión integral del
espacio. Confluence enlaza la guía LocalStack versionada; su experiencia del 2026-10-19 pertenece a
transaction-manager-integrations y no es una nueva ejecución. El skeleton conserva su Compose heredado,
shared-libs 0.13.0-rc.6 y worker sin DB. La publicación de 4.0.0 no valida consumers y su excepción
puntual de controles no se hereda.

Git pudo leerse con acceso ampliado al checkout, sin cambiar su configuración. Se observó que skeleton
seguía apiveh/staging, de otro remoto; esta entrega usa explícitamente origin y destino skeleton.
No se ejecutaron tests, typecheck, lint, formato, build, Docker, checks documentales automatizados ni
migraciones: la tarea autorizó análisis, documentación, commit y push, no esos controles.
