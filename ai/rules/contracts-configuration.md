# Contratos, configuración y dependencias

## Entradas y compatibilidad

- Validar DTOs HTTP y envelopes/payloads de eventos con class-validator/class-transformer en el límite de entrada. No convertir silenciosamente tipos inválidos para conseguir un envío.
- Establecer límites de longitud/tamaño, campos requeridos, formatos y versiones soportadas. Documentar política de campos desconocidos; rechazar todos por defecto puede romper evolución aditiva de eventos.
- Distinguir errores de entrada, negocio, proveedor y transporte con códigos estables. No responder con stacks ni serializar objetos de error completos.
- Para APIs, documentar autenticación, autorización por recurso/tenant, errores, paginación y límites cuando apliquen. Endpoints públicos se declaran explícitamente.
- Añadir campos opcionales de forma compatible. Renombrar, retirar o cambiar semántica exige estrategia de migración y pruebas de contrato con consumidores.
- Eventos identifican eventId, eventType, version, occurredAt, productor y entorno; conservan requestId/correlationId/transactionId y contexto de trazas cuando exista.

## Fuentes de configuración: estándar obligatorio

El archivo `.env` local debe estar limpio y contener únicamente:

```dotenv
ENV=LOCAL
```

- Está prohibido agregar otras variables de configuración de aplicación al .env, al entorno del shell, a Compose o a la task definition para eludir esta regla.
- Toda configuración de aplicación, incluidos puertos, región de clientes AWS, endpoints, topics, colas, flags y proveedores, viene de `secrets.local.json` en LOCAL o de AWS Secrets Manager en AWS. No usar fallbacks a variables de entorno.
- `ENV` es el selector explícito de arranque. Compilar no selecciona secretos. El JSON se mantiene privado y fuera de Git, imágenes y logs; solo se versiona su ejemplo sanitizado.
- En ECS, el SDK obtiene credenciales temporales mediante el **task role**. No configurar AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN, AWS_PROFILE, archivos de credenciales ni llamadas manuales a AssumeRole para autenticar la tarea. No guardar credenciales del task role en Secrets Manager.
- El task role debe tener los permisos necesarios; el execution role tiene otra función. Los metadatos/variables internos que ECS y el SDK gestionan automáticamente no son configuración de aplicación añadida por el desarrollador y no deben eliminarse.
- Para emuladores locales, endpoints y credenciales ficticias requeridas también se obtienen del JSON mediante el loader y se entregan al cliente; no se agregan variables AWS al .env.
- La autenticación de la CLI para descargar dumps de S3 es una operación separada del arranque de la aplicación; no trasladar su perfil o credenciales a .env.
- El rol resuelve autenticación y permisos, no el nombre del secreto ni todos los parámetros de bootstrap. El contrato de descubrimiento del secreto debe resolverse explícitamente en el loader; no inventar variables adicionales ni afirmar que ya está implementado.
- Todos los consumidores obtienen configuración por getters públicos de EnvironmentUtils. ConfigService solo interviene en la inicialización del loader para el selector permitido; el código consumidor no lee process.env ni ConfigService directamente.
- Validar los grupos obligatorios al iniciar con errores sanitizados. No aplanar grupos sin necesidad de compatibilidad demostrada.

Esta regla fue solicitada el 2026-10-16. La política y el estado del código son distintos: cada repo registra brechas concretas en su perfil, sin introducir detalles de negocio en esta guía común.
Referencia AWS: [task IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html).

## Shared-libs y toolchain

- Fijar versión exacta del paquete publicado; instalación reproducible con lockfile y frozen-lockfile en CI/Docker.
- Usar exports por subpath; aliases específicos solo cuando lo requiera la distribución TypeScript y validarlos con el paquete instalado.
- Si falta una API, cambiar/publicar shared-libs en su repo y luego actualizar el consumer. No simular una release con enlaces locales.
- Preferir estable para nuevos servicios; una RC necesita motivo, pruebas y ruta de actualización. Registrar la versión instalada y su compatibilidad en el perfil del servicio.
- Mantener Node LTS soportado y pnpm fijados de forma coherente entre host, CI e imagen. Verificar compatibilidad antes de actualizar; no elegir versiones nuevas solo por su número.
- Registrar cambios de dependencia con motivo, validación y plan de rollback. No modificar lockfiles a mano para silenciar errores.


## Implementación de secretos en el consumidor

Base: [Secrets e infraestructura local, v6](https://avanadecapital.atlassian.net/wiki/spaces/CEH/pages/386498581), consultada el 2026-10-16. La política .env mínimo indicada arriba es una actualización del usuario posterior a esa edición; no se declara todavía sincronizada en Confluence.

- La selección LOCAL/AWS pertenece a EnvironmentUtils de shared-libs: consulta ENV con ConfigService en su constructor; getAllVariables carga y luego llama adaptSecrets.
- El .env de la raíz contiene únicamente ENV=LOCAL y el loader lo carga antes de seleccionar la fuente. Lee secrets.local.json desde process.cwd(); archivo ausente/JSON inválido falla sin fallback a AWS. El arranque AWS debe resolver el secreto mediante el contrato de bootstrap del loader; los requisitos heredados se registran en el perfil. NODE_ENV o un campo dentro del JSON no seleccionan el loader.
- Sin adaptación propia, importar EnvironmentConfigModule desde @commodo-sas/shared-libs/environment-config.
- Con adaptación, registrar una subclase propia; su factory async crea la instancia y espera getAllVariables(); publicar el token EnvironmentUtils con useExisting. No registrar también el módulo estándar.
- ConfigService solo inicializa el loader. Getters propios exponen configuración a las factories/servicios sin lecturas dispersas de process.env.
- Compilar no incorpora secretos. Ejecutar desde la raíz; en Docker montar el JSON en el directorio esperado y suministrar únicamente ENV=LOCAL como selector de aplicación. Excluirlo de Git y contexto Docker; versionar secrets.local.example.json sanitizado.
- Si el arranque consulta AWS, revisar ENV y el provider registrado. Si no encuentra JSON, revisar directorio de ejecución. Nunca imprimir el contenido completo para diagnosticar.

Ejemplo de wiring para una subclase ProjectEnvironmentUtils previamente implementada:

```typescript
{
    provide: ProjectEnvironmentUtils,
    useFactory: async (config: ConfigService) => {
        const environment = new ProjectEnvironmentUtils(config);
        await environment.getAllVariables();
        return environment;
    },
    inject: [ConfigService],
},
{ provide: EnvironmentUtils, useExisting: ProjectEnvironmentUtils },
```

Importar ConfigModule.forRoot({ isGlobal: true }) en el módulo de configuración, exportar ambos tokens e importar ese módulo en la raíz. El ejemplo muestra providers, no un archivo completo.
