# Arquitectura y seguridad

## Núcleo reutilizable

La base técnica inicial es para backends NestJS/TypeScript, no una plantilla universal para frontends, Python o librerías publicables. Esos repos pueden reutilizar los principios con un perfil específico.

Estructura objetivo por feature (homologada con el módulo `transaction` de `commodo-transaction-manager-integrations`, en `apps/transaction-manager/src/modules/transaction`, que es la referencia viva):

```text
apps/<service>/src/
  main.ts                          bootstrap (setupApp) y ciclo de vida
  <service>.module.ts              composición
  modules/<feature>/               un servicio de una sola feature puede usar src/ directamente
    domain/
      enums/ errors/ interfaces/ models/
      ports/                       puertos; secondary/ para repositorios y mensajería de salida
    application/
      use-cases/<caso>/            <caso>.service.ts
      services/                    servicios; handlers/ para reglas por tipo
    infrastructure/
      adapters/
        primary/                   entrada: http/<feature>/, sqs/ (consumidores)
        secondary/                 salida: repositories/ (+ entities/), sqs/, proveedores
      config/  environment/        configuración validada y EnvironmentUtils propio
    <feature>.module.ts            bindings DI
```

Antes de crear carpetas o nombres, leer el módulo de referencia y homologar. Reglas:

- Ningún archivo suelto en la raíz de `domain/`, `application/` o `infrastructure/` (se admiten barrels `index.ts`): cada archivo va en la carpeta de su rol.
- Los puertos viven en `domain/ports`, nunca en `application`; los de persistencia y mensajería de salida en `domain/ports/secondary`, uno por agregado.
- Los servicios y handlers que aplican reglas sobre puertos viven en `application/services`; el dominio contiene modelos, enums, errores, interfaces y puertos.
- Consumidores SQS y controllers son adaptadores `primary`; repositorios, clientes SQS y publishers son `secondary`.
- Un repositorio por puerto, con una sola clase por archivo. Sin entidades compartidas disponibles, declarar entidades mínimas (solo las columnas usadas) en `infrastructure/adapters/secondary/repositories/entities`.
- Los `*.spec.ts` van junto al archivo que prueban; los dobles compartidos en `test/` del servicio.

Código y repos nuevos siguen esta estructura desde el inicio. No mover carpetas existentes solo por estética. Migrar una feature cuando aporte límites verificables y mantenga imports/contratos.

## Dependencias

- Dominio no importa Nest, AWS, Firebase, ORM ni configuración de runtime.
- Aplicación consume los puertos declarados en `domain/ports`. No importa adaptadores concretos.
- Infraestructura implementa puertos y traduce errores/resultados externos.
- El módulo compone implementaciones y lifecycle. Inyectar handlers y puertos por su clase abstracta (token tipado); no usar service locator.
- DTO de transporte y modelo de dominio tienen responsabilidades distintas; mapear donde cambien semántica o invariantes.
- Evitar servicios globales mutables, ciclos y librerías locales usadas como cajón de utilidades.
- Compartir código cuando tenga contrato estable y múltiples consumidores reales. Un contrato cross-repo pertenece al paquete apropiado y se publica; una regla exclusiva del negocio se queda en su servicio.

## Convenciones de nombres

Sufijo de archivo y clase según el rol, como en el módulo de referencia: caso de uso `<caso>.service.ts` (`<Caso>Service`), servicio `<nombre>.service.ts`, handler `<tipo>-transaction.handler.ts`, puerto `<agregado>.port.ts` (clase abstracta que es su propio token; `Symbol` solo con argumento escrito), repositorio `<agregado>.repository.ts`, entidad `<tabla>.entity.ts`, consumidor `<nombre>-sqs.consumer.ts`, cliente `<nombre>-sqs.client.ts`, modelo de evento `<nombre>.event.ts` o `models/`. Reutilizar los nombres del legado cuando se porta lógica, para poder contrastarla.

## Controles objetivo

Reglas automáticas de imports: dominio no alcanza infraestructura; aplicación no alcanza SDKs/adaptadores. Una prueba debe poder ejecutar el caso de uso con un puerto falso y sin AWS/DB.

Usar clases abstractas para los puertos inyectables (son su propio token), interfaces para contratos que se construyen por transacción y no se inyectan, y clases para entidades con invariantes. Un token `Symbol` o string requiere argumento escrito en el perfil o un ADR. La conexión a base de datos se registra siempre con `DBManagmentModule.forRoot` o, en servicios ligeros que mapean sus propias entidades, con `DBManagmentConnectionsModule.forRoot` (shared-libs 4.1.0 o superior). No exigir prefijos de nombres por costumbre si contradicen APIs públicas o librerías.

## Notifications

Firebase es una capacidad saliente específica, no parte del núcleo. La dependencia directa actual del dispatcher está pendiente de reemplazo, según el plan.

## Seguridad por defecto

- Validar entradas, tamaño y rate limits apropiados a HTTP/mensajes. Aplicar autorización por operación/recurso cuando exista acceso autenticado.
- No confiar en URLs/endpoints aportados por payloads; validar destinos permitidos antes de realizar llamadas.
- Roles AWS de mínimo privilegio por entorno y recurso. Separar permisos del CI, ejecución e infraestructura. No reutilizar credenciales productivas en local.
- Secretos vía configuración central; excluirlos de Git, contextos Docker, artefactos y logs. No volcar env/config para diagnosticar.
- Datos sensibles: minimizar, clasificar, acordar retención y acceso; borrado/rotación documentados.
- Imágenes con usuario sin privilegios y superficie mínima. Evaluar filesystem read-only, límites de recursos y capabilities cuando la plataforma lo permita.
- Revisar dependencias y generar SBOM en entrega; tratar hallazgos explotables con prioridad y excepciones con responsable/caducidad. Un scanner sin hallazgos no demuestra ausencia de vulnerabilidades.
- CI para PRs externos sin secretos; no ejecutar código no confiable con credenciales de publicación.

Recomendación para GitHub Actions: permisos explícitos mínimos, actions fijadas por SHA revisado y autenticación OIDC hacia AWS con condiciones restringidas al repositorio/entorno/ref. GitHub documenta estos mecanismos en [Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use). La autenticación al registro privado se configura separadamente según sus permisos reales; no asumir que OIDC reemplaza cualquier token.

Todo servicio con límites de confianza nuevos necesita un modelo breve de amenazas: activos, actores, entradas, permisos, abuso previsible y controles. Revisión especializada cuando toque datos sensibles, autorizaciones o superficies públicas.

La adopción documental no cambia IAM, protección de ramas ni secretos de organización. Se deben aplicar y verificar en la fase de plataforma.
