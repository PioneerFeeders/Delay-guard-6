# DelayGuard - Technical Specification

**Version:** 1.0
**Date:** 2026-02-04
**Based on:** requirements.md (PRD v1.0)
**Status:** Draft

---

## 1. Technical Context

### 1.1 Language & Runtime

- **Language:** TypeScript ^5.2
- **Runtime:** Node.js >=20.19 (<22) or >=22.12
- **Build tool:** Vite ^6.2

### 1.2 Framework & Core Dependencies

| Package | Version | Role |
|---------|---------|------|
| `@remix-run/node` | ^2.16 | Server-side Remix runtime |
| `@remix-run/react` | ^2.16 | Client-side Remix hooks/components |
| `@remix-run/serve` | ^2.16 | Production HTTP server |
| `@shopify/shopify-app-remix` | ^4.1 | Shopify OAuth, session tokens, Admin API, billing, webhook auth |
| `@shopify/shopify-app-session-storage-prisma` | ^8.0 | Session persistence to PostgreSQL |
| `@shopify/polaris` | ^12.0 | UI component library |
| `@shopify/app-bridge-react` | ^4.1 | Embedded app bridge (toasts, navigation, modals) |
| `react` / `react-dom` | ^18.2 | UI rendering |
| `@prisma/client` / `prisma` | ^6.2 | ORM, migrations, type-safe queries |
| `bullmq` | ^5.x | Job queue and worker framework |
| `ioredis` | ^5.x | Redis client (BullMQ dependency) |
| `resend` | ^4.x | Transactional email delivery |
| `zod` | ^3.x | Runtime schema validation (forms, API responses, carrier data) |
| `date-fns` | ^3.x | Date arithmetic (business days, delay calculations) |

### 1.3 Infrastructure

| Service | Provider | Purpose |
|---------|----------|---------|
| Web server | Railway (service 1) | Remix HTTP server on port 3000 |
| Worker process | Railway (service 2) | BullMQ workers — same repo, different start command |
| PostgreSQL | Railway managed | Persistent data (sessions, merchants, shipments, logs) |
| Redis | Railway managed | BullMQ job queue backend |

### 1.4 External APIs

| API | Auth Method | Purpose |
|-----|-------------|---------|
| Shopify Admin API (GraphQL) | OAuth access token | Orders, fulfillments, customers, billing |
| Shopify webhooks | HMAC-SHA256 verification | Real-time fulfillment events |
| UPS Track API | OAuth 2.0 (app credentials) | Tracking status, delivery estimates, exceptions |
| FedEx Track API | OAuth 2.0 client credentials (app credentials) | Tracking status, delivery estimates, exceptions |
| USPS Web Tools API | User ID (app credential) | Tracking status, delivery estimates |
| Resend API | API key (app credential) | Sending notification emails |

### 1.5 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SHOPIFY_API_KEY` | Yes | Shopify app API key |
| `SHOPIFY_API_SECRET` | Yes | Shopify app API secret |
| `SHOPIFY_APP_URL` | Yes | Public URL of the deployed app |
| `SCOPES` | Yes | `read_orders,read_fulfillments,write_fulfillments,read_customers` |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `UPS_CLIENT_ID` | Yes | UPS API OAuth client ID |
| `UPS_CLIENT_SECRET` | Yes | UPS API OAuth client secret |
| `FEDEX_CLIENT_ID` | Yes | FedEx API OAuth client ID |
| `FEDEX_CLIENT_SECRET` | Yes | FedEx API OAuth client secret |
| `USPS_USER_ID` | Yes | USPS Web Tools user ID |
| `RESEND_API_KEY` | Yes | Resend transactional email API key |
| `NODE_ENV` | Yes | `development` or `production` |

---

## 2. Implementation Approach

### 2.1 Starting Point

Scaffold from the official Shopify Remix app template via `npx @shopify/create-app@latest`, then:

1. Switch the Prisma datasource from SQLite to PostgreSQL
2. Add custom Prisma models for the DelayGuard domain
3. Add BullMQ + ioredis for background processing
4. Create a separate `worker.ts` entry point for background jobs
5. Build the UI with Polaris components following Remix loader/action patterns

### 2.2 Key Architectural Decisions

**Embedded app with session tokens.** The Shopify Remix template uses token exchange (not redirect-based OAuth) for embedded apps. `authenticate.admin(request)` validates JWTs on each request. Offline tokens (never expire) are stored for background worker access to the Shopify API.

**Separate web and worker processes.** The Remix web server handles HTTP requests and enqueues jobs. A separate Node.js process (`worker.ts`) runs BullMQ workers that process carrier polling, delay detection, and email sending. Both processes share the same codebase, PostgreSQL, and Redis instances but run independently on Railway.

**Carrier adapters behind a common interface.** Each carrier (UPS, FedEx, USPS) implements a `CarrierAdapter` interface. A `CarrierService` delegates to the correct adapter based on the shipment's carrier field. This isolates carrier-specific API quirks and makes adding carriers straightforward.

**Database as source of truth for shipment state.** After initial sync and webhook ingestion, all shipment status lives in PostgreSQL. The dashboard reads from the database, not Shopify. Carrier polling updates the database. This decouples the UI from external API latency.

**BullMQ repeatable jobs for polling.** Instead of cron, use BullMQ's built-in repeatable job feature. A scheduler job runs every 15 minutes, queries the database for shipments due for polling, and enqueues individual carrier poll jobs. This provides automatic retries, backoff, and observability.

