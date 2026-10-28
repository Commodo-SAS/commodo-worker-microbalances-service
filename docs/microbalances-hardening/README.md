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
| 1 | Contención por `FOR UPDATE` en wallets calientes (comisión, mayorista) | **No corregido; requiere medición** | Sin cambio. Reducir el bloqueo de la wallet receptora en movimientos de solo-abono afectaría la garantía de idempotencia y la cobertura de deuda; se decide con la prueba de integración (pendiente 1). |
| 2 | Lectura sin límite de bolsas AVAILABLE del emisor | Corregido en transferencias | `findSpendableByWalletId` lee páginas de 200 bolsas positivas, ordenadas por `createdAt, id`, excluyendo las bolsas del propio movimiento. El reverso sigue leyendo todas las bolsas porque necesita las negativas. |
| 3 | Escrituras en serie por bolsa (update, referencia, bolsa espejo) | **No corregido** | Cada escritura depende del id o del estado de la anterior; agruparlas cambia el orden legado. Se decide con medición. |
| 4 | `withTimeout` no cancela la transacción | Mitigado | `ApplyMicrobalancesService` comprueba `deadlineAt` antes de cada movimiento y lanza `MicrobalanceDeadlineExceededError` (transitorio, rollback). No interrumpe una sentencia en curso: de eso se encarga `statement_timeout`. |
| 5 | Aritmética con `Number` y residuos de flotantes | Corregido | `roundAmount`, `add` y `subtract` en el handler base redondean a escala 8 (la de `numeric(20,8)`). Se aplican a transferencias, cobertura de deuda y reverso. |
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

## Lo que sigue sin ejecutarse

- **Arranque real** con PostgreSQL y LocalStack (el stack `commodo-loyalty-aws-local` no estaba levantado): cableado de DI y comprobación de la doble instancia de `EnvironmentUtils` (el módulo de conexiones importa `EnvironmentConfigModule` además de `MicrobalancesEnvironmentModule`).
- Prueba de integración contra `loyalty_sns_local_test` para confirmar los riesgos 1 y 3 y la ausencia de regresión.
- La dependencia declara peers de OpenTelemetry con versiones distintas a las resueltas (aviso de pnpm); no se evaluó su efecto.
