# Endurecimiento del worker de microsaldos

Registro de los hallazgos de la revisión de diseño (2026-10-26) y de lo que se hizo con cada uno. Distingue lo
implementado de lo validado: **nada de lo siguiente se ejecutó** (typecheck, lint, tests, Docker). Está escrito y
revisado leyendo el código.

## Desviaciones de estándar corregidas

| Hallazgo | Estándar de referencia | Cambio |
| --- | --- | --- |
| `DataSource` construido a mano (`new DataSource`) | `DBManagmentModule.forRoot` como en `transaction-manager.module.ts` de tx-manager | [microbalances-worker.module.ts](../../apps/microbalances-worker/src/microbalances-worker.module.ts) registra la conexión `default` (con `DBManagmentConnectionsModule.forRoot`, ver el cierre del bloqueo) con las 6 entidades en `infrastructure/config/microbalances-entities.ts`; se eliminó `microbalances-worker.config.ts`. Los adaptadores usan `@InjectDataSource(EDatabaseConfig.DEFAULT)`. |
| Puerto con interfaz y `Symbol` (`MICROBALANCE_STORE`) | Puertos como clases abstractas que son su propio token (módulo `transaction` de tx-manager) | `MicrobalanceStore` es una clase abstracta; se retiraron `MICROBALANCE_STORE`, `MICROBALANCES_CONFIG` y `MICROBALANCES_SQS_CLIENT`. `SQSClient` es su propio token y la configuración se lee de `MicrobalancesEnvironmentUtils`. |
| La guía del skeleton decía "interfaz y token Symbol" | Práctica real de tx-manager | Guía y AGENTS corregidos en este repo; pendiente propagar al skeleton. |

Efectos a tener en cuenta:

- El pool ya no lo fija el worker: lo define `orm.pool` del secreto de la conexión (valor por defecto de la librería: 30).
  El consumer falla al arrancar si el pool es menor que `MICROBALANCES_CONCURRENCY + 2`.
- Con `MICROBALANCES_WORKER_ENABLED=false` la conexión a la base se abre igual al arrancar (comportamiento del módulo).
- `DBManagmentModule` importa `EnvironmentConfigModule` estándar además de `MicrobalancesEnvironmentModule`: hay dos
  instancias de `EnvironmentUtils` y los secretos se cargan dos veces. No se comprobó en runtime que no haya conflicto.
- Se mantiene `MicrobalanceStoreRepository` en lugar de `DBTransactionService`: este último no aplica `lock_timeout` ni
  `statement_timeout` por transacción, no reintenta el SQLSTATE 55P03, ignora un deadline y devuelve un resultado en vez de lanzar.

## Riesgos de concurrencia y rendimiento

| # | Riesgo | Estado | Qué se hizo |
| --- | --- | --- | --- |
| 1 | Contención por `FOR UPDATE` en wallets calientes (comisión, mayorista) | **No corregido; medido (2026-11-10)** | Sin cambio. Medido: en una wallet caliente 8 loops no añaden throughput (212 a 232 eventos/s, frente a 95 a 389 con wallets distintas) y el p50 sube de 4,5 a 31 ms. Ver la sección de mediciones. Reducir el bloqueo de la wallet receptora en movimientos de solo-abono afectaría la garantía de idempotencia y la cobertura de deuda; no se optimiza sin la carga real de comisión y mayorista. |
| 2 | Lectura sin límite de bolsas AVAILABLE del emisor | Corregido en transferencias | `findSpendableByWalletId` lee páginas de 200 bolsas positivas, ordenadas por `createdAt, id`, excluyendo las bolsas del propio movimiento. El reverso sigue leyendo todas las bolsas porque necesita las negativas. |
| 3 | Escrituras en serie por bolsa (update, referencia, bolsa espejo) | **No corregido; medido (2026-11-10)** | Cada escritura depende del id o del estado de la anterior; agruparlas cambia el orden legado. Medido: unos 3,5 ms por bolsa consumida (10 bolsas 25 ms, 50 bolsas 141 ms, 100 bolsas 349 ms), con el lock de la wallet retenido todo ese tiempo. |
| 4 | `withTimeout` no cancela la transacción | Mitigado | `ApplyMicrobalancesService` comprueba `deadlineAt` antes de cada movimiento y lanza `MicrobalanceDeadlineExceededError` (transitorio, rollback). No interrumpe una sentencia en curso: de eso se encarga `statement_timeout`. |
| 5 | Aritmética con `Number` y residuos de flotantes | Corregido | `roundAmount`, `add` y `subtract` en el handler base redondean a escala 8. **Corrección (2026-11-10):** en la BD real las columnas de montos de `wallet_balances` y `transaction_balance_reference` son `numeric(18,2)`, no `numeric(20,8)` como declaran los entities, así que PostgreSQL redondea a 2 decimales al escribir; falta decidir si el redondeo del handler debe ser a escala 2. Se aplican a transferencias, cobertura de deuda y reverso. |
| 6 | Sesión colgada con locks | Corregido | `idle_in_transaction_session_timeout` se fija por transacción (`2 × statement_timeout`). |