---

## 3. Source Code Structure

```
delayguard/
├── app/
│   ├── components/                    # Shared React/Polaris components
│   │   ├── dashboard/
│   │   │   ├── SummaryCards.tsx        # Metric cards (total, delayed, delivered, avg time)
│   │   │   ├── ShipmentTable.tsx       # Data table with selection, sorting, actions
│   │   │   ├── ShipmentDetailPanel.tsx # Expandable detail view
│   │   │   ├── FilterBar.tsx           # Filter controls
│   │   │   ├── TabNav.tsx              # Tab navigation (All, Delayed, Pending, etc.)
│   │   │   └── BulkActionBar.tsx       # Bulk action controls
│   │   ├── notifications/
│   │   │   └── SendNotificationModal.tsx
│   │   ├── resolution/
│   │   │   └── ResolveModal.tsx
│   │   ├── onboarding/
│   │   │   ├── WelcomeStep.tsx
│   │   │   ├── PreferencesStep.tsx
│   │   │   ├── SyncStep.tsx
│   │   │   └── TestModeStep.tsx
│   │   └── settings/
│   │       ├── PollingSettings.tsx
│   │       ├── DashboardPreferences.tsx
│   │       ├── NotificationSettings.tsx
│   │       ├── DisplaySettings.tsx
│   │       └── AccountBilling.tsx
│   │
│   ├── routes/
│   │   ├── app.tsx                     # Authenticated layout (AppProvider + NavMenu)
│   │   ├── app._index.tsx              # Main dashboard
│   │   ├── app.onboarding.tsx          # Setup wizard
│   │   ├── app.settings.tsx            # Settings page
│   │   ├── app.shipments.$id.tsx       # Shipment detail page (optional, if not using modal)
│   │   │
│   │   ├── api.shipments.tsx           # JSON API: list/filter/sort shipments
│   │   ├── api.shipments.$id.notify.tsx   # JSON API: send notification for a shipment
│   │   ├── api.shipments.$id.resolve.tsx  # JSON API: resolve a shipment
│   │   ├── api.shipments.bulk-notify.tsx  # JSON API: bulk send notifications
│   │   ├── api.shipments.bulk-resolve.tsx # JSON API: bulk resolve
│   │   ├── api.shipments.export.tsx       # JSON API: CSV export
│   │   ├── api.sync.tsx                   # JSON API: trigger manual re-sync
│   │   ├── api.billing.tsx                # Billing plan selection/callback
│   │   │
│   │   ├── auth.$.tsx                  # OAuth splat route (template default)
│   │   ├── webhooks.fulfillments.create.tsx
│   │   ├── webhooks.fulfillments.update.tsx
│   │   ├── webhooks.app.uninstalled.tsx
│   │   └── healthz.tsx                 # Health check endpoint
│   │
│   ├── services/                       # Business logic (server-side only)
│   │   ├── carriers/
│   │   │   ├── carrier.interface.ts    # CarrierAdapter interface definition
│   │   │   ├── carrier.service.ts      # Delegates to correct adapter, carrier detection
│   │   │   ├── ups.adapter.ts          # UPS Track API integration
│   │   │   ├── fedex.adapter.ts        # FedEx Track API integration
│   │   │   ├── usps.adapter.ts         # USPS Web Tools API integration
│   │   │   └── carrier.types.ts        # Shared types (TrackingResult, TrackingEvent, etc.)
│   │   ├── delay-detection.service.ts  # Delay flagging logic, grace period, default windows
│   │   ├── notification.service.ts     # Email template rendering, Resend integration
│   │   ├── sync.service.ts             # Initial fulfillment sync from Shopify
│   │   ├── billing.service.ts          # Plan management, limit checks
│   │   ├── shipment.service.ts         # CRUD operations, queries, filtering
│   │   └── resolution.service.ts       # Resolution workflow, audit logging
│   │
│   ├── jobs/                           # BullMQ job definitions (shared between web + worker)
│   │   ├── queues.ts                   # Queue name constants
│   │   ├── poll-scheduler.job.ts       # Determines which shipments need polling, enqueues them
│   │   ├── carrier-poll.job.ts         # Polls one shipment's carrier API
│   │   ├── fulfillment-sync.job.ts     # Processes initial sync for a merchant
│   │   ├── send-notification.job.ts    # Sends one notification email
│   │   └── data-cleanup.job.ts         # Archives delivered, purges uninstalled merchant data
│   │
│   ├── lib/                            # Shared utilities
│   │   ├── csv.ts                      # CSV generation for export
│   │   ├── business-days.ts            # Business day calculations
│   │   └── validation.ts               # Zod schemas (shared between routes and services)
│   │
│   ├── db.server.ts                    # Prisma client singleton
│   ├── queue.server.ts                 # BullMQ queue registry singleton (web process only enqueues)
│   ├── shopify.server.ts               # Shopify SDK config (OAuth, scopes, billing, webhooks)
│   ├── root.tsx                        # Remix root layout
│   ├── entry.client.tsx                # Client entry
│   └── entry.server.tsx                # Server entry
│
├── worker/
│   ├── index.ts                        # Worker entry point: connects Redis, starts all workers
│   ├── poll-scheduler.worker.ts        # Worker: runs every 15 min, enqueues carrier-poll jobs
│   ├── carrier-poll.worker.ts          # Worker: calls carrier API, updates shipment, detects delay
│   ├── fulfillment-sync.worker.ts      # Worker: syncs fulfillments from Shopify for one merchant
│   ├── send-notification.worker.ts     # Worker: sends email via Resend
│   └── data-cleanup.worker.ts          # Worker: archive/purge jobs
│
├── prisma/
│   ├── schema.prisma                   # Full database schema
│   └── migrations/                     # Prisma migration files
│
├── public/                             # Static assets (logos, favicon)
├── extensions/                         # Shopify app extensions (empty for v1)
│
├── .env.example                        # Environment variable template
├── .gitignore
├── Dockerfile                          # Container config (from Shopify template)
├── package.json
├── tsconfig.json
├── vite.config.ts
├── shopify.app.toml                    # Shopify app manifest
└── shopify.web.toml                    # Web server config
```

