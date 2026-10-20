# Stack Context (Backend)

## Core Technologies
- **Framework:** NestJS v10
- **Language:** TypeScript 5+
- **Database:** PostgreSQL (AWS Aurora RDS)
- **ORM:** TypeORM v0.3
- **Queues:** Bull (Redis-backed)
- **Messaging:** Kafka (via KafkaJS / Redpanda)

## Architecture
- **Monorepo:** Managed by Nest CLI + custom scripts (libs/apps structure).
- **Apps:**
  - `commodo-backend-core`
  - `billing`
  - `transaction-manager`
  - `jobs`
  - `external-services` (Wompi, Nequi, etc.)
  - `marketing-tools`
- **Libs:** Shared logic in `libs/` (e.g., `db-managment`, `storage`, `auth`).

## Testing
- **Unit:** Jest (`*.spec.ts`) alongside files.
- **Integration:** `test/` folder or `*.e2e-spec.ts`.
- **Mocking:** Heavy use of Dependency Injection mocking.

## Production Infrastructure (AWS)
**Topology:** Centralized API Gateway → EC2 Instances (managed via PM2).

### Services Breakdown
| Service Group | Component | Responsibility |
|:---|:---|:---|
| **CORE_SERVICES** | `app core` | Webhooks, Payment Gateways (Pasarelas). |
| **INTEGRATIONS** | `transaction-manager` | Fuel businesses (Combustible). |
| **AUTH_CORE** | `app core` | Authentication & Identity Management. |
| **MOBILE_CORE** | `app core` | Endpoints for Commodo App (iOS/Android/Huawei) & Commodo Pay. |
| **EXTERNAL_SERVICES** | `external-services` | Integrations: Wompi, Nequi, Daviplata, Transmetro, Truora, Commodo Wallet. (Note: Refacil deprecated). |
| **BILLING** | `billing` | Invoicing and Tax logic. |
| **TRANSACTION_MANAGER** | `transaction-manager` | High-demand non-fuel businesses. |
| **JOBS** | `jobs` | Cron jobs, scheduled tasks. |
| **PILOT** | `marketing-tools` / `core` | Backing the NextJS Web Platform. Campaigns, SMS, Emails. |

### Consumers / Clients
1.  **PILOT (Web Platform):** NextJS on AWS Amplify. Consumes `marketing-tools`, `billing`, `external`.
2.  **COMMODO PAY (Mobile):** Android (Datáfonos: Credibanco, Redeban, Bold, Nexgo N86). High interaction with server cluster.

### Data & Security
- **Database:** AWS Aurora RDS PostgreSQL.
  - **Monitoring:** Performance Insights enabled.
- **Secrets:** AWS Secrets Manager (injected into PM2 processes).
- **Process Management:** PM2 on EC2.

## Observability & Monitoring
- **API Gateway:** CloudWatch Metrics enabled (Detailed monitoring for HTTP errors, latency, and throughput).
- **Database:** Aurora RDS Performance Insights active for query analysis.
- **Logs:** Centralized logging strategy (TBD: Transition to CloudWatch Logs).