## Resultados de las pruebas ejecutadas (2026-10-26, contenedor `microbalances-tools`)

| Control | Resultado |
| --- | --- |
| Tests unitarios | **195 pasan en 10 suites** (190 previos + 5 nuevos: lectura paginada, auto-transferencia, residuo 0.1 + 0.2, deadline dentro de la transacción, verificación del pool). Se ajustaron los specs del consumer y del store por los cambios de constructor. |
| Lint | Pasa (`--max-warnings 0`). |
| Typecheck | **Pasa con 0 errores usando shared-libs 4.1.0.** Con 4.0.0 fallaba con 84 errores, todos en fuentes de shared-libs (ver el bloqueo). |
| Formato (`prettier --check` sobre `apps` y `*.cjs`) | Pasa |
| `nest build` | Pasa (webpack compila) |

### Bloqueo: `DBManagmentModule` arrastra el grafo de entidades de shared-libs

`db-managment-dynamic.module.ts` importa `AttributeEntity` desde `entity/entities`. shared-libs se distribuye como TS fuente y esas
entidades usan alias internos `@libs/*` (50 errores), además de `kafkajs`, `@aws-sdk/client-s3`, `nestjs-form-data`,
`contracts/users` y `contracts/transactions`. Un consumidor ligero como este worker no tiene esos alias ni dependencias.
Esto no se había visto leyendo el código: apareció al ejecutar el typecheck. Tampoco se corrió `nest build` ni el arranque en Docker.

También se descubrió que el barril `@commodo-sas/shared-libs/core` carga `module-alias/register`; por eso el worker importa
`EDatabaseConfig` desde `core/core/enums/database-config.enum`, como `main.ts` ya hacía con `core/core/bootstrap`.

Opciones (se eligió la 2, ver el cierre más abajo):

1. **Mapear en este repo** `@libs/*` hacia shared-libs en `tsconfig.json`, `jest.config.cjs` y webpack, e instalar las dependencias que faltan. Cambia dependencias y lockfile y aumenta el tamaño de la imagen y la carga de módulos al arrancar.
2. **Corregir shared-libs** para que `db-managment` no importe la entidad por defecto cuando `registerDefaultFeatureEntities` es `false` (importación perezosa) y publicar una versión. Es la solución limpia; es un cambio en otro repo.
3. **Volver al `DataSource` manual** con un ADR que justifique la excepción hasta que se haga la opción 2.

## Cierre del bloqueo y estructura por capas (2026-10-27)

- **shared-libs 4.1.0** (publicada) añade `DBManagmentConnectionsModule`: conexiones nombradas, `DBManagmentService` y `DBTransactionService` sin `AttributeEntity`; `DBManagmentModule.forRoot` conserva su comportamiento. El worker usa la versión exacta con el lockfile regenerado contra el paquete publicado y `--frozen-lockfile` en la imagen. La variante elegida fue la opción 2 de las tres descritas arriba.
- **Composición por capas**, como `TransactionModule` de la referencia: `MicrobalancesModule` reúne `MicrobalancesApplicationModule`, `MicrobalancesInfrastructureModule` (secundaria) y `MicrobalancesPresenterInfrastructureModule` (primaria); 16 barrels `index.ts`; adaptadores con `implements`; JSDoc en los 7 constructores que faltaban.
- **Excepción de lint acotada:** el lint del skeleton prohíbe que `application` importe `infrastructure`, pero la referencia lo hace en `TransactionApplicationModule`. Se exceptúa solo `*.application.module.ts` en `eslint.config.cjs`; casos de uso y servicios siguen restringidos. Se propone corregir la regla en el skeleton.
- **Ejecutado en contenedor:** typecheck 0 errores, lint, formato, 195 tests y `nest build` pasan.

## Validación del 2026-11-09 (contenedor `microbalances-tools` y stack local)

