# Arquitectura y seguridad

## Núcleo reutilizable

La base técnica inicial es para backends NestJS/TypeScript, no una plantilla universal para frontends, Python o librerías publicables. Esos repos pueden reutilizar los principios con un perfil específico.

Estructura objetivo por feature:

```text
apps/<service>/src/
  main.ts                       bootstrap y ciclo de vida
  <service>.module.ts           composición
  environment/                  adaptación mínima de configuración
  modules/<feature>/
    domain/                     modelos, reglas puras, puertos
    application/                casos de uso
    infrastructure/
      inbound/                  HTTP, SQS, tareas
      outbound/                 proveedores, repositorios
    <feature>.module.ts         bindings DI
```

No mover carpetas existentes solo por estética. Migrar una feature cuando aporte límites verificables y mantenga imports/contratos.

## Dependencias

- Dominio no importa Nest, AWS, Firebase, ORM ni configuración de runtime.
- Aplicación consume puertos definidos por el caso de uso. No importa adaptadores concretos.
- Infraestructura implementa puertos y traduce errores/resultados externos.
- El módulo compone implementaciones y lifecycle. Inyectar handlers mediante un token tipado; no usar service locator.
- DTO de transporte y modelo de dominio tienen responsabilidades distintas; mapear donde cambien semántica o invariantes.
- Evitar servicios globales mutables, ciclos y librerías locales usadas como cajón de utilidades.
- Compartir código cuando tenga contrato estable y múltiples consumidores reales. Un contrato cross-repo pertenece al paquete apropiado y se publica; una regla exclusiva del negocio se queda en su servicio.

## Controles objetivo

Reglas automáticas de imports: dominio no alcanza infraestructura; aplicación no alcanza SDKs/adaptadores. Una prueba debe poder ejecutar el caso de uso con un puerto falso y sin AWS/DB.

Usar interfaces para puertos, clases para entidades con invariantes y tokens explícitos para DI. No exigir prefijos de nombres por costumbre si contradicen APIs públicas o librerías.

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
