# Docker, entrega y operación

## Ambientes

- docker-compose.local.yaml: infraestructura opcional y emulada necesaria para el perfil, no el worker.
- Ejecución directa LOCAL: JSON local ignorado en Git y validado.
- docker-compose.staging.yml: configuración del ambiente staging para operación autorizada; no usarla para desarrollar localmente ni conectar a su DB.
- Todos los archivos Docker viven en `docker-config/`. Dockerfile.dev: desarrollo. Dockerfile: imagen multietapa de producción, sin código/configuración sensible de desarrollo.

El perfil decide qué infraestructura se incluye. Los nombres se mantienen consistentes entre nuevos repos.

## Build y promoción

Fijar toolchain y lockfile; usar BuildKit secrets para registro privado; no ARG/ENV de tokens en capas. Imagen final con dependencias productivas, usuario sin privilegios y proceso con señales.
Verificar que el artefacto inicia sin herramientas de build y no contiene secretos.

Construir una imagen inmutable y promover el mismo digest entre entornos. Tags humanos ayudan, pero no identifican de manera suficiente lo desplegado.
Describir estrategia de rollout, checks de salud y rollback al digest anterior. No asociar push a migraciones automáticas sin un workflow revisado y documentado.

## Runbooks mínimos por servicio

- Arranque local y configuración de dependencias.
- Diagnóstico: liveness, progreso, logs y métricas.
- Proveedor degradado, saturación, DLQ y redrive seguro.
- Rotación de secretos y recuperación de acceso.
- Rollback de app; recuperación de datos separada si hay persistencia.

Cada runbook debe indicar señales, pasos, evidencia de recuperación y límites de actuación.

## Readiness de lanzamiento

Owner y contacto de operación asignados; SLO/alertas con runbooks; capacidad/cuotas revisadas; recuperación probada; CI obligatorio; riesgos aceptados con responsable.
No inventar un SLO o un responsable para llenar el checklist. Un dato pendiente bloquea certificar el lanzamiento correspondiente, no bloquea trabajar en fases independientes.


## Desarrollo local y bases existentes

