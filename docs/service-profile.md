# Perfil local microbalances worker

Servicio: commodo-worker-microbalances-service. Aplicación apps/microbalances-worker, Nest con un
listener HTTP solo para el liveness compartido (`setupApp` de shared-libs, `GET /microbalances/api/v1/health-check`);
el trabajo lo hace el consumidor SQS. Base copiada de commodo-backend-skeleton (solo archivos
versionados; el código de notificaciones, sus Dockerfile, Compose y CI no se heredaron).
Shared-libs **4.1.0** exacta (añade `DBManagmentConnectionsModule`; lockfile generado contra el paquete publicado), con pnpm-lock.yaml. AWS SQS
suscrita a SNS; PostgreSQL de negocio existente. No Redis, Kafka, Firebase, crons ni rifas.

Responsabilidad: aplicar los microsaldos (bolsas `wallet_balances` y referencias
`transaction_balance_reference`) de los movimientos que publican la API de transacciones y el worker
de facturación. No calcula cashback ni facturación y no actualiza saldos macro de wallets: esos ya
los escribieron la API o facturación. No publica eventos ni escribe en Redpanda.

## Flujo y reglas conservadas

Reemplaza el consumidor Redpanda retirado (`TransactionsEventsConsumerService.createMicrobalances` y
`TransactionBalanceManagerService`, anteriores al commit 4b0ddef20 del repo de la API). Las reglas se
portaron sin refactor funcional en `application/services/handlers/transaction-balance-handlers/`:

- Transferencia y tipos equivalentes: consume bolsas del emisor por antigüedad (FIFO), crea
  referencia y bolsa al receptor, cubre las bolsas negativas del receptor y, con
  `allowSenderDebt`, crea una bolsa-deuda por el faltante; sin él, falla por saldo insuficiente.
- Cashback, comisión, impuesto, devoluciones, reembolso y canje de stamps: bolsa nueva al receptor y
  cobertura de bolsas negativas.
- Reverso: primero las bolsas del movimiento original (estado REVERSED si se agotan), luego las demás;
  el remanente afecta la bolsa negativa existente o crea una.
- Los cálculos usan `Number` como el legado, pero los importes se redondean a la escala de la columna (8 decimales) tras cada suma o resta, para evitar residuos de coma flotante (por ejemplo 0.1 + 0.2).
- Sin usuario registrado (`payload.userId` ausente) no se generan microsaldos. En redención ambos
  tramos se tratan como REDEMPTION. Cashback `TRANSPENDING` se procesa igual que antes.
  Un reverso sin wallets se omite. Un evento de otro ambiente se descarta.

## Eventos

Cola local `commodo-local-loyalty-microbalances` (SNS con RawMessageDelivery). Se valida el envelope al
consumir y se toleran campos adicionales; `eventId` admite hasta 64 caracteres (límite de
`processed_events`).

| Evento | Origen | Efecto |
| --- | --- | --- |
| cashback.created v1 | API | Movimiento del aliado y, si existe, del mayorista |
| redemption.completed v1 | API | Idem, como redención |
| transaction.microbalances.requested v1 | API | Un movimiento según `transactionTypeId` |
| billing.microbalances.requested v1 | Facturación | Movimiento TRANSFER de impuesto o comisión |

El contrato de billing.microbalances.requested no está en el repo de la API: lo define
`postgres-billing.ts` del worker de facturación. Los contratos se validan aquí de forma
independiente; este repo no importa código de repos vecinos. El productor puede agregar el campo
opcional `allowSenderDebt` a cashback y redención; hasta entonces el worker asume `false`.

## Estructura

Los módulos Nest se componen por capa, como `TransactionModule`: `MicrobalancesModule` reúne `MicrobalancesApplicationModule` (`application/`), `MicrobalancesInfrastructureModule` (`infrastructure/adapters/secondary`) y `MicrobalancesPresenterInfrastructureModule` (`infrastructure/adapters/primary`); el módulo raíz solo importa entorno, observabilidad y `MicrobalancesModule`. Cada carpeta expone un barrel `index.ts`.

Estructura de carpetas homologada con el módulo `transaction` de commodo-transaction-manager-integrations
(`apps/microbalances-worker/src`):

