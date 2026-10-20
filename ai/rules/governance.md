# Gobierno del skeleton

## Producto interno

El skeleton tiene mantenedor técnico, versión, changelog y una matriz de compatibilidad (Node, Nest, TypeScript, pnpm, shared-libs). Esos responsables se asignan antes de su primera release.
La versión de las reglas se mantiene en [AGENTS](../../AGENTS.md); la plantilla ejecutable todavía no tiene release.

Distinguir tres mecanismos:
- Código común reusable: paquete shared-libs publicado.
- Automatización común: workflows reusables versionados cuando existan.
- Bootstrap de repos: template con versión de origen, perfil y guía de actualización.

No intentar mantener todos los repos sincronizados copiando carpetas sin historial. Cada adopción registra versión del template y upgrades aplicados.

## Cambios y excepciones

Actualizar la guía dueña y enlaces del AGENTS; una norma no debe vivir duplicada en Cursor, Claude y PR templates.
Un ADR explica problema, alternativas, decisión, consecuencias, validación y revisión. Excepciones: alcance, riesgo, compensación, responsable y caducidad.
Cambios incompatibles del skeleton incluyen guía de migración. Usar SemVer para su distribución; no acoplar su versión a la del servicio.

Revisar la base en cada release y periódicamente (propuesta: trimestral); atender antes fin de soporte o riesgo crítico. No se crea una automatización por documentar esa periodicidad.

## Nuevos repos

Seguir la sección de adopción de esta guía para distribuir acuerdos
de trabajo. Adoptar instrucciones no certifica el skeleton ejecutable.

Completar el perfil, seleccionar capacidades y eliminar proveedores/dominios de ejemplo que no apliquen.
Verificar desde un checkout limpio: instalación, gates, runtime local, Docker, ausencia de nombres/secretos del servicio origen y docs sin rutas absolutas de una máquina.
Validar al menos un API y un worker de ejemplo antes de declarar ambos perfiles soportados. Hasta entonces, soporte limitado al perfil que pasó pruebas.

## Límite de alcance

La base técnica propuesta es backend NestJS. Para frontend, librería publicable u otro stack se necesita otra distribución/perfil con gates propios. Los principios de seguridad, calidad y gobierno sí pueden compartirse.

## Adoptar AGENTS en el equipo

La base 2.4.0 organiza el trabajo en planificación, desarrollo, pruebas y documentación.
`AGENTS.md` es transversal: se comparte sin cambios entre repos y no contiene reglas propias de un servicio;
estas viven en el `docs/service-profile.md` de cada repo. Es compartible; no certifica el skeleton ejecutable ni otros repos.

## Fuente canónica

El `AGENTS.md`, el `CLAUDE.md`, las guías de `ai/rules/`, `ai/playbook/`, `ai/agents/` y las plantillas de `ai/templates/`
se toman del repo **`commodo-backend-skeleton`, rama única `skeleton`**. Esa rama es la única fuente:

- Los repos consumidores copian desde ella y no modifican esos archivos. Si necesitan algo distinto, lo
  registran en su `docs/service-profile.md` o en un ADR.
- Un cambio transversal se propone por PR contra la rama `skeleton`, sube la versión de las reglas
  (encabezado de `AGENTS.md`) y deja constancia en la alineación con Confluence.
- Cada repo registra en su perfil la versión de reglas adoptada y la fecha de la copia. Para homologar,
  comparar el archivo del repo contra la rama `skeleton` (por ejemplo, en la revisión periódica) y volver a copiar si difiere.
- No hay sincronización automática ni se editan otros repos desde un cambio en la fuente.

## Adopción

1. Copiar el `AGENTS.md` y el `CLAUDE.md` raíz desde la rama `skeleton` de `commodo-backend-skeleton`, sin modificarlos, junto con las guías de `ai/rules/` que enlaza. Registrar
   versión adoptada y diferencias locales. Para otro stack, adaptar Nest/shared-libs/logger en las guías, no en `AGENTS.md`.
2. Crear `docs/service-profile.md`: propósito, stack, módulos/rutas principales, capacidades activas,
   comandos reales de desarrollo y validación focalizada, límites, referencias y las reglas,
   criterios y excepciones propios del repo.
3. Documentar cada feature en `docs/<nombre-feature>/` y sus pendientes en `docs/todo/<nombre-feature>.md`;
   las decisiones y excepciones van en `docs/decisions/`.
4. Adaptar todos los enlaces; crear solo guías necesarias y retirar rutas inexistentes.
   No copiar perfiles, planes, ADRs, evidencias o pendientes del repositorio de origen como propios.
5. Añadir instrucciones anidadas solo si un módulo necesita acuerdos distintos;
   describir diferencias sin duplicar la raíz. Revisar también overrides globales.
6. Iniciar una sesión nueva y pedir al agente que identifique instrucciones activas,
   objetivo, etapa y validaciones previstas. Comprobar una tarea documental y otra de código.
7. Revisar evidencia: documentación sin gates de código, implementación sin lint por edición,
   controles locales solo por indicación explícita y gates completos de CI antes de integrar.

Crear/modificar tests y documentación también requiere indicación explícita. Cada
entregable informa implementación, creación de tests, ejecución de pruebas, validaciones
y documentación por separado. Terminar código implica comunicar enseguida esos pendientes,
sin iniciar etapas no solicitadas ni crear archivos para registrarlos sin solicitud documental.

## Contexto y descubrimiento

Según la [documentación oficial de OpenAI](https://learn.chatgpt.com/docs/agent-configuration/agents-md),
Codex construye instrucciones al iniciar: combina configuración global y archivos desde
la raíz hasta el directorio de trabajo. En cada directorio, `AGENTS.override.md` tiene prioridad
sobre `AGENTS.md`; instrucciones más cercanas especializan las anteriores.
El límite combinado predeterminado es 32 KiB. Tras cambiar instrucciones, iniciar una sesión
nueva para verificar su carga. No asumir que todas las instrucciones de subcarpetas se cargan desde la raíz.

Claude Code no lee `AGENTS.md` por sí solo, sino `CLAUDE.md`: cada repo incluye un `CLAUDE.md` en la raíz cuyo único contenido es `@AGENTS.md`,
para que `AGENTS.md` siga siendo la única fuente de reglas y no se dupliquen.
Los enlaces no incorporan automáticamente su contenido; la raíz indica cuándo consultarlos.
Un mapa breve en el perfil y checkpoints de trabajos largos en su plan permiten recuperar
contexto sin leer todo cada vez. Ningún archivo garantiza memoria ilimitada o cumplimiento
perfecto: verificar fuentes activas y comportamiento al adoptar o cambiar reglas.

## Mantenimiento

Cada norma tiene una fuente dueña; reglas de IDE y plantillas PR deben enlazarla.
Versionar cambios y actualizar consumidores mediante cambios revisables, sin modificar
otros repos automáticamente. Las decisiones locales se mantienen en el [índice de ADRs](../../docs/decisions/README.md);
la sincronización corporativa sigue en el [registro de pendientes](../../docs/todo/README.md).