Fuentes: [Datos y migraciones](https://avanadecapital.atlassian.net/wiki/spaces/CEH/pages/386695169) y [SNS/SQS](https://avanadecapital.atlassian.net/wiki/spaces/CEH/pages/386760705), revisión 2026-10-16.

Prohibido conectar app local, clientes SQL o migraciones a la DB staging, incluso por túneles. ENV=LOCAL no bloquea una dirección remota; revisar conexiones y réplicas.

1. Si un desarrollo existente o nuevo necesita una base existente, ingresar a la cuenta AWS staging, S3 → commodo-dump-files-stg.
2. Elegir solo los dumps de las bases requeridas según fecha y compatibilidad; no fijar un nombre histórico como “último”.
3. Descargar fuera de Git y del contexto Docker. S3 real es la fuente del dump; LocalStack no contiene ese bucket corporativo. No pasar credenciales de descarga al proceso local.
4. Restaurar en PostgreSQL local compatible, verificando formato real y destino; no sobrescribir trabajo local. No asumir anonimización por estar almacenado en S3.
5. Configurar DATABASE_CONFIGURATIONS con destinos y credenciales locales. Revisar historial migrations antes de ejecutar pendientes; synchronize:false.
6. Para bases nuevas independientes, migraciones/fixtures; para servicios sin DB, omitir descarga y conexiones.

Docker levanta solo dependencias necesarias: LocalStack emula APIs AWS compatibles; PostgreSQL ejecuta SQL; Redis/Valkey cubre el motor de caché; ElastiCache es administrado en AWS; Redpanda es Kafka, no reemplazo directo SNS/SQS. Fijar versiones compatibles, puertos/red según host o contenedor y preservar volúmenes. LocalStack no prueba IAM ni paridad productiva.

## SNS/SQS: elección antes de implementación

SQS directo: productor → cola → worker. SNS fan-out: productor → topic → cola independiente por consumidor lógico → workers.
Workers en una cola compiten; no reciben todos una copia.
Infraestructura aprovisiona topics, colas, suscripciones, IAM, DLQs mediante IaC/PR. La librería no crea esos recursos.
Usar RawMessageDelivery=true si SqsConsumerBase espera envelope directo. Registrar la entidad outbox y su migración según la versión instalada. En shared-libs 4.0.0 SNS y SQS usan EventOutboxEntity en event_outbox; no habilitar sns_event_outbox para ese flujo.
No inferir relay, atomicidad o exactly-once por registrar outbox; comprobar contrato de la versión publicada.
Guía de código: [Implementar SNS y SQS](https://avanadecapital.atlassian.net/wiki/spaces/CEH/pages/403111938).

## Entrega trazable

Fuente: [Metodología oficial](https://avanadecapital.atlassian.net/wiki/spaces/CEH/pages/397049857).
El equipo confirma HU/aceptación en Jira antes de desarrollar y declara dependencias DevOps, ambiente y siguiente responsable.
PR revisado antes de merge: ticket, alcance, versiones, pruebas/CI, migraciones, configuración, dependencias, instrucciones UAT, observabilidad, riesgos y recuperación.
Git Flow: feature/* → develop → release/main → pre-prod → prod; hotfix desde prod y sincronización posterior. Pipelines declaran el mapeo ambiente/rama.
No transferir como listo a QA sin validación del developer. QA registra recepción, casos, datos autorizados, build, evidencias y resultado; no modifica esquema manualmente para compensar entregas incompletas.
Los bloqueos se comunican al detectarse; un crítico se escala el mismo día. Jira mantiene el siguiente responsable y acción.
Estas obligaciones del equipo no autorizan al agente a enviar mensajes, ejecutar migraciones, desplegar ni modificar tickets sin encargo explícito.

## Persistencia opcional

## Regla común

Cero conexiones por defecto. Incluir DB/Redis únicamente con necesidad explícita y capacidad declarada en el perfil.
No conectar como efecto lateral de importar shared-libs ni persistir logs técnicos en tablas.

## TypeORM

El consumer registra entidades propias y conexiones nombradas mediante APIs públicas de DBManagmentModule. forFeature e InjectRepository deben usar el mismo nombre.
Migraciones viven en el consumer, nunca en el tarball compartido. createMigrationDataSource usa historial migrations; preservar tablas históricas hasta reconciliarlas.
Para ejecutar TS publicado: launcher CommonJS con TS_NODE_SKIP_IGNORE=true, tsconfig-paths/register antes de typeorm/cli-ts-node-commonjs. No alias genérico de shared-libs.

Evolucionar con expand/contract; índices y cambios bloqueantes requieren evaluación de volumen. Migraciones como paso explícito, ejecutor único, timeout y estrategia de recuperación. Rollback de aplicación no implica que una migración destructiva sea reversible.

## Redis

Conexiones explícitas y nombradas; endpoint compartido puede usar DB lógicas si el modo lo permite. REDIS_TUNNEL_* solo redirige host/port, no crea túneles.
Definir TTL, invalidación, tolerancia a pérdida y política de caché. No convertir caché en fuente de verdad accidental.

## Outbox e idempotencia

Si se requiere atomicidad DB/evento, operación y outbox comparten transacción; definir relay, reintentos, reclamación/concurrencia y limpieza. Una entity outbox sola no garantiza entrega.
El almacenamiento de idempotencia necesita clave única, estados/lease, retención y política ante fallos. Documentar la ventana de efecto externo, que una transacción local no elimina.

Notifications no habilita estas capacidades actualmente. No importar migraciones o credenciales de ejemplo a la futura base mínima.

## Shared-libs 4.0.0: outbox e idempotencia transaccional

Contrato para servicios que declaran DB + mensajería en su perfil. No instala dependencias, abre conexiones ni migra automáticamente servicios sin DB.

**Tablas existentes y responsabilidad:**

- `event_outbox` (`EventOutboxEntity`, `OutboxStatus`): intención durable y resultado de envío; SNS/SQS se distinguen por transport y destino.
- `event_processing_log` (`EventProcessingLogEntity`, `ProcessingStatus`): una fila por recepción/intento, fuera de la transacción de negocio para que FAILED sobreviva a su rollback.
- `processed_events` (`ProcessedEventEntity`): marca que comparte manager y transacción con el negocio. PK técnica `id bigint`; `consumer varchar(120) NULL`; UNIQUE(event_id) WHERE consumer IS NULL y UNIQUE(consumer,event_id) WHERE consumer IS NOT NULL.

**Publicación/API:** validar request y payload de dominio, construir Envelope con eventId estable, escribir negocio y llamar `publisher.enqueue(manager, envelope, options)` dentro de la misma transacción. Esta API inserta PENDING y valida la estructura del envelope; el dominio sigue siendo responsabilidad del servicio. Esperar commit y luego `publisher.publish(envelope, { ...options, outboxId: row.id })`; en SQS usar `throwOnError: true` si el caller necesita conocer el fallo. Éxito AWS: SENT, sent_at y send_attempts++; fallo: SEND_FAILED, last_error y send_attempts++. No usar publish sin outboxId para una fila ya creada.

El consumer implementa el relay de recuperación de PENDING/SEND_FAILED, filtra transporte/destino y serializa dispatch por fila. La librería no lo arranca ni reclama filas automáticamente. Si AWS acepta y falla el update, el resultado es ambiguo: puede duplicarse el envío; conservar eventId en los reintentos. La unicidad de event_outbox.event_id sigue siendo global: una fila por envío lógico/destino; fan-out se resuelve con SNS. SNS enqueue rechaza atributos binaryValue; publish directo conserva el soporte previo.

**Consumo/worker:** ReceiveMessage → guardar RECEIVED fuera de la transacción de negocio → parsear/validar Envelope → insertar marca dentro de la transacción, antes de los efectos → ejecutar negocio y esperar commit. Conflicto: no negocio, SKIPPED_DUPLICATE + DeleteMessage. Éxito: PROCESSED + DeleteMessage. Fallo: FAILED sin DeleteMessage; reintentos hasta DLQ según redrive configurado por infraestructura. Un envelope inválido queda FAILED y se retiene para reintento/DLQ; IDs ilegibles se registran como UNKNOWN, sin almacenar su body.

Configurar `SqsConsumerOptions` con `{ queueUrl, consumer: '<nombre-logico-estable>', transactionalIdempotency: true }`. Todas las réplicas del mismo worker usan el mismo nombre; distintos consumidores del fan-out usan nombres distintos, nunca IDs de instancia. Importar desde `@commodo-sas/shared-libs/sqs`:

```typescript
protected async handleMessage(envelope: SqsEnvelope, context?: SqsProcessingContext): Promise<void> {
    if (!context) throw new Error('Processing context required');
    await this.dataSource.transaction(async (manager) => {
        if (!(await context.markProcessed(manager))) return;
        await this.applyBusinessEffects(manager, envelope.payload);
    }); // Resolver después del COMMIT; propagar errores y rollback.
}
```

`context.markProcessed(manager): Promise<boolean>` fija consumer/eventId/eventType y comunica el resultado a la base; evita otra marca fuera de la transacción. El manager debe pertenecer al mismo DataSource que processed_events y cubrir también todos los efectos DB. false implica salir sin negocio; no capturar el error para continuar ni revertir solo la marca mediante un savepoint. La base no puede demostrar que el handler respetó ese contrato.

Para handlers propios, la firma exportada es `markProcessed(manager: EntityManager, input: { consumer?: string | null; eventId: string; eventType: string }): Promise<boolean>`. Exige transacción activa y usa INSERT ... ON CONFLICT DO NOTHING RETURNING event_id. Con SqsConsumerBase usar el wrapper del contexto; llamar al helper libre no comunica su resultado a la base. La lectura previa `isProcessed(manager, key)` es orientativa; el índice arbitra concurrencia. `save`/`upsert` no son mecanismos de claim: save decide por PK y no expresa esa adquisición atómica.

**Compatibilidad y migración:** 4.0.0 es major porque la identidad ORM cambia de eventId a id y cambia el tratamiento del mensaje inválido. No eliminar exports/estados existentes ni asumir que conservar el handler hace compatibles todos los usos ORM. Mantener synchronize:false. Actualizar primero la librería en workers legados: su handler sin consumer funciona con el código nuevo, con columnas nuevas ausentes o presentes, mediante SQL que las omite. El binario antiguo que consulta solo event_id no distingue scopes.

Después ejecutar, solo con autorización y desde el consumer, la migración revisada: añadir consumer nullable e id bigserial; crear ambos índices parciales y sustituir la PK event_id por id. Revisar esquema, FKs, índices únicos globales adicionales y bloqueos; no usar CASCADE para forzar el cambio. No asignar consumer a filas históricas: quedan NULL. Activar nombres nuevos puede reprocesar eventos históricos, pues NULL no bloquea scopes con nombre; acordar corte/replay antes de activar. Acceso ORM directo a la entidad nueva exige migración incluso con consumer NULL. El modo scoped antes de migrar falla, deja FAILED y no ejecuta negocio ni borra el mensaje; no degrada silenciosamente a global. El modo legado conserva la ventana de doble efecto hasta adoptar la transacción.

SQL completo, alternativas y contrato de referencia, fijados al commit de entrega:
[guía de shared-libs 4.0.0](https://github.com/Commodo-SAS/commodo-shared-libs/blob/a9693681c/docs/ai/release-4.0.0-idempotency.md).
[Handoff y evidencia de publicación](https://github.com/Commodo-SAS/commodo-shared-libs/blob/5a997067e/docs/ai/handoff-4.0.0.md).
En checkout local se encuentran en el repo vecino `../commodo-shared-libs/docs/ai/`.

**Adopción y límites:** instalar la versión exacta publicada desde GitHub Packages con el gestor oficial y regenerar su lockfile; no usar file:, links ni copias. Declarar la adopción real en el perfil. At-least-once con idempotencia de efectos en una DB/transacción; no exactly-once. HTTP, proveedores, otras bases y AWS requieren idempotencia/outbox propias. Un fallo de log/DeleteMessage tras commit conserva la marca para deduplicar una reentrega; una DB caída puede impedir registrar FAILED. La publicación del paquete no valida al consumer.

Controles pendientes según alcance y autorización: fan-out con mismo eventId en dos scopes, duplicado por scope y NULL, compatibilidad antes/después de migrar, rollback/commit concurrentes, caída tras commit antes del delete, envelope inválido, fallo de logging y recuperación de outbox con aceptación AWS ambigua. No crear ni ejecutar pruebas sin encargo explícito.

## Fiabilidad y mensajería

## Consumidores

- Asumir entrega al menos una vez. Eliminar/confirmar solo después del resultado esperado; separar fallo de procesamiento y fallo de confirmación.
- Declarar clave de idempotencia, alcance, retención y garantía real por operación. Un set en memoria no ofrece deduplicación durable.
- El intervalo envío exitoso/confirmación fallida puede duplicar un efecto. Un registro local tampoco vuelve atómica una llamada externa; usar idempotency key del proveedor si existe.
- Clasificar errores permanentes y transitorios. Reintentos limitados con backoff/jitter; evitar multiplicación entre SDK, aplicación y broker.
- Configurar DLQ, maxReceiveCount, retención y alertas mediante infraestructura. Invalidaciones no se descartan silenciosamente.
- Reprocesar DLQ con selección, límite de tasa, trazabilidad y evaluación de duplicados. Nunca ejecutar redrive masivo como prueba.
- Ajustar visibility timeout al presupuesto de trabajo; extender con heartbeat si el trabajo lo requiere, con cancelación/límite total.
- Concurrencia y lotes acotados según cuotas del proveedor, memoria y downstream. Definir orden por entidad únicamente si el negocio lo exige.
- En SNS→SQS con envelope directo usar RawMessageDelivery=true. Verificar política de cola limitada al topic autorizado.

SQS puede volver a entregar mensajes; extender visibilidad reduce solapamiento, no garantiza unicidad del efecto. [AWS: procesamiento oportuno](https://docs.aws.amazon.com/en_en/AWSSimpleQueueService/latest/SQSDeveloperGuide/best-practices-processing-messages-timely-manner.html).

## Lifecycle y dependencias

Ante SIGTERM: dejar de recibir trabajo, cancelar long polling, drenar en vuelo hasta un deadline y cerrar clientes. Si no termina, permitir redelivery sin confirmar un trabajo incompleto.
Definir timeout de cada llamada y presupuesto end-to-end; no dejar shutdown esperando indefinidamente un proveedor.

Circuit breaker, rate limiting y bulkheads son recomendados cuando hay evidencia de saturación o fallos en cascada, no dependencias obligatorias del núcleo.

## Pruebas mínimas de worker

Envío válido; entrada inválida; error transitorio/permanente; fallo de delete posterior al envío; duplicado; expiración de visibilidad; cancelación y cierre con trabajo en vuelo; contexto de correlación aislado entre mensajes.

## Excepción actual

Notifications permanece sin DB/Redis por alcance explícito y admite duplicados. Esto se registra en el perfil y se revisa antes de reutilizarlo para efectos financieros u operaciones irreversibles.