| Capa | Carpeta | Contenido |
| --- | --- | --- |
| domain | `enums`, `errors`, `interfaces`, `models` | Tipos de transacción y estados de bolsa, errores de dominio, movimiento, contrato de eventos |
| domain | `ports/secondary` | Puertos de bolsas, referencias y store transaccional |
| application | `use-cases/apply-microbalances` | Caso de uso `ApplyMicrobalancesService` |
| application | `services` y `services/handlers/transaction-balance-handlers` | Router de saldos y reglas transfer, cashback y reverse portadas del legado |
| infrastructure | `adapters/primary/sqs` | Consumidor SQS |
| infrastructure | `adapters/secondary/sqs` | Cliente SQS |
| infrastructure | `adapters/secondary/repositories` y `entities` | Repositorios TypeORM y entidades mínimas |
| infrastructure | `config`, `environment` | Configuración validada y `EnvironmentUtils` propio |

## Idempotencia, concurrencia y dependencias

- Todo el trabajo de un evento ocurre en una transacción `READ COMMITTED`: marca
  `processed_events` (consumidor `microbalances`, `markProcessed` de shared-libs) y cambios de
  saldo. El mensaje SQS se confirma solo después del commit.
- Un movimiento se omite si ya tiene referencias o bolsas del receptor (verificación del legado). Esto
  evita aplicarlo dos veces cuando llega por eventos distintos. Antes de verificar se bloquean las
  wallets involucradas con `FOR UPDATE` en orden de id (adición de concurrencia, no regla nueva).
- Un movimiento con `dependsOnTransactionId` se aplica cuando el antecedente tiene referencias o
  bolsas, es de un usuario sin registro (regla del legado) o tiene monto 0. Si no, la transacción
  se revierte y el mensaje vuelve con backoff exponencial (`ChangeMessageVisibility`); no hay espera en
  memoria ni tablas propias. Tras `MICROBALANCES_DEPENDENCY_MAX_RECEIVES` recepciones se registra
  `microbalances.dependency.abandoned`, se confirma el mensaje y **no llega a la DLQ**.
  El movimiento principal nunca espera a facturación.
- Errores de contrato o de regla, y fallos transitorios, no se confirman: reintentan con backoff y
  pasan a la DLQ por `maxReceiveCount` de la cola. Deadlocks y timeouts de lock se reintentan en
  proceso hasta `MICROBALANCES_DB_ATTEMPTS` dentro del presupuesto de tiempo.
- Concurrencia por bucles de polling (`MICROBALANCES_CONCURRENCY`), timeout por mensaje menor que
  el visibility timeout, `statement_timeout` y `lock_timeout` por transacción. Apagado ordenado:
  deja de sondear, cancela el long polling, drena hasta `MICROBALANCES_SHUTDOWN_DEADLINE_MS` y cierra
  cliente y pool; lo no confirmado se reentrega.
- Entrega al menos una vez, consistencia eventual; no exactly-once.

## Configuración

Solo mediante `MicrobalancesEnvironmentUtils` (extiende `EnvironmentUtils` de shared-libs; agrega
`getMicrobalancesWorkerConfiguration`). El grupo `MICROBALANCES_WORKER_CONFIG` de
`secrets.local.json` o Secrets Manager trae habilitación, cola, endpoint de emulador (solo LOCAL) y los
valores de concurrencia, timeouts y reintentos; el ejemplo sanitizado es `secrets.local.example.json`.
`.env` solo `ENV=LOCAL`. Consumo deshabilitado por defecto: con `MICROBALANCES_WORKER_ENABLED=false` no se
procesan mensajes, pero la conexión a la base la abre DBManagmentModule al arrancar. Logs con CommodoLoggerService, sin payloads, montos ni usuarios.

## Datos y migraciones

Conexión `default` registrada con `DBManagmentConnectionsModule.forRoot` (la variante de `DBManagmentModule` sin las entidades por defecto de shared-libs, porque este worker mapea sus propias filas) (pool desde `orm.pool` del secreto de la base, mínimo concurrencia + 2, verificado al arrancar). Acceso a datos con entidades TypeORM (como el legado); SQL solo cuando el costo, la complejidad o la
concurrencia lo justifiquen. Hoy la única sentencia SQL directa es `set_config` de los timeouts por
transacción, que el ORM no expone, y `markProcessed` de shared-libs. El bloqueo de wallets usa el
query builder de la entidad con `pessimistic_write`. Usa tablas existentes: `wallets`, `wallet_balances`, `transaction_balance_reference`, `transactions`,
`processed_events` y `event_processing_log`. No tiene tablas propias y solo una migración de índice (ver abajo); synchronize y
migrationsRun siempre en false. La migración que agrega `consumer` a `processed_events` pertenece al
repo commodo-transaction-manager-integrations y ya está aplicada. El índice `idx_wallet_balances_transaction_id` sobre `wallet_balances(transaction_id)` (que usa `isAntecedentSettled`) es la excepción: su migración vive en este repo, en `apps/microbalances-worker/migrations/default` (datasource `migrations/default.datasource.ts`, scripts `pnpm migration:show|run|revert:default`, sin transacción por `CONCURRENTLY`). Está aplicada en la BD local y pendiente en los demás ambientes; la aplicación sigue sin ejecutar migraciones. Es el primer consumidor de
microsaldos sobre estas tablas: no se reprocesan transacciones históricas.

