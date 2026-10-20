# Perfil local microbalances worker

Servicio: commodo-worker-microbalances-service. Aplicación apps/microbalances-worker, Nest
ApplicationContext sin servidor HTTP. Base copiada de commodo-backend-skeleton (solo archivos
versionados; el código de notificaciones, sus Dockerfile, Compose y CI no se heredaron).
Shared-libs **4.0.0** exacta (última publicada al 2026-10-20), con pnpm-lock.yaml. AWS SQS
suscrita a SNS; PostgreSQL de negocio existente. No Redis, Kafka, Firebase, crons ni rifas.

Responsabilidad: aplicar los microsaldos (bolsas `wallet_balances` y referencias
`transaction_balance_reference`) de los movimientos que publican la API de transacciones y el worker
de facturación. No calcula cashback ni facturación y no actualiza saldos macro de wallets: esos ya
los escribieron la API o facturación. No publica eventos ni escribe en Redpanda.

## Flujo y reglas conservadas

Reemplaza el consumidor Redpanda retirado (`TransactionsEventsConsumerService.createMicrobalances` y
`TransactionBalanceManagerService`, anteriores al commit 4b0ddef20 del repo de la API). Las reglas se
portaron sin refactor funcional en `domain/balance-handlers/`:

- Transferencia y tipos equivalentes: consume bolsas del emisor por antigüedad (FIFO), crea
  referencia y bolsa al receptor, cubre las bolsas negativas del receptor y, con
  `allowSenderDebt`, crea una bolsa-deuda por el faltante; sin él, falla por saldo insuficiente.
- Cashback, comisión, impuesto, devoluciones, reembolso y canje de stamps: bolsa nueva al receptor y
  cobertura de bolsas negativas.
- Reverso: primero las bolsas del movimiento original (estado REVERSED si se agotan), luego las demás;
  el remanente afecta la bolsa negativa existente o crea una.
- Los cálculos usan `Number` como el legado; no se cambian redondeos ni precisión.
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
`.env` solo `ENV=LOCAL`. Consumo deshabilitado por defecto: con `MICROBALANCES_WORKER_ENABLED=false` no
se abre la conexión a la base. Logs con CommodoLoggerService, sin payloads, montos ni usuarios.

## Datos y migraciones

Usa tablas existentes: `wallets`, `wallet_balances`, `transaction_balance_reference`, `transactions`,
`processed_events` y `event_processing_log`. No tiene migraciones ni tablas propias; synchronize y
migrationsRun siempre en false. La migración que agrega `consumer` a `processed_events` pertenece al
repo commodo-transaction-manager-integrations y ya está aplicada. Es el primer consumidor de
microsaldos sobre estas tablas: no se reprocesan transacciones históricas.

## Reglas transversales

Reglas **2.6.1** copiadas del checkout local de commodo-backend-skeleton, rama skeleton, el
2026-10-20. Prevalece [AGENTS](../AGENTS.md); este perfil no relaja sus reglas. Las particularidades
van aquí y las excepciones en ADR. El desarrollo local corre en Docker; no iniciar la aplicación
directamente en el host. Prohibida la DB de staging desde local, incluso por túneles.

## Estado y brechas

- Implementado y revisado solo por lectura. No existen tests de este repo; no se ejecutaron pruebas,
  typecheck, lint, build ni migraciones. El lockfile se generó con `pnpm install --lockfile-only` en
  un contenedor; no se instaló node_modules.
- Docker (escrito, sin construir ni ejecutar): `docker-config/Dockerfile` (producción, Node 24, pnpm
  10.14.0, `nest build` y `node dist/apps/microbalances-worker/main.js`, sin puerto ni healthcheck HTTP),
  `docker-config/Dockerfile.dev` y `docker-config/docker-compose.local.yml`. El Compose define
  `microbalances-worker` (monta `secrets.local.json` y `apps/`, ENV=LOCAL) y `microbalances-tools`
  (perfil `tools`, para typecheck, lint y tests en contenedor). No incluye infraestructura: se une a la
  red externa `commodo-loyalty-aws-local_loyalty-local` del stack del repo commodo-transaction-manager-integrations,
  que debe estar arriba (alias `postgres-commodo-local` y `localstack`). El token de GitHub Packages
  se pasa como secreto de build desde `NODE_AUTH_TOKEN`. Comando: `docker compose -f
  docker-config/docker-compose.local.yml --project-directory . up -d --build`.
- CI: sin workflow propio en .github/ (el del skeleton era de notificaciones).
- Sin validar: transacciones concurrentes, orden de dependencias, caída entre commit y delete,
  apagado con mensajes en vuelo y comportamiento frente al dump restaurado.
- Pendientes: owner, SLO, retención, alarmas (antigüedad de cola, DLQ, `dependency.abandoned`), IAM de
  mínimo privilegio, `maxReceiveCount` y redrive por IaC, y que el visibility timeout de la cola sea
  mayor o igual al configurado aquí.
- Decisión pendiente en el productor: campo opcional `allowSenderDebt` en cashback y redención.
- Material del skeleton: testing-guidelines conserva cinco minutos (aplicar dos sin salida, AGENTS);
  los ejemplos de Notifications/Firebase no son capacidades de este servicio.
