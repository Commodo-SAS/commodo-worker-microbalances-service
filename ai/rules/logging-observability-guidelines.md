# Observabilidad y operación medible

## Logs

- Usar ObservabilityModule/CommodoLoggerService. JSON por stdout/stderr; transport externo para almacenamiento.
- Campos estables: service, environment, version, event, category, outcome, duración y contexto disponible. Eventos en minúsculas con puntos.
- debug: pasos internos; info: finalización relevante; warn: rechazo/reintento/degradación; error: fallo accionable. Una capa es dueña del diagnóstico de cada fallo.
- Diferenciar provider accepted, procesamiento completado y confirmación de cola. No afirmar entrega al dispositivo a partir de aceptación Firebase.
- No registrar cuerpos, tokens, datos personales, credenciales ni respuestas completas. Códigos sanitizados y allowlist de metadatos.
- Fallar al emitir logs técnicos no debe duplicar ni bloquear negocio. Auditoría durable de negocio, si se exige, necesita diseño de entrega, retención y acceso propio.

## Trazas y métricas

Preservar traceparent/tracestate y correlación mediante APIs públicas del paquete. Validar contexto de entrada y crear spans de consumidor/proveedor; no reconstruir traceId con un split sin validación.
OTel/OTLP es opt-in por configuración. En AWS puede usarse ADOT; no activar exportadores sin destino ni copiar X-Ray legacy a servicios nuevos.

No transportar secretos en baggage: puede propagarse a servicios externos. [OpenTelemetry: baggage](https://opentelemetry.io/docs/concepts/signals/baggage/).

Métricas de worker: tasa de procesamiento, latencia, errores por código acotado, intentos, antigüedad de cola, mensajes visibles/en vuelo y DLQ. No usar eventId, token o userId como etiquetas de métricas por su cardinalidad.

## SLO y alertas

Antes de producción definir SLI, objetivo, ventana, exclusiones y responsable. Propuesta inicial: tiempo desde encolado hasta aceptación del proveedor y proporción de éxito, sin inventar porcentajes hasta medir la línea base.
Alertar por consumo de presupuesto de error, antigüedad de cola, crecimiento DLQ y falta de progreso; cada alerta enlaza un runbook.

Liveness comprueba proceso HTTP exclusivamente. Readiness, si aplica, tiene endpoint/semántica separados y chequeos baratos con timeout; no provocar reinicios por un fallo externo. El worker necesita señal de progreso además de HTTP 200.

Capturar versión de aplicación y build en telemetría. Definir retención, acceso y presupuesto de logs/traces; sampling no debe eliminar evidencia de fallos críticos.