## Reglas transversales

Arquitectura (ver [architecture-guidelines](../ai/rules/architecture-guidelines.md)): los puertos viven en
`domain/ports/secondary`; el puerto inyectable `MicrobalanceStore` es una clase abstracta que es su propio token y `application` solo lo
consume; `infrastructure` los implementa. Los comentarios de código son JSDoc en inglés sobre contratos, efectos y
comportamientos no obvios, sin comentar cada variable.

Reglas **2.8.0** copiadas del checkout local de commodo-backend-skeleton, rama skeleton, el
2026-10-24. Prevalece [AGENTS](../AGENTS.md); este perfil no relaja sus reglas. Las particularidades
van aquí y las excepciones en ADR. El desarrollo local corre en Docker; no iniciar la aplicación
directamente en el host. Prohibida la DB de staging desde local, incluso por túneles.

## Estado y brechas

- Validaciones ejecutadas en contenedor: typecheck, lint y 190 tests unitarios pasan (cobertura de
  `application/` 100 %). El formato falla solo en 5 archivos de configuración heredados del skeleton. Los
  tests usan dobles en memoria; no hay prueba de integración contra PostgreSQL. El lockfile se generó con
  `pnpm install --lockfile-only` en un contenedor; no se ejecutaron migraciones.
- Docker (construido y en ejecución local): `docker-config/Dockerfile` (producción, Node 24, pnpm
  10.14.0, `nest build` y `node dist/apps/microbalances-worker/main.js`, con `HEALTHCHECK` sobre el liveness
  en el puerto 8000),
  `docker-config/Dockerfile.dev` y `docker-config/docker-compose.local.yml`. El Compose define
  `microbalances-worker` (monta `secrets.local.json` y `apps/`, ENV=LOCAL) y `microbalances-tools`
  (perfil `tools`, para typecheck, lint y tests en contenedor). No incluye infraestructura: se une a la
  red externa `commodo-loyalty-aws-local_loyalty-local` del stack del repo commodo-transaction-manager-integrations,
  que debe estar arriba (alias `postgres-commodo-local` y `localstack`). El token de GitHub Packages
  se pasa como secreto de build desde `NODE_AUTH_TOKEN`. LocalStack es efímero: tras reiniciar
  Docker hay que ejecutar `aws-init` del stack de transaction-manager-integrations para recrear tópico y colas;
  el consumidor reintenta con backoff mientras la cola no exista. Comando: `docker compose -f
  docker-config/docker-compose.local.yml --project-directory . up -d --build`.
- CI: sin workflow propio en .github/ (el del skeleton era de notificaciones).
- Endurecimiento posterior a la revisión (ver [microbalances-hardening](microbalances-hardening/README.md)): migración a `DBManagmentConnectionsModule` (shared-libs 4.1.0), puertos como clases abstractas y módulos por capa con barrels, lectura FIFO paginada, redondeo de montos a escala 8, presupuesto de tiempo dentro de la transacción y `idle_in_transaction_session_timeout` por transacción. Ejecutado en contenedor con shared-libs 4.1.0: typecheck sin errores, lint, formato, 195 tests y `nest build` pasan. **Sin validar el arranque real** (cableado de DI contra PostgreSQL y LocalStack) ni la doble instancia de `EnvironmentUtils`.
- AGENTS.md y ai/rules/architecture-guidelines.md se editaron aquí con tres reglas nuevas (conexión DB, puertos/tokens, concurrencia). Son transversales: deben propagarse por PR a la rama skeleton, que sube la versión del encabezado. Hasta entonces este repo difiere del skeleton.
- Sin validar: transacciones concurrentes, orden de dependencias, caída entre commit y delete,
  apagado con mensajes en vuelo y comportamiento frente al dump restaurado.
- Pendientes: owner, SLO, retención, alarmas (antigüedad de cola, DLQ, `dependency.abandoned`), IAM de
  mínimo privilegio, `maxReceiveCount` y redrive por IaC, y que el visibility timeout de la cola sea
  mayor o igual al configurado aquí.
- Decisión pendiente en el productor: campo opcional `allowSenderDebt` en cashback y redención.
- Material del skeleton: testing-guidelines conserva cinco minutos (aplicar dos sin salida, AGENTS);
  los ejemplos de Notifications/Firebase no son capacidades de este servicio.