- **Test de composición DI** (`microbalances.module.spec.ts`, escrito y ejecutado): compila `MicrobalancesModule` con `NestFactory.createApplicationContext`, sustituye el módulo de conexiones y el de entorno por dobles y comprueba que resuelven `ApplyMicrobalancesService`, `MicrobalanceStore` (adaptador `MicrobalanceStoreRepository`), `SQSClient`, `MicrobalancesSqsConsumer` y el `DataSource` de la conexión `default`. Valida el cableado entre los tres módulos; no abre BD ni SQS reales.
- **Ejecutado en contenedor:** typecheck 0 errores, lint, formato (`prettier --check "apps/**/*.ts" "*.cjs"`) y `test:cov` con 11 suites y 196 tests. Cobertura de `application/`: 100 % líneas, ramas, funciones y sentencias. El umbral de `jest.config.cjs` para `application/` es 80 %, no 100 %.
- **Doble instancia de `EnvironmentUtils`: confirmada por lectura del código** de shared-libs 4.1.0. `DBManagmentConnectionsModule.forRoot` importa `EnvironmentConfigModule`, que crea su propia `EnvironmentUtils` y llama a `getAllVariables()`; no hay caché. Los secretos se cargan dos veces (con `ENV=LOCAL` es una segunda lectura de `secrets.local.json`; en AWS, una segunda llamada a Secrets Manager). No se contó en ejecución.
- **Arranque real:** el worker arrancó en el stack local, quedó `healthy` y registró `microbalances.consumer.started` (concurrencia 4, lote 1) contra la cola local `commodo-local-loyalty-microbalances`. Esto confirma que el pool cumple `concurrencia + 2`. Un arranque anterior falló con `microbalances.bootstrap.failed` (`Cannot read properties of undefined (reading 'trim')`) y el siguiente funcionó; no se reprodujo ni se identificó la causa.

## Validación del 2026-11-10: integración, extremo a extremo y reintento

**Base de datos.** Todas las pruebas usan `com_default_commodo` del PostgreSQL local de Docker (`postgres-commodo-local`, puerto 55439 en el host), que es la base que configuran `secrets.local.json` del worker y los secretos de los otros servicios. No es una base vacía: tiene unas 386 mil wallets, 5 millones de transacciones y 11 GB. La base `loyalty_sns_local_test` del brief inicial no existe. Los datos de la prueba de contención llevan la etiqueta `ITEST` (wallets con `name = 'ITEST'`, usuarios `ITEST-<id>`, transacciones con `pos_transaction_id` `ITEST-<id>`, eventos `itest-…`) y **no se han borrado**.

### Contención y escritura por bolsa (ejecutado, `test/integration/contention.int.ts`)

Se ejecutó con los módulos reales contra PostgreSQL (pool 30, concurrencia de la prueba 1, 4 y 8). 160 eventos por fila salvo indicación.

| Escenario | Concurrencia | Throughput | p50 | p95 | Reintentos (40001, 40P01, 55P03) |
| --- | --- | --- | --- | --- | --- |
| Wallets distintas (base) | 1 / 4 / 8 | 95 / 311 / 389 por s | 9 / 12 / 19 ms | 21 / 21 / 32 ms | 0 |
| Una wallet receptora caliente | 1 / 4 / 8 | 212 / 270 / 232 por s | 4,5 / 14 / 31 ms | 6 / 19 / 51 ms | 0 |
| Un emisor caliente (40 transferencias de 5 bolsas) | 1 / 4 / 8 | 65 / 59 / 55 por s | 14 / 66 / 142 ms | 30 / 79 / 163 ms | 0 |

Una transferencia que consume M bolsas (5 repeticiones, concurrencia 1): M=1 7,7 ms; M=10 25 ms; M=50 141 ms; M=100 349 ms. Consistencia tras la prueba del emisor caliente, con las tres concurrencias: emisor con 0 disponible, receptor con 200 y referencias por 200. No hubo deadlocks ni `55P03`. No se probó un caso adversarial de wallets cruzadas. No se propone ninguna optimización: falta la carga real de comisión y mayorista.

### Extremo a extremo con el API (cashback por `POST /transaction-manager/api/cashback-integration`)