---

## 4. Data Model (Prisma Schema)

### 4.1 Overview

The schema retains the Shopify template's `Session` model for OAuth and adds five domain models: `Merchant`, `Shipment`, `TrackingEvent`, `NotificationLog`, and `ResolutionLog`.

### 4.2 Prisma Schema

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

// ── Shopify Session (from template) ──────────────────────────

model Session {
  id          String    @id
  shop        String
  state       String
  isOnline    Boolean   @default(false)
  scope       String?
  expires     DateTime?
  accessToken String
  userId      BigInt?

  @@index([shop])
}

// ── Merchants ────────────────────────────────────────────────

model Merchant {
  id                String   @id @default(cuid())
  shopifyShopId     String   @unique
  shopDomain        String
  email             String
  timezone          String   @default("America/New_York")
  settings          Json     @default("{}")
  planTier          PlanTier @default(STARTER)
  billingStatus     BillingStatus @default(PENDING)
  randomPollOffset  Int      @default(0)  // 0-239 minutes
  installedAt       DateTime @default(now())
  onboardingDone    Boolean  @default(false)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  shipments        Shipment[]
  notificationLogs NotificationLog[]
}

enum PlanTier {
  STARTER
  PROFESSIONAL
  BUSINESS
  ENTERPRISE
}

enum BillingStatus {
  PENDING
  ACTIVE
  CANCELLED
}

// ── Shipments ────────────────────────────────────────────────

model Shipment {
  id                      String    @id @default(cuid())
  merchantId              String
  shopifyOrderId          String
  shopifyFulfillmentId    String
  orderNumber             String
  trackingNumber          String
  carrier                 Carrier   @default(UNKNOWN)
  serviceLevel            String?
  customerName            String
  customerEmail           String
  customerPhone           String?
  shippingAddress         Json?
  shipDate                DateTime
  expectedDeliveryDate    DateTime?
  expectedDeliverySource  DeliverySource @default(DEFAULT)
  currentStatus           String    @default("pending")
  isDelayed               Boolean   @default(false)
  delayFlaggedAt          DateTime?
  daysDelayed             Int       @default(0)
  lastCarrierStatus       String?
  lastScanLocation        String?
  lastScanTime            DateTime?
  carrierExceptionCode    String?
  carrierExceptionReason  String?
  rescheduledDeliveryDate DateTime?
  fulfillmentLocationId   String?
  fulfillmentLocationName String?
  orderValue              Decimal?  @db.Decimal(10, 2)
  isResolved              Boolean   @default(false)
  resolvedAt              DateTime?
  resolvedBy              String?
  resolutionReason        String?
  resolutionNotes         String?
  notificationSent        Boolean   @default(false)
  notificationSentAt      DateTime?
  isDelivered             Boolean   @default(false)
  deliveredAt             DateTime?
  isArchived              Boolean   @default(false)
  lastPolledAt            DateTime?
  nextPollAt              DateTime?
  pollErrorCount          Int       @default(0)
  hasCarrierScan          Boolean   @default(false)
  createdAt               DateTime  @default(now())
  updatedAt               DateTime  @updatedAt

  merchant         Merchant          @relation(fields: [merchantId], references: [id], onDelete: Cascade)
  trackingEvents   TrackingEvent[]
  notificationLogs NotificationLog[]
  resolutionLogs   ResolutionLog[]

  @@unique([merchantId, shopifyFulfillmentId])
  @@index([merchantId, isDelayed])
  @@index([merchantId, isArchived, isDelivered])
  @@index([merchantId, carrier])
  @@index([nextPollAt])
  @@index([trackingNumber])
  @@index([merchantId, shipDate])
  @@index([merchantId, expectedDeliveryDate])
}

enum Carrier {
  UPS
  FEDEX
  USPS
  UNKNOWN
}

enum DeliverySource {
  CARRIER
  DEFAULT
  MERCHANT_OVERRIDE
}

// ── Tracking Events ──────────────────────────────────────────

model TrackingEvent {
  id               String   @id @default(cuid())
  shipmentId       String
  eventTimestamp   DateTime
  eventType        String
  eventDescription String
  locationCity     String?
  locationState    String?
  locationCountry  String?
  rawCarrierData   Json?
  createdAt        DateTime @default(now())

  shipment Shipment @relation(fields: [shipmentId], references: [id], onDelete: Cascade)

  @@index([shipmentId, eventTimestamp])
}

// ── Notification Log ─────────────────────────────────────────

