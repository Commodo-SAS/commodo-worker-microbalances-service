# AGENTS.md — reglas transversales

Reglas **2.7.1** · revisión documental: **2026-10-24**.
Base: [Cultura y metodología del Desarrollo](https://avanadecapital.atlassian.net/wiki/spaces/CEH/pages/386465793) y [Metodología oficial v1.0](https://avanadecapital.atlassian.net/wiki/spaces/CEH/pages/397049857).
Aplicación y diferencias: [alineación con Confluence](ai/rules/manual-developer-v2-alignment.md).

Este archivo es **transversal**: se comparte sin cambios entre todos los repositorios. No contiene nombres de servicio, decisiones, excepciones ni invariantes propios de un repo; eso vive en el `docs/service-profile.md` de cada repositorio.

## Dónde vive cada cosa

| Contenido | Ubicación |
|---|---|
| Reglas válidas para todos los repos | `AGENTS.md` (este archivo) |
| Criterios, reglas, invariantes, excepciones, stack, comandos, evidencia y brechas **propios del repo** | `docs/service-profile.md` |
| Implementación de una feature: contrato, diseño, operación y evidencia | `docs/<nombre-feature>/` (con `README.md` como entrada) |
| Pendientes de una feature | `docs/todo/<nombre-feature>.md` |
| Decisiones incompatibles o excepciones a una regla | `docs/decisions/` (ADR) |
| Guías temáticas de procedimiento | [`ai/rules/`](ai/rules/README.md) |
| Archivos Docker: Dockerfile, Dockerfile.dev, Compose por ambiente y configuración auxiliar (ADOT, LocalStack, init de DB) | `docker-config/` ([regla](#entorno-local-obligatorio)) |

- **Precedencia:** el perfil puede añadir restricciones propias, pero no relaja este archivo. Una excepción requiere ADR con responsable y fecha de revisión.
- **Fuente canónica:** este archivo y las guías de `ai/rules/` se copian del repo `commodo-backend-skeleton`, rama única `skeleton`. Es la única fuente: los repos consumidores no lo modifican; un cambio transversal se propone por PR contra esa rama, sube la versión del encabezado y luego se vuelve a copiar a cada repo, sin sincronización automática. Cada repo registra en su perfil la versión adoptada.
- **Regla propia nueva:** si una regla solo aplica a este repo, va en el perfil, nunca aquí. Cambiar `AGENTS.md` solo para reglas válidas en todos los repos.
- **Perfil ausente:** si el repo no tiene `docs/service-profile.md`, crearlo antes de registrar reglas propias.
- **Feature implementada:** documentarla en `docs/<nombre-feature>/` y enlazarla desde el perfil si afecta al servicio. Si le quedan cosas pendientes, registrarlas en `docs/todo/<nombre-feature>.md` con estado, impacto, siguiente acción y criterio de cierre, y enlazar el pendiente desde el README de la feature. Al cerrarlo, actualizar o retirar el registro.
- La creación de documentación sigue la política de [Antes de actuar](#antes-de-actuar): requiere indicación explícita. Sin ella, informar los pendientes en la conversación.

## Antes de actuar

- Leer este archivo y el [perfil](docs/service-profile.md). Revisar Git e instrucciones más específicas, preservar cambios previos y consultar solo la [guía del tema](ai/rules/README.md). Si Git falla, informar la limitación y conservar copia de los archivos antes de editarlos.
- La tarea delimita etapas y autorización. Mantener la política local: crear tests, crear o editar archivos de documentación y ejecutar validaciones requieren indicación explícita para cada actividad; no inferirlas de una petición de implementar código. Los comentarios JSDoc del código nuevo o modificado no son esa actividad: se escriben siempre al implementar. Una autorización previa sigue vigente dentro de su alcance.
- No ejecutar tests, typecheck, lint, formato automático, checks documentales, build, cobertura, E2E o Docker sin solicitud de ejecución. La lectura y revisión del diff forman parte del trabajo. No pedir permisos rutinarios: informar los controles pendientes.
- Estas reglas no autorizan push, merge, publicación, despliegue, migraciones, cambios en otros repos ni mensajes a terceros.
- **Ubicación de los repos.** Todos los repositorios del equipo viven en una misma carpeta local (`C:\Commodo\Repositorios`), cada uno en su subcarpeta y al mismo nivel (por ejemplo `commodo-backend-skeleton`, `commodo-shared-libs`, `commodo-transaction-manager-integrations`, `commodo-worker-billing-service`). Inferir la ruta de un repo vecino como `..\<nombre-del-repo>` desde la raíz del actual, sin pedirla. Saber dónde está un repo permite leerlo; modificarlo sigue requiriendo el alcance autorizado de la tarea.
- Al terminar, distinguir implementación, tests escritos, pruebas ejecutadas, controles y documentación; reportar pendientes sin presentar código terminado como entrega validada. Conservar contexto breve en la conversación; crear planes en archivo solo cuando se soliciten.

## Entorno local obligatorio

- **Todo el desarrollo local corre en Docker (Compose).** La aplicación, sus dependencias (DB, LocalStack, caché, broker) y los comandos de desarrollo (build, tests, typecheck, lint) se ejecutan dentro de contenedores. **Está prohibido arrancar la aplicación directamente en el host** con `pnpm start:dev`, `pnpm start:dev:<app>`, `nest start`, `node` o equivalentes. Los archivos Compose, el servicio y los comandos reales de cada repo se declaran en su perfil. Esta regla define cómo desarrolla el equipo; el agente sigue sin ejecutar Docker ni otros controles sin solicitud explícita (ver [Antes de actuar](#antes-de-actuar)).
- **Pedidos de arranque local:** “levantar”, “encender” o “arrancar” la app o un worker autorizan su arranque mediante Docker Compose. Revisar el perfil y el estado del servicio, levantarlo si está detenido y comprobar el estado posterior. La respuesta debe informar el estado observado e incluir siempre `docker compose -f docker-config/docker-compose.local.yml --project-directory . logs -f --tail=100 <servicio>`, sustituyendo archivo y servicio por los reales e indicando que se ejecuta desde la raíz del repo. Usar el nombre del servicio Compose. [Procedimiento](ai/rules/delivery-operations.md#arranque-local-solicitado-y-comando-de-logs).
- **Todos los archivos de Docker viven en `docker-config/`:** `Dockerfile`, `Dockerfile.dev`, los Compose por ambiente y su configuración auxiliar (ADOT, LocalStack, init de DB). En la raíz solo queda `.dockerignore`, que Docker busca en la raíz del contexto. El contexto de build es siempre la raíz del repo: `docker build -f docker-config/<Dockerfile> .` y, en Compose, `context: .` con `dockerfile: docker-config/<Dockerfile>`. No dejar copias ni Dockerfile sueltos en la raíz.
- **Comandos Docker de referencia.** Se ejecutan desde la raíz del repo; son un ejemplo de forma, no un contrato: cada repo declara en su perfil los archivos Compose, servicios y comandos que realmente usa, y puede adaptarlos.

  ```
  docker compose -f docker-config/docker-compose.local.yml --project-directory . up -d
  docker compose -f docker-config/docker-compose.local.yml --project-directory . ps
  docker compose -f docker-config/docker-compose.local.yml --project-directory . logs --tail=100 <servicio>
  ```

  `--project-directory .` fija la raíz del repo como base de rutas, y `-f` el archivo Compose; `<servicio>` es un servicio definido en ese archivo.
- El `.env` local debe contener únicamente `ENV=LOCAL`; prohibido agregar otras variables de configuración, también como overrides en shell/Compose/task definition. Crear `secrets.local.json` en la raíz/directorio de ejecución. Compilar no selecciona secretos; `NODE_ENV` ni un valor dentro del JSON sustituyen `ENV`. En el JSON, `ENVIRONMENT_CONFIG` declara solo `ENV`: no duplicar `ENVIRONMENT`, alias heredado que `getEnv()` usa únicamente si falta `ENV`. `AWS_CONFIG.AWS_REGION` sí es necesario, porque `getAwsRegion()` solo lo lee del JSON.
- Está prohibido conectar la aplicación local, clientes SQL o migraciones a la DB de staging, incluso por SSM/SSH. Revisar destinos efectivos y réplicas: localhost puede ser un túnel remoto y LOCAL no es un firewall.
- Para desarrollos existentes o nuevos que requieran una base existente, descargar el dump correspondiente de `commodo-dump-files-stg`, cuenta AWS staging, y restaurarlo exclusivamente en PostgreSQL local. S3 es la fuente del archivo; no autoriza acceso a la DB remota. Bases nuevas independientes usan migraciones/fixtures; servicios sin DB omiten este paso.
- Excluir secretos y dumps de Git, logs, imágenes y contexto Docker. Versionar solo ejemplos sanitizados. No copiar secretos de staging al entorno local.
- Levantar solo las capacidades que el perfil declare: LocalStack para APIs AWS compatibles; PostgreSQL para SQL; Redis/Valkey para caché compatible; Redpanda para Kafka. ElastiCache es un servicio AWS, no una imagen local. No heredar capacidades, colas ni dominios de otros servicios por defecto.
- Toda configuración de aplicación proviene de `secrets.local.json` o AWS Secrets Manager. En ECS, las credenciales se obtienen automáticamente del task role; no configurar keys, perfiles ni credenciales estáticas. El nombre del secreto requiere un contrato de bootstrap, no se deduce del rol.
- Carga de secretos y ejemplos: [contratos y configuración](ai/rules/contracts-configuration.md). Infraestructura, restauración y mensajería: [operación](ai/rules/delivery-operations.md).
- Las brechas del código vigente se registran en el perfil; documentar una norma no demuestra que el runtime ya la cumpla.

## Invariantes de ingeniería

- Dominio sin frameworks; aplicación depende de puertos; adaptadores implementan integración. Diseño proporcional, sin capas vacías ni conexiones incidentales.
- **Estructura homologada.** Todo backend NestJS organiza `domain/`, `application/` e `infrastructure/` como el módulo `transaction` de `commodo-transaction-manager-integrations` (`apps/transaction-manager/src/modules/transaction`): puertos en `domain/ports` (`secondary/` para repositorios y mensajería), casos de uso en `application/use-cases/<caso>`, servicios y handlers en `application/services`, y adaptadores en `infrastructure/adapters/primary` (HTTP, consumidores SQS) y `infrastructure/adapters/secondary` (repositories, sqs). Ningún archivo suelto en la raíz de las capas (salvo barrels `index.ts`). Leer ese módulo antes de crear carpetas o nombres; el detalle está en [arquitectura](ai/rules/architecture-guidelines.md).
- **Bootstrap.** `main.ts` llama a `setupApp` de shared-libs, también en workers: su listener HTTP existe solo para el liveness compartido. Detalle y opciones en [contratos y configuración](ai/rules/contracts-configuration.md#bootstrap-maints).
- **Persistencia.** Entidades TypeORM por defecto; SQL directo solo cuando el costo, la complejidad o la concurrencia lo justifiquen (por ejemplo `set_config` de timeouts o bloqueos que el ORM no expresa), registrando el porqué en el perfil.
- Configuración mediante la API pública de `EnvironmentUtils`. Si falta un getter propio, añadirlo en el consumer. `ConfigService` y lectura de entorno solo dentro del loader y su inicialización; servicios, controllers, adapters y factories consumidoras usan getters.
- Mantener un único provider de configuración y esperar su carga antes de exponer getters. Consultar el perfil para su implementación real; no importar un segundo módulo ni sustituir getters sin revisar compatibilidad.
- Consumir shared-libs publicada con versión exacta y lockfile; respetar exports. Sin `file:`, vendor, enlaces al repo vecino ni alias genérico. Publicar cambios de la librería antes de validar consumidores.
- Validar entradas externas en runtime; HTTP usa whitelist; eventos versionados admiten campos adicionales compatibles y validan al consumir. Cambios incompatibles requieren migración y coordinación.
- DB/Redis opcionales, conexiones nombradas explícitas. Migraciones propiedad del consumer; preservar historial TypeORM. No usar synchronize para reemplazarlas.
- SNS distribuye; SQS almacena trabajo. Recursos e IAM se aprovisionan por IaC, no por importar módulos. SNS→SQS usa `RawMessageDelivery=true` cuando el consumer espera el envelope directo.
- **Outbox transaccional:** cuando el perfil requiera DB + eventos, guardar negocio y `event_outbox` PENDING con el mismo `EntityManager`; enviar solo después del commit y actualizar SENT/SEND_FAILED e intentos sobre esa fila. En shared-libs 4.0.0 usar `enqueue(manager, envelope, options)` y luego `publish(..., { outboxId })`. El consumer aporta el relay; registrar una entidad no lo crea. [Contrato y adopción](ai/rules/delivery-operations.md#shared-libs-400-outbox-e-idempotencia-transaccional).
- **Idempotencia por consumidor:** en fan-out sobre una misma DB, cada consumidor lógico usa un nombre estable compartido por sus réplicas. Con shared-libs 4.0.0 la marca `(consumer, event_id)` se inserta antes del negocio y dentro de su misma transacción; con `SqsConsumerBase` usar `transactionalIdempotency: true` y `context.markProcessed(manager)`. Conflicto implica no ejecutar negocio. NULL conserva el scope global legado. Migrar el esquema antes de activar scopes; no marcar antes/después en una operación independiente ni activar DB implícitamente. [Migración, logs y límites](ai/rules/delivery-operations.md#shared-libs-400-outbox-e-idempotencia-transaccional).
- Definir timeouts, retries limitados, concurrencia, shutdown, DLQ e idempotencia. No prometer exactly-once, atomicidad por tener outbox ni aceptación durable si el publisher absorbe errores.
- Logs estructurados con CommodoLoggerService, correlación y resultados; sin payloads sensibles. Logs y liveness no prueban auditoría durable ni disponibilidad de dependencias.

## Calidad y entrega

- Cuando se solicite validar: typecheck focalizado primero; tras 2 minutos sin salida, detener y reportar timeout, continuar controles pertinentes sin declararlo exitoso. Elegir pruebas por comportamiento/riesgo y lint/formato afectados.
- No ejecutar gates completos por guardado ni agregar hooks bloqueantes. No bajar controles ni excluir código para obtener verde; conservar los requisitos CI.
- La restricción de ejecución del agente no exime al equipo de pruebas, documentación y evidencia antes del PR/QA. Controles, cobertura aplicable y diferencias: [calidad](ai/rules/testing-guidelines.md).
- Jira registra alcance, estado, siguiente responsable y evidencia; Confluence mantiene conocimiento; GitHub mantiene código y revisión. PR revisado antes del merge; no transferir a QA como listo sin validación del developer y handoff.
- Flujo corporativo: `feature/* → develop → release/main → pre-prod → prod`; hotfix desde prod y sincronización posterior. Declarar mapeo rama/ambiente en pipelines; no asumirlo por el nombre staging/UAT.
- PR incluye ticket, impacto, pruebas/CI, migraciones, dependencias DevOps, instrucciones UAT, riesgos y recuperación. No declarar protecciones, permisos, despliegue o release verificados sin evidencia.

## Documentación y mantenimiento

- Una regla tiene una guía dueña. AGENTS resume invariantes transversales; el perfil declara la realidad y las reglas del repo; guías desarrollan procedimientos; ADR/planes/evidencia son registros, no reglas nuevas.
- **Comentarios de código:** todo código nuevo o modificado se comenta en inglés, como parte de implementar y no de la etapa documental.
  - **Toda función, método y clase lleva JSDoc/TSDoc**, también los privados y los helpers: propósito y, cuando aportan, `@param`, `@returns` y `@throws`. Excepciones: constructores que solo asignan dependencias y los casos de un `*.spec.ts`, cuyo nombre ya los documenta.
  - **Dentro de cada función se comentan los pasos importantes**: la secuencia de una transacción, el orden de bloqueos, las salidas tempranas, las condiciones de reintento o de omisión, y cualquier decisión heredada del legado. Se explica el porqué; no se repite la sintaxis ni se comenta cada línea o variable.
  - Los contratos, la configuración, las restricciones y los efectos no obvios (garantías de idempotencia, orden de confirmación) se documentan en la declaración que los define.

- Los archivos de documentación (`docs/`, ADR, README, perfil) se crean o editan en la etapa documental solicitada: documentar contratos, configuración, restricciones y efectos no obvios.
- Mantener pendientes con estado, impacto, siguiente acción y cierre; ADR para decisiones incompatibles o excepciones, con responsable y revisión.
- Al cambiar una política, contrastar Confluence y guía local, registrar página/versión/fecha en la alineación y señalar diferencias. No afirmar sincronización automática ni editar Confluence/otros repos sin alcance autorizado.
- Cursor y otras herramientas enlazan estas reglas; no crean copias. Referencias históricas no se cargan por defecto. Adopción y gobierno: [guía](ai/rules/governance.md).
