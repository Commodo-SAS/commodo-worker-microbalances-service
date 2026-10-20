# Guías activas

Leer primero [AGENTS](../../AGENTS.md) y el [perfil real](../../docs/service-profile.md).
Consultar únicamente la guía afectada; los enlaces no cargan automáticamente su contenido.

| Si la tarea afecta… | Guía dueña |
|---|---|
| Límites, dependencias, seguridad | [Arquitectura y seguridad](architecture-guidelines.md) |
| Secretos, bootstrap, contratos, shared-libs | [Contratos y configuración](contracts-configuration.md) |
| Pruebas, comandos y evidencia | [Calidad](testing-guidelines.md) |
| Docker, DB, Redis, SNS/SQS, entrega | [Operación, persistencia y fiabilidad](delivery-operations.md) |
| Logs, trazas, métricas, health | [Observabilidad](logging-observability-guidelines.md) |
| Adopción, excepciones y mantenimiento | [Gobierno](governance.md) |

Son seis guías temáticas y este índice; las antiguas guías de seguridad, persistencia, fiabilidad y adopción están integradas en sus dueñas.
[Confluence y diferencias](manual-developer-v2-alignment.md) registra fuentes y vigencia.
[Pendientes](../../docs/todo/README.md), [ADRs](../../docs/decisions/README.md), planes y evidencia se consultan por alcance, no como instrucciones adicionales.
[Referencias históricas](../../docs/reference/README.md) conserva procedencia; no aplicar reglas de publicación de shared-libs al consumer.

Los responsables se asignan por el equipo; no inferir owners ni certificar el skeleton desde documentación heredada.
