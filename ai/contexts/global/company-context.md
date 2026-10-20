# Commodo Company Context

## Vision
Commodo es un **ecosistema tecnológico integral** de lealtad, cashback y pagos digitales. Nuestra misión es conectar aliados comerciales con usuarios finales, convirtiendo compras habituales en recompensas digitales.

## Nuestro Core de Negocio
Somos un programa de fidelización donde nuestro mayor aliado es **Petromil** (Líder en Oil & Gas en Colombia).
- **Aliados Combustible:** Estaciones de servicio (EDS). El cashback y la facturación se basan en **galones tanqueados**.
- **Aliados No Combustible:** Restaurantes, bares, gimnasios, etc. El cashback y la facturación se basan en **porcentajes**.

### Procesos Key
1. **Cashback (Lealtad):** Entrega de recompensas (1 Commodo = 1 COP).
2. **Micro-Saldos (Bolsas):** Trazabilidad individual de cada cashback con lógica de expiración y cobertura de saldos negativos.
3. **Facturación:** Cobro de comisiones por cada cashback entregado según ciclo de facturación y condiciones comerciales.
4. **Líneas de Crédito:** Los programas de cashback de los aliados se financian a través de líneas de crédito asignadas.

## Ecosistema de Productos
1. **B2C App (Mobile):** Usuarios finales. Consulta de saldos, redenciones (productos digitales/pines), recargas de movilidad, cupones y transferencias.
2. **Pilot Web B2B (Next.js):** Plataforma para aliados comerciales. Acceso a módulos de Marketing, Data Analytics y Facturación. Desplegada en AWS Amplify.
3. **B2B Admin Web:** Portal de administración central de Commodo (Banners, OTPs, Auditoría, Configuración de condiciones).
4. **B2B POS App (Mobile):** Desplegada en datáfonos (Credibanco, Redeban, Bold) para que colaboradores procesen pagos y lealtad.

## Integraciones Estratégicas
- **Nebula:** Recargas de transporte masivo (ej: Transmetro).
- **Puntos Red:** Compra de servicios (Recargas, Pines, Paquetes).
- **Siigo:** Facturación electrónica automática.
- **Truora:** Validación de identidad (actualmente apagada en producción).
- **CleverTap / Firebase:** Marketing, analytics y notificaciones push/SMS.
- **Kafka / Redpanda:** Procesamiento asíncrono de eventos transaccionales.

## Reglas de Oro (AI Context)
- **Atomicidad:** Procesos transaccionales (como Cashback) deben usar transacciones DB con nivel de aislamiento `SERIALIZABLE`.
- **Seguridad:** No loguear información sensible de tarjetas (PCI-DSS).
- **Eficiencia:** Considerar siempre el impacto en las líneas de crédito y micro-saldos.