model NotificationLog {
  id               String   @id @default(cuid())
  shipmentId       String
  merchantId       String
  sentAt           DateTime @default(now())
  sentBy           String
  recipientEmail   String
  emailSubject     String
  emailBodyPreview String
  status           NotificationStatus @default(SENT)
  createdAt        DateTime @default(now())

  shipment Shipment @relation(fields: [shipmentId], references: [id], onDelete: Cascade)
  merchant Merchant @relation(fields: [merchantId], references: [id], onDelete: Cascade)

  @@index([shipmentId])
  @@index([merchantId])
}

enum NotificationStatus {
  SENT
  FAILED
}

// ── Resolution Log ───────────────────────────────────────────

model ResolutionLog {
  id                           String   @id @default(cuid())
  shipmentId                   String
  resolvedAt                   DateTime @default(now())
  resolvedBy                   String
  resolutionReason             ResolutionReason
  notes                        String?
  timeDelayedBeforeResolution  Int?     // minutes
  createdAt                    DateTime @default(now())

  shipment Shipment @relation(fields: [shipmentId], references: [id], onDelete: Cascade)

  @@index([shipmentId])
}

enum ResolutionReason {
  CONTACTED_CUSTOMER
  SENT_NOTIFICATION
  PARTIAL_REFUND
  FULL_REFUND
  RESHIPPED
  DELIVERED_FALSE_ALARM
  CUSTOMER_CANCELLED
  OTHER
}
```

### 4.3 Merchant `settings` JSON Structure

The `Merchant.settings` field stores per-merchant preferences as JSON:

```typescript
interface MerchantSettings {
  delayThresholdHours: number;           // default: 8
  autoArchiveDays: number;               // default: 30
  deliveryWindows: {                     // overrides for default service-level windows
    [serviceKey: string]: number;        // e.g., "ups_ground": 5
  };
  columnVisibility: string[];            // visible column IDs
  columnOrder: string[];                 // column display order
  defaultSortColumn: string;             // default: "daysDelayed"
  defaultSortDirection: "asc" | "desc";  // default: "desc"
  notificationTemplate: {
    subject: string;
    body: string;
  };
  fromEmail: string | null;              // null = use default
}
```

---

## 5. API & Route Design

### 5.1 Page Routes (Polaris UI)

| Route File | URL | Purpose |
|------------|-----|---------|
| `app.tsx` | `/app` (layout) | Authenticated layout with AppProvider, NavMenu |
| `app._index.tsx` | `/app` | Main dashboard: summary cards, tab nav, shipment table |
| `app.onboarding.tsx` | `/app/onboarding` | 4-step setup wizard |
| `app.settings.tsx` | `/app/settings` | All settings sections |

`app._index.tsx` loader checks `merchant.onboardingDone`; if false, redirects to `/app/onboarding`.

### 5.2 API Routes (JSON)

All API routes authenticate via `authenticate.admin(request)` and return JSON.

#### `api.shipments.tsx` — GET
Query shipments for the authenticated merchant.

**Query params:**
- `tab`: `all` | `delayed` | `pending` | `resolved` | `delivered`
- `carrier`: `UPS` | `FEDEX` | `USPS`
- `serviceLevel`: string
- `delayStatus`: `delayed` | `on_time` | `pending`
- `orderValueMin` / `orderValueMax`: number
- `shipDateFrom` / `shipDateTo`: ISO date
- `locationId`: string
- `sortBy`: column name
- `sortDir`: `asc` | `desc`
- `page`: number (default 1)
- `pageSize`: number (default 50, max 100)

**Response:**
```typescript
{
  shipments: Shipment[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  summary: { totalActive: number; delayed: number; deliveredToday: number; avgDeliveryTimeByCarrier: Record<string, number> };
}
```

#### `api.shipments.$id.notify.tsx` — POST
Send a delay notification email for one shipment.

**Request body:**
```typescript
{ recipientEmail: string; subject: string; body: string; }
```

**Response:** `{ success: boolean; notificationId: string; }`

#### `api.shipments.$id.resolve.tsx` — POST
Resolve a delayed shipment.

**Request body:**
```typescript
{ reason: ResolutionReason; notes?: string; }
```

**Response:** `{ success: boolean; }`

#### `api.shipments.bulk-notify.tsx` — POST
Send notifications for multiple shipments.

**Request body:**
```typescript
{ shipmentIds: string[]; subject: string; body: string; }
```

Enqueues one `send-notification` job per shipment. Returns immediately with job count.

#### `api.shipments.bulk-resolve.tsx` — POST
Resolve multiple shipments.

**Request body:**
```typescript
{ shipmentIds: string[]; reason: ResolutionReason; notes?: string; }
```

#### `api.shipments.export.tsx` — GET
Download CSV of shipments matching current filters.

Same query params as `api.shipments.tsx`. Returns `Content-Type: text/csv` with `Content-Disposition: attachment`.

#### `api.sync.tsx` — POST
Trigger a manual re-sync of fulfillments from Shopify. Enqueues a `fulfillment-sync` job.

#### `api.billing.tsx` — POST (action)
Handle plan selection and billing callback.

**Actions:** `selectPlan`, `confirmPlan`

### 5.3 Webhook Routes

| Route File | Shopify Topic | Behavior |
|------------|---------------|----------|
| `webhooks.fulfillments.create.tsx` | `fulfillments/create` | Validate HMAC, extract fulfillment data, create Shipment record, enqueue initial `carrier-poll` job |
| `webhooks.fulfillments.update.tsx` | `fulfillments/update` | Validate HMAC, update tracking number/carrier if changed, enqueue `carrier-poll` job |
| `webhooks.app.uninstalled.tsx` | `app/uninstalled` | Mark merchant as uninstalled, stop all polling, schedule data purge in 30 days |

All webhook handlers return `200` immediately after enqueuing work.

### 5.4 Webhook Registration

Webhooks are registered declaratively in `shopify.app.toml`:

```toml
[webhooks]
api_version = "2025-01"

[[webhooks.subscriptions]]
topics = ["fulfillments/create"]
uri = "/webhooks/fulfillments/create"

[[webhooks.subscriptions]]
topics = ["fulfillments/update"]
uri = "/webhooks/fulfillments/update"

[[webhooks.subscriptions]]
topics = ["app/uninstalled"]
uri = "/webhooks/app/uninstalled"
```

---

## 6. Carrier Integration Design

### 6.1 CarrierAdapter Interface

```typescript
// app/services/carriers/carrier.interface.ts

export interface TrackingResult {
  trackingNumber: string;
  carrier: Carrier;
  currentStatus: string;
  isException: boolean;
  exceptionCode: string | null;
  exceptionReason: string | null;
  expectedDeliveryDate: Date | null;
  rescheduledDeliveryDate: Date | null;
  isDelivered: boolean;
  deliveredAt: Date | null;
  lastScanLocation: string | null;
  lastScanTime: Date | null;
  events: TrackingEvent[];
}

export interface TrackingEvent {
  timestamp: Date;
  type: string;
  description: string;
  city: string | null;
  state: string | null;
  country: string | null;
  rawData: unknown;
}

export interface CarrierAdapter {
  /** Fetch tracking info for a single tracking number */
  track(trackingNumber: string): Promise<TrackingResult>;

  /** Build a public tracking URL for the customer */
  getTrackingUrl(trackingNumber: string): string;
}
```

### 6.2 Carrier Detection

```typescript
// In carrier.service.ts

function detectCarrier(trackingCompany: string | null, trackingNumber: string): Carrier {
  // 1. Try Shopify's tracking_company field
  if (trackingCompany) {
    const normalized = trackingCompany.toLowerCase();
    if (normalized.includes("ups")) return Carrier.UPS;
    if (normalized.includes("fedex")) return Carrier.FEDEX;
    if (normalized.includes("usps")) return Carrier.USPS;
  }

  // 2. Fallback: tracking number pattern matching
  if (trackingNumber.startsWith("1Z")) return Carrier.UPS;
  if (/^\d{12,22}$/.test(trackingNumber)) {
    if (trackingNumber.startsWith("96")) return Carrier.FEDEX;
    if (/^9[234]/.test(trackingNumber) && trackingNumber.length >= 20) return Carrier.USPS;
    return Carrier.FEDEX; // FedEx is more common for numeric-only
  }

  return Carrier.UNKNOWN;
}
```

### 6.3 Adapter Implementations

**UPS (`ups.adapter.ts`):**
- Endpoint: `https://onlinetools.ups.com/api/track/v1/details/{trackingNumber}`
- Auth: OAuth 2.0 — obtain bearer token from `https://onlinetools.ups.com/security/v1/oauth/token` with client_id/secret
- Exception detection: `status.type === "X"`
- Delivery: `status.type === "D"`
- Expected delivery: `deliveryDate[0].date` or `package.deliveryDate`

**FedEx (`fedex.adapter.ts`):**
- Endpoint: `https://apis.fedex.com/track/v1/trackingnumbers`
- Auth: OAuth 2.0 client credentials — obtain token from `https://apis.fedex.com/oauth/token`
- Exception detection: `latestStatusDetail.statusByLocale` contains "exception" keywords
- Delivery: `latestStatusDetail.code === "DL"`
- Expected delivery: `estimatedDeliveryTimeWindow.window.ends`

**USPS (`usps.adapter.ts`):**
- Endpoint: `https://secure.shippingapis.com/ShippingAPI.dll` (XML API)
- Auth: `USERID` query parameter
- Exception detection: `TrackSummary` contains "Arriving Late"
- Delivery: `TrackSummary` contains "Delivered"
- Expected delivery: `ExpectedDeliveryDate` field

### 6.4 Token Caching for UPS/FedEx

Both UPS and FedEx require OAuth tokens that expire after ~1 hour. Cache tokens in Redis with a TTL slightly less than the token's `expires_in` value. Refresh on 401 responses.

```
Redis key: carrier_token:{carrier}
TTL: expires_in - 60 seconds
```

---

## 7. Delay Detection Logic

### 7.1 Core Algorithm

```
function evaluateDelay(shipment, trackingResult):
  // Rule 1: Carrier exception
  if trackingResult.isException:
    return DELAYED (reason: carrier exception)

  // Rule 2: Past expected delivery + grace period
  expectedDate = trackingResult.expectedDeliveryDate
                 ?? shipment.expectedDeliveryDate
                 ?? calculateDefaultExpected(shipment)

  if expectedDate is null:
    return NOT_DELAYED (insufficient data)

  gracePeriodHours = merchant.settings.delayThresholdHours  // default 8
  deadline = expectedDate + gracePeriodHours

  if now() > deadline AND NOT trackingResult.isDelivered:
    return DELAYED (reason: past expected delivery)

  return NOT_DELAYED
```

### 7.2 Default Delivery Windows

When the carrier doesn't provide an expected delivery date, calculate from ship date + business days:

```typescript
const DEFAULT_DELIVERY_WINDOWS: Record<string, number> = {
  // UPS
  "ups_next_day_air": 1,
  "ups_2nd_day_air": 2,
  "ups_ground": 5,
  // FedEx
  "fedex_overnight": 1,
  "fedex_2day": 2,
  "fedex_ground": 5,
  // USPS
  "usps_priority_express": 2,
  "usps_priority": 3,
  "usps_ground_advantage": 7,
};
```

Service level matching uses fuzzy normalization — e.g., "UPS GROUND", "Ground", "UPS® Ground" all map to `ups_ground`.

Merchants can override these in Settings, stored in `Merchant.settings.deliveryWindows`.

---

## 8. Background Job Design

### 8.1 Queue Definitions

| Queue Name | Job Types | Concurrency | Notes |
|------------|-----------|-------------|-------|
| `poll-scheduler` | `schedule` | 1 | Runs every 15 min via BullMQ repeatable. Queries DB for shipments where `nextPollAt <= now()`, enqueues `carrier-poll` jobs. |
| `carrier-poll` | `poll` | 10 | Calls one carrier API, updates shipment, runs delay detection, updates `nextPollAt`. |
| `fulfillment-sync` | `sync` | 3 | Syncs fulfillments from Shopify for one merchant (initial sync or manual re-sync). |
| `send-notification` | `send` | 5 | Renders email template, sends via Resend, logs to NotificationLog. |
| `data-cleanup` | `archive`, `purge` | 2 | Runs daily. Archives delivered shipments past threshold. Purges data for merchants uninstalled >30 days. |

### 8.2 Poll Scheduler Logic

The `poll-scheduler` worker runs as a repeatable job every 15 minutes:

```
1. Query shipments WHERE:
   - isArchived = false
   - isDelivered = false
   - nextPollAt <= now()
   - merchant billing is ACTIVE
   - merchant is not uninstalled

2. For each shipment, enqueue a carrier-poll job:
   - jobId = "poll-{shipment.id}" (deduplication)
   - priority based on urgency (past-due = higher priority)

3. Batch enqueue (BullMQ addBulk) for efficiency
```

### 8.3 Carrier Poll Job Logic

```
1. Load shipment from DB
2. If carrier == UNKNOWN, skip (needs merchant review)
3. Call carrierAdapter.track(trackingNumber)
4. On success:
   a. Upsert tracking events into TrackingEvent table
   b. Update shipment fields (currentStatus, lastScanLocation, etc.)
   c. Run delay detection logic
   d. If newly delayed, set isDelayed=true, delayFlaggedAt=now()
   e. If delivered, set isDelivered=true, deliveredAt=now()
   f. Calculate nextPollAt based on smart scheduling
   g. Reset pollErrorCount to 0
   h. If hasCarrierScan was false and now has scans, set hasCarrierScan=true
5. On failure:
   a. Increment pollErrorCount
   b. If pollErrorCount >= 2, mark for dashboard warning
   c. Set nextPollAt with exponential backoff for 429 errors
```

### 8.4 Smart Poll Interval Calculation

```typescript
function calculateNextPollAt(shipment: Shipment, merchant: Merchant): Date {
  const now = new Date();
  let intervalHours: number;

  if (shipment.isDelivered) {
    return null; // Stop polling
  }

  const expected = shipment.expectedDeliveryDate;
  if (!expected) {
    intervalHours = 6; // Default when unknown
  } else {
    const daysUntil = differenceInCalendarDays(expected, now);
    const isPastDue = daysUntil < 0;

    if (isPastDue) {
      const hasRescheduled = shipment.rescheduledDeliveryDate
        && shipment.rescheduledDeliveryDate > now;
      intervalHours = hasRescheduled ? 4 : 2;
    } else if (daysUntil <= 1) {
      intervalHours = 4;
    } else if (daysUntil <= 5) {
      intervalHours = 6;
    } else {
      intervalHours = 8;
    }
  }

  const offsetMinutes = merchant.randomPollOffset;
  return addMinutes(addHours(now, intervalHours), offsetMinutes);
}
```

### 8.5 Fulfillment Sync Job

Triggered on install (onboarding step 3) and on manual re-sync:

```
1. Authenticate with Shopify Admin API using offline token
2. Query fulfillments from last 5 days via GraphQL (paginated)
3. For each fulfillment:
   a. Skip if already exists in DB (by shopifyFulfillmentId)
   b. Detect carrier
   c. Create Shipment record
   d. Enqueue immediate carrier-poll job
4. Respect Shopify rate limits (GraphQL cost-based throttling)
5. Report progress (for onboarding UI polling)
```

### 8.6 Data Cleanup Job

Runs daily via BullMQ repeatable:

```
1. Archive: Set isArchived=true for delivered shipments where
   deliveredAt < now() - merchant.settings.autoArchiveDays

2. Purge: For merchants with billingStatus=CANCELLED and
   installedAt + 30 days < now():
   - Delete all Shipments (cascade deletes events, notifications, resolutions)
   - Delete Merchant record
   - Delete Session records for shop
```

---

## 9. Notification System Design

### 9.1 Email Rendering

Template variables are replaced at send time:

```typescript
function renderTemplate(template: string, data: TemplateData): string {
  return template
    .replace(/{customer_first_name}/g, data.customerFirstName)
    .replace(/{customer_full_name}/g, data.customerFullName)
    .replace(/{order_number}/g, data.orderNumber)
    .replace(/{tracking_number}/g, data.trackingNumber)
    .replace(/{tracking_url}/g, data.trackingUrl)
    .replace(/{carrier_name}/g, data.carrierName)
    .replace(/{carrier_status}/g, data.carrierStatus)
    .replace(/{expected_delivery_date}/g, data.expectedDeliveryDate)
    .replace(/{shop_name}/g, data.shopName);
}
```

### 9.2 Email Sending (Resend)

```typescript
// In notification.service.ts
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendNotificationEmail(params: {
  to: string;
  from: string;
  subject: string;
  body: string;
}): Promise<{ id: string }> {
  const { data, error } = await resend.emails.send({
    from: params.from,
    to: params.to,
    subject: params.subject,
    text: params.body,
  });

  if (error) throw error;
  return { id: data.id };
}
```

### 9.3 From Address

- Default: `noreply@delayguard.app` (requires domain verification in Resend)
- Merchant override: stored in `merchant.settings.fromEmail`
- Resend handles SPF/DKIM for the delayguard.app domain

---

## 10. Billing Integration

### 10.1 Shopify Billing Configuration

```typescript
// In shopify.server.ts
billing: {
  Starter: {
    amount: 9.99,
    currencyCode: "USD",
    interval: BillingInterval.Every30Days,
  },
  Professional: {
    amount: 29.99,
    currencyCode: "USD",
    interval: BillingInterval.Every30Days,
  },
  Business: {
    amount: 79.99,
    currencyCode: "USD",
    interval: BillingInterval.Every30Days,
  },
  Enterprise: {
    amount: 149.99,
    currencyCode: "USD",
    interval: BillingInterval.Every30Days,
  },
},
```

### 10.2 Plan Limit Enforcement

```typescript
const PLAN_LIMITS: Record<PlanTier, number> = {
  STARTER: 100,
  PROFESSIONAL: 500,
  BUSINESS: 2000,
  ENTERPRISE: Infinity,
};
```

Shipment counting:
- Count shipments where `hasCarrierScan = true` and `createdAt` is within the current billing cycle
- Check in `webhooks.fulfillments.create.tsx` and `carrier-poll.worker.ts` (when first scan arrives)
- If at limit, set shipment to a "limit_reached" state and show upgrade prompt

### 10.3 Feature Gating by Plan

| Feature | Starter | Professional | Business | Enterprise |
|---------|---------|--------------|----------|------------|
| Dashboard | Yes | Yes | Yes | Yes |
| Manual notifications | Yes | Yes | Yes | Yes |
| Multi-carrier display | Single | All | All | All |
| Filtering | Basic | Full | Full | Full |
| Bulk actions | No | Yes | Yes | Yes |
| CSV export | No | Yes | Yes | Yes |
| Analytics metrics | No | No | Yes | Yes |
| Priority polling | No | No | Yes | Yes |

Feature checks are done in route loaders before rendering gated UI, and in API route actions before executing gated operations.

---

## 11. Onboarding Flow

### 11.1 State Machine

```
INSTALL -> WELCOME -> PREFERENCES -> SYNCING -> TEST_MODE_OFFER -> DASHBOARD
                                        |
                                        +--> (sync complete) --> TEST_MODE_OFFER
```

Onboarding state stored in `Merchant.onboardingDone` (boolean). The wizard steps are managed client-side as a React state machine within `app.onboarding.tsx`.

### 11.2 Initial Sync UX

During sync (Screen 3):
- Frontend polls `api.sync.tsx` (GET) for sync progress
- Backend tracks progress in the BullMQ job's `progress` field
- When complete, response includes `{ synced: X, delayed: Y }`
- User can proceed after sync completes

---

## 12. Delivery Phases

The implementation is broken into incremental phases. Each phase produces a testable, deployable state.

### Phase 1: Foundation
**Goal:** Runnable Shopify app shell deployed to Railway with PostgreSQL, Redis, and the Prisma schema.

- Scaffold from Shopify Remix template
- Switch Prisma to PostgreSQL, define full schema, run initial migration
- Set up BullMQ + ioredis with queue registry (`queue.server.ts`)
- Create `worker/index.ts` entry point with graceful shutdown
- Set up `.env.example`, `.gitignore`, `Dockerfile` updates
- Deploy web + worker services to Railway with managed PostgreSQL and Redis
- Health check endpoint (`/healthz`)
- Verify: app installs on a dev store, OAuth completes, database tables created

### Phase 2: Shopify Integration (Data Ingestion)
**Goal:** Fulfillments flow from Shopify into the database via webhooks and initial sync.

- Implement `Merchant` creation on app install (in `auth.$.tsx` afterAuth or `app.tsx` loader)
- Implement `webhooks.fulfillments.create.tsx` and `webhooks.fulfillments.update.tsx`
- Implement `sync.service.ts` — initial 5-day fulfillment sync
- Implement `fulfillment-sync.worker.ts`
- Carrier detection logic
- Verify: create a fulfillment on dev store, see Shipment record in DB. Run initial sync, see historical shipments in DB.

### Phase 3: Carrier Integration & Delay Detection
**Goal:** Carrier APIs polled, tracking events stored, delays detected.

- Implement `CarrierAdapter` interface and all three adapters (UPS, FedEx, USPS)
- OAuth token management for UPS/FedEx (cached in Redis)
- Implement `carrier-poll.worker.ts` — polls carrier, stores events, updates shipment
- Implement `delay-detection.service.ts` — delay flagging logic with grace period and default windows
- Implement `poll-scheduler.worker.ts` — repeatable job, smart scheduling
- Implement `data-cleanup.worker.ts` — archive and purge
- Verify: shipment in DB gets polled, tracking events appear, delayed shipments flagged correctly. Use carrier sandbox/test tracking numbers.

### Phase 4: Dashboard & Core UI
**Goal:** Merchant can view, filter, sort, and act on shipments.

- Implement `app._index.tsx` — summary cards, tab nav, shipment table
- Implement `api.shipments.tsx` — paginated, filtered, sorted query endpoint
- Components: `SummaryCards`, `ShipmentTable`, `FilterBar`, `TabNav`, `ShipmentDetailPanel`
- Individual row actions: View Details (expandable panel)
- Column customization (show/hide, reorder) — saved in merchant settings
- Verify: dashboard loads with real shipment data, filtering works, sorting works, detail view shows tracking timeline.

### Phase 5: Notifications & Resolution
**Goal:** Merchant can send delay notifications and resolve delayed shipments.

- Implement `SendNotificationModal` and `api.shipments.$id.notify.tsx`
- Implement `send-notification.worker.ts` with Resend integration
- Implement `ResolveModal` and `api.shipments.$id.resolve.tsx`
- Implement bulk notify (`api.shipments.bulk-notify.tsx`) and bulk resolve (`api.shipments.bulk-resolve.tsx`)
- Implement `BulkActionBar` component
- CSV export (`api.shipments.export.tsx`)
- Notification template customization in settings
- Verify: send a test notification email, see it in NotificationLog. Resolve a shipment, see audit trail. Bulk actions work. CSV downloads.

### Phase 6: Billing, Onboarding & Settings
**Goal:** Full billing flow, onboarding wizard, and settings page.

- Configure Shopify Billing API in `shopify.server.ts`
- Implement plan selection UI and billing callback (`api.billing.tsx`)
- Implement plan limit enforcement (shipment counting, gating)
- Implement onboarding wizard (`app.onboarding.tsx`) with all 4 screens
- Implement settings page (`app.settings.tsx`) — all 5 sections
- Implement `webhooks.app.uninstalled.tsx` — cleanup flow
- Handle store paused/frozen (check shop status on auth)
- Handle downgrades (stop new tracking, continue in-progress)
- Test mode with dummy data
- Verify: billing flow completes on dev store, plan limits enforced, onboarding walks through all steps, settings save correctly, uninstall cleans up.

---

## 13. Verification Approach

### 13.1 Automated Testing

**Unit tests (Vitest):**
- Delay detection logic (various scenarios: carrier exception, past due, grace period, rescheduled)
- Carrier detection (tracking company matching, number pattern matching)
- Smart poll interval calculation
- Email template rendering
- Business day calculations
- CSV generation

**Integration tests:**
- Carrier adapters against sandbox/mock APIs
- Webhook handlers (mock `authenticate.webhook`)
- API route handlers (mock Prisma, verify query params → DB queries)

**Test commands:**
```bash
npx vitest run          # Run all tests
npx vitest run --watch  # Watch mode
```

### 13.2 Manual Testing

- Install on Shopify development store
- Create test orders and fulfillments
- Use carrier sandbox tracking numbers
- Test billing flow in test mode (`isTest: true`)
- Test webhook delivery via Shopify CLI: `shopify webhook trigger fulfillments/create`

### 13.3 Linting & Type Checking

```bash
npx eslint .            # Lint
npx tsc --noEmit        # Type check
npx prisma validate     # Validate Prisma schema
```

---

## 14. Key Patterns to Follow

1. **Remix loader/action for data flow.** Loaders fetch data server-side; actions handle mutations. The dashboard uses loaders for initial data and fetcher for AJAX updates (filtering, pagination).

2. **Singleton pattern for Prisma and BullMQ.** Prevent connection pool exhaustion in development (hot reload) by using global singletons for `PrismaClient` and queue instances.

3. **Webhook → enqueue → return 200.** Never do heavy processing in webhook handlers. Enqueue a BullMQ job and return 200 within seconds.

4. **Secrets stay out of job payloads.** Pass merchant ID or shipment ID only. Workers fetch credentials from the database.

5. **Idempotent job processing.** Use BullMQ `jobId` for deduplication. Webhook handlers use `fulfillment_id` as the dedup key. Carrier poll jobs use `shipment_id`.

6. **Offline tokens for background work.** The Shopify session storage contains offline tokens that don't expire. Workers use `shopify.unauthenticated.admin(shopDomain)` to call the Shopify Admin API.

7. **Zod schemas at system boundaries.** Validate carrier API responses, webhook payloads, and form inputs with Zod schemas. Internal code trusts the validated data.

---

## 15. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Carrier API rate limits under high load | Merchant random poll offset (0-239 min) distributes requests. Exponential backoff on 429s. Priority-based job ordering. |
| Carrier API response format changes | Zod validation catches unexpected shapes early. Raw response stored in `rawCarrierData` for debugging. |
| Shopify webhook delivery failures | Initial sync covers the last 5 days as a catch-up mechanism. Poll scheduler re-checks shipments regardless of webhooks. |
| PostgreSQL connection exhaustion | Prisma singleton pattern. Connection pool configured per-process. Separate pools for web and worker. |
| Worker crashes during job processing | BullMQ automatic retry with configurable attempts and backoff. Jobs are atomic — partial progress doesn't corrupt data. |
| Merchant has >2000 active shipments (Business plan max) | Database indexes on all query columns. Paginated queries with limits. Dashboard never loads all shipments at once. |