- Cashback de 40,00 a la wallet 10482 (transacciones 5440645 y 5440646): `transactions` con tipo 2 y `TRANSCONFIRMED`; `event_outbox` `cashback.created` en `SENT` con 1 intento; `processed_events` con las tres marcas (`microbalances`, `billing`, `marketing`) del mismo `event_id`; una bolsa `AVAILABLE` de 40,00 por transacción; 0 filas en `transaction_balance_reference` (sin deuda que cubrir); cola principal y DLQ en 0. El saldo macro de la wallet subió 40,00 por cada cashback, escrito por el API.
- **Reintento del mismo `eventId`** a la cola local: el worker respondió `duplicate` en 26 ms, sigue 1 sola bolsa y 1 sola marca `microbalances`, y la cola quedó vacía. El mismo POST con los mismos `pos_transaction_id` y `pos_operation_id` no crea nada; antes devolvía un 400 con el texto crudo de PostgreSQL (ver cambios en el API).
- El primer mensaje tras el arranque tardó 1.443 ms y el siguiente 40 ms; se atribuye a arranque en frío, sin demostrarlo.

### Hallazgos

1. **`wallet_balances` no tenía índice por `transaction_id`.** Una búsqueda sin coincidencia tardaba 177 ms (escaneo secuencial de 214 mil filas); `isAntecedentSettled` y la comprobación de clave foránea al borrar transacciones pagaban ese costo. Con `idx_wallet_balances_transaction_id` la misma consulta tarda 0,135 ms. La migración vive en este repo (`libs/db-managment/src/migrations/default/1794268800000-IndexWalletBalancesTransactionId.ts`, decisión del equipo), con su datasource `libs/db-managment/src/migrations-datasources/default.datasource.ts` (fábrica de shared-libs, `migrationsTransactionMode: none` porque usa `CONCURRENTLY`) y los scripts `pnpm migration:show|run|revert:default`. Se ejecutó `migration:run:default` contra la BD local: corrió sin transacción, quedó registrada en el ledger `migrations` y el índice es válido. No se probó `migration:revert:default`. La aplicación sigue sin ejecutar migraciones (`synchronize` y `migrationsRun` en false); en los demás ambientes está pendiente de aplicar. El ledger `migrations` es compartido con el API: `revert` desharía la última migración ejecutada del ledger, no necesariamente esta, así que conviene revisarlo con `migration:show` antes.
2. **Escala de los montos:** las columnas de bolsas y referencias son `numeric(18,2)` en la BD real (ver el riesgo 5).
3. **Billing no crea transacciones hijas para cashback.** `billing-engine.ts:284` solo crea comisión e impuesto (tipos 8 y 10) cuando `isRedemption`; para cashback guarda `transaction_billing_condition_details`. Las 58 transacciones de comisión y las 58 de impuesto existentes tienen como padre una redención. Por tanto `billing.microbalances.requested` con antecedente pendiente solo se puede probar con una redención.
4. **Eventos sin entregar:** las transacciones 5440639 y 5440640 (19 de octubre) tienen su evento en `SENT` pero solo lo procesó billing. Hipótesis sin verificar: las suscripciones de microsaldos y marketing se crearon después de esa fecha.
5. **Diferencia histórica en la wallet 10482:** las bolsas suman 9.600,00 menos que el saldo macro. 192 transacciones confirmadas de esa wallet no tienen bolsa, 190 anteriores al 19 de octubre; el worker no procesa histórico. La parte restante no se reconcilió.

### Cambio en el API (`commodo-transaction-manager-integrations`, commit local `fef4d07d9`, sin push)

- `toPersistenceFailureException` (`libs/core/src/core/exceptions/persistence-failure.mapper.ts`): una violación de unicidad responde 409 con un mensaje de negocio sin SQL ni nombre de restricción; el resto conserva el 400. Se usa en `generate-cashback-by-integration.service.ts:823`. Test unitario: 3 de 3; typecheck del API sin errores. Verificado de extremo a extremo (2026-11-11) tras reconstruir el contenedor: el POST con los mismos `pos_transaction_id` y `pos_operation_id` devuelve HTTP 409 con el mensaje de negocio, sin SQL, y no crea transacciones ni bolsas. Solo cubre el endpoint `cashback-integration`; `create-cashback-by-integration.service.ts` y `process-cashback-request.service.ts` usan el mismo patrón y no se tocaron.

## Lo que sigue sin ejecutarse

- Redención (flujo en dos pasos: `payment_by_dni` crea la solicitud y `PUT /redemption/process-redemption-request/{id}` con `approve: true` la aprueba con un token con el permiso `process_redemption_request`), reverso, transferencia y facturación con antecedente pendiente y resuelto, saldo insuficiente, deuda del emisor y reverso parcial con mensajes reales.
- Repetir las mediciones de contención con el índice creado, y el borrado de los datos `ITEST`.
- `requestAudit` y el contenido de los logs, el cierre limpio, y el efecto de los peers de OpenTelemetry con observabilidad activa.
- La verificación en ejecución de la doble carga de secretos.
