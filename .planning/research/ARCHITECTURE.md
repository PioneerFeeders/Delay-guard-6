# Architecture Patterns

**Domain:** Shopify Embedded App (Remix + BullMQ)
**Researched:** 2026-02-04

## Recommended Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          SHOPIFY ADMIN                              │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                 DelayGuard Embedded UI                        │ │
│  │              (React + Polaris + App Bridge)                   │ │
│  └───────────────────────────────────────────────────────────────┘ │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTPS
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      RAILWAY PROJECT                                │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │              WEB SERVER SERVICE (Port 3000)                  │ │
│  │                                                              │ │
│  │  ┌────────────────────────────────────────────────────────┐ │ │
│  │  │           Remix App Server                             │ │ │
│  │  │  ┌──────────────────────────────────────────────────┐  │ │ │
│  │  │  │  Routes (app/, webhooks/, auth/, api/)           │  │ │ │
│  │  │  │  - OAuth handlers (auth.$.tsx)                   │  │ │ │
│  │  │  │  - Webhook receivers (webhooks.*.tsx)            │  │ │ │
│  │  │  │  - Admin UI (app.*.tsx)                          │  │ │ │
│  │  │  │  - API endpoints (api.*.ts)                      │  │ │ │
│  │  │  └──────────────────────────────────────────────────┘  │ │ │
│  │  │  ┌──────────────────────────────────────────────────┐  │ │ │
│  │  │  │  shopify.server.ts                               │  │ │ │
│  │  │  │  - shopifyApp() config                           │  │ │ │
│  │  │  │  - authenticate.admin()                          │  │ │ │
│  │  │  │  - Billing API setup                             │  │ │ │
│  │  │  └──────────────────────────────────────────────────┘  │ │ │
│  │  │  ┌──────────────────────────────────────────────────┐  │ │ │
│  │  │  │  queue.server.ts                                 │  │ │ │
│  │  │  │  - BullMQ queue registry (singleton)             │  │ │ │
│  │  │  │  - Job enqueueing from routes                    │  │ │ │
│  │  │  └──────────────────────────────────────────────────┘  │ │ │
│  │  └────────────────────────────────────────────────────────┘  │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │             WORKER SERVICE (Background)                      │ │
│  │                                                              │ │
│  │  ┌────────────────────────────────────────────────────────┐ │ │
│  │  │           BullMQ Workers                               │ │ │
│  │  │  ┌──────────────────────────────────────────────────┐  │ │ │
│  │  │  │  workers/                                        │  │ │ │
│  │  │  │  - order-monitor.worker.ts                       │  │ │ │
│  │  │  │  - delay-detector.worker.ts                      │  │ │ │
│  │  │  │  - notification.worker.ts                        │  │ │ │
│  │  │  └──────────────────────────────────────────────────┘  │ │ │
│  │  │  ┌──────────────────────────────────────────────────┐  │ │ │
│  │  │  │  worker.ts (entry point)                         │  │ │ │
│  │  │  │  - Initializes all workers                       │  │ │ │
│  │  │  │  - Connects to Redis                             │  │ │ │
│  │  │  │  - Graceful shutdown handling                    │  │ │ │
│  │  │  └──────────────────────────────────────────────────┘  │ │ │
│  │  └────────────────────────────────────────────────────────┘  │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │              POSTGRESQL SERVICE (Managed)                    │ │
│  │  - Session storage (shops, access tokens)                   │ │
│  │  - Order tracking data                                      │ │
│  │  - Delay detection results                                  │ │
│  │  - Notification history                                     │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                REDIS SERVICE (Managed)                       │ │
│  │  - BullMQ job queues                                        │ │
│  │  - Worker coordination                                      │ │
│  │  - Rate limiting (optional)                                 │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
                  ┌────────────────────────────┐
                  │   EXTERNAL SERVICES        │
                  │  - SendGrid (email)        │
                  │  - AfterShip (tracking)    │
                  │  - Shopify Admin API       │
                  └────────────────────────────┘
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| **Remix App Server** | HTTP request handling, OAuth, session mgmt, UI rendering, webhook receiving, job enqueueing | PostgreSQL (Prisma), Redis (BullMQ queue), Shopify Admin API |
| **BullMQ Workers** | Background job processing, order monitoring, delay detection, notifications | PostgreSQL (Prisma), Redis (BullMQ), External APIs (email, tracking) |
| **PostgreSQL** | Persistent data storage, session management, order data, app state | Remix App, Workers (via Prisma) |
| **Redis** | Job queue backend, worker coordination, temporary data | Remix App (enqueue), Workers (dequeue) |
| **Shopify Admin API** | Source of truth for shop data, orders, products | Remix App (GraphQL), Workers (REST/GraphQL) |
| **shopify.server.ts** | Shopify SDK config, auth methods, billing setup | All routes (via imports) |
| **queue.server.ts** | Job queue registry, queue initialization (singleton) | Routes (enqueue), Workers (process) |

### Data Flow

#### 1. OAuth Installation Flow
```
Merchant clicks "Install App"
  ↓
Shopify redirects to app with auth code
  ↓
Remix auth splat route (auth.$.tsx) receives request
  ↓
authenticate.admin(request) exchanges code for token
  ↓
Prisma session storage saves shop + token to PostgreSQL
  ↓
Redirect to app._index.tsx (main admin page)
```

#### 2. Webhook Processing Flow
```
Shopify sends webhook (e.g., orders/updated)
  ↓
Remix webhook route (webhooks.orders.updated.tsx) receives POST
  ↓
authenticate.webhook(request) validates HMAC
  ↓
Extract order data from webhook payload
  ↓
Enqueue job to BullMQ: orderMonitorQueue.add("monitor", { orderId, shopId })
  ↓
Return 200 OK to Shopify (fast response)
  ↓
Worker picks up job from Redis queue
  ↓
Worker queries Shopify Admin API for full order details
  ↓
Worker runs delay detection logic
  ↓
If delayed: Worker enqueues notification job
  ↓
Worker saves delay status to PostgreSQL
```

#### 3. Background Job Flow (Scheduled Order Check)
```
Cron-like repeatable job triggers every 1 hour
  ↓
Worker queries PostgreSQL for all active orders
  ↓
For each order:
  - Query Shopify Admin API for fulfillment status
  - Run delay detection rules
  - Compare against merchant-defined thresholds
  ↓
If delay detected:
  - Save to PostgreSQL
  - Enqueue notification job
```

#### 4. Notification Flow
```
Notification job picked up by worker
  ↓
Worker fetches merchant settings (email template, preferences)
  ↓
Worker fetches customer email from order data
  ↓
Worker calls SendGrid API to send email
  ↓
Worker saves notification record to PostgreSQL (for history)
```

## Patterns to Follow

### Pattern 1: Singleton Queue Registry
**What:** Use a global registry to share queue instances across the application
**When:** Setting up BullMQ in a Remix app
**Example:**
```typescript
// app/queue.server.ts
import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

declare global {
  var __registeredQueues: Record<string, any> | undefined;
}

const registeredQueues =
  global.__registeredQueues ||
  (global.__registeredQueues = {});

export function registerQueue<T>(
  name: string,
  processor: (job: Job<T>) => Promise<void>
) {
  if (!registeredQueues[name]) {
    const queue = new Queue<T>(name, { connection });
    const queueEvents = new QueueEvents(name, { connection });

    // Workers only run in the worker process, not web server
    if (process.env.PROCESS_TYPE === 'worker') {
      const worker = new Worker<T>(name, processor, { connection });
    }

    registeredQueues[name] = { queue, queueEvents };
  }

  return registeredQueues[name].queue;
}

export const orderMonitorQueue = registerQueue('order-monitor', async (job) => {
  // Processing happens in worker.ts, not here
});
```

### Pattern 2: Shopify Admin GraphQL in Routes
**What:** Use loader functions to fetch data from Shopify Admin API
**When:** Displaying shop data in Remix UI routes
**Example:**
```typescript
// app/routes/app._index.tsx
import { authenticate } from "~/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);

  const response = await admin.graphql(`
    #graphql
    query getOrders {
      orders(first: 10) {
        edges {
          node {
            id
            name
            fulfillmentStatus
          }
        }
      }
    }
  `);

  const { data } = await response.json();
  return json({ orders: data.orders });
}
```

### Pattern 3: Webhook Handlers with Fast Response
**What:** Receive webhook, enqueue background job, return 200 immediately
**When:** Handling Shopify webhooks that require processing
**Example:**
```typescript
// app/routes/webhooks.orders.updated.tsx
import { authenticate } from "~/shopify.server";
import { orderMonitorQueue } from "~/queue.server";

export async function action({ request }: ActionFunctionArgs) {
  const { topic, shop, session, payload } = await authenticate.webhook(request);

  // Enqueue job for background processing
  await orderMonitorQueue.add('monitor', {
    orderId: payload.id,
    shopId: session.id,
  });

  // MUST return 200 quickly or Shopify will retry
  return new Response(null, { status: 200 });
}
```

### Pattern 4: Separate Worker Process
**What:** Run a separate Node process for BullMQ workers
**When:** Always, for Shopify apps with background jobs
**Example:**
```typescript
// worker.ts (separate entry point)
import { Worker } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL);

// Order monitor worker
const orderMonitorWorker = new Worker('order-monitor', async (job) => {
  const { orderId, shopId } = job.data;

  // Fetch order from Shopify
  // Run delay detection
  // Save results to PostgreSQL

  return { processed: true };
}, { connection });

// Graceful shutdown
process.on('SIGTERM', async () => {
  await orderMonitorWorker.close();
  process.exit(0);
});
```

### Pattern 5: Prisma Client Singleton
**What:** Reuse Prisma client instance across requests
**When:** Using Prisma in Remix (prevents connection pool exhaustion)
**Example:**
```typescript
// app/db.server.ts
import { PrismaClient } from '@prisma/client';

declare global {
  var __db: PrismaClient | undefined;
}

let db: PrismaClient;

if (process.env.NODE_ENV === 'production') {
  db = new PrismaClient();
} else {
  if (!global.__db) {
    global.__db = new PrismaClient();
  }
  db = global.__db;
}

export { db };
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Processing Webhooks Synchronously
**What:** Doing expensive work (API calls, DB queries) inside webhook handler
**Why bad:** Shopify expects 200 response within seconds; slow processing causes retries, duplicate processing
**Instead:** Enqueue job to BullMQ, return 200 immediately, process in background worker

### Anti-Pattern 2: Storing Secrets in Job Payloads
**What:** Passing access tokens or API keys in job data
**Why bad:** Job data is stored in Redis (potentially unencrypted), leaked in logs
**Instead:** Pass shop ID only; worker fetches access token from PostgreSQL when processing

### Anti-Pattern 3: Running Workers in Web Server Process
**What:** Creating Worker instances in Remix app server
**Why bad:** Blocks web server event loop, steals resources from HTTP handling, prevents independent scaling
**Instead:** Separate worker.ts entry point, deploy as separate Railway service

### Anti-Pattern 4: Polling Shopify API from Web Server
**What:** Scheduled cron jobs running in Remix app server
**Why bad:** Couples background work to web server lifecycle, prevents horizontal scaling
**Instead:** Use BullMQ's repeatable jobs feature in worker process

### Anti-Pattern 5: Not Using Shopify Session Storage Adapter
**What:** Building custom session management with raw Prisma
**Why bad:** Reinvents the wheel, misses built-in token refresh, error-prone
**Instead:** Use `@shopify/shopify-app-session-storage-prisma` (official adapter)

### Anti-Pattern 6: Blocking App Bridge with Long API Calls
**What:** Making slow Admin API queries in loader without streaming/defer
**Why bad:** UI freezes, poor UX, merchants perceive app as slow
**Instead:** Use Remix `defer()` for slow queries, show loading states with Polaris Spinner

## Scalability Considerations

| Concern | At 100 shops | At 10K shops | At 100K shops |
|---------|--------------|--------------|---------------|
| **Database** | PostgreSQL on Railway (single instance) | Read replicas for analytics queries | Sharding by shop_id, connection pooling (PgBouncer) |
| **Redis** | Single Redis instance | Redis cluster, separate cache + queue | Managed Redis (Railway/Upstash), key expiration policies |
| **Workers** | 1-2 worker processes | 5-10 workers, autoscaling based on queue depth | Separate worker pools per job type, dedicated infrastructure |
| **API Rate Limits** | Shopify: 2 req/sec per shop | Implement request queuing, exponential backoff | Shopify Plus: 4 req/sec, GraphQL cost analysis, batch queries |
| **Webhooks** | Handle inline | BullMQ (current design) | Deduplicate webhooks (idempotency keys), separate webhook receiver service |
| **Session Storage** | Prisma + PostgreSQL | Add session caching layer (Redis) | Session TTL, periodic cleanup job |

## Sources

- [Shopify App Remix Template Architecture](https://github.com/Shopify/shopify-app-template-remix)
- [BullMQ Integration Guide (Jacob Paris)](https://www.jacobparis.com/content/bullmq-integration-guide)
- [BullMQ Workers Documentation](https://docs.bullmq.io/guide/workers)
- [Shopify Webhook Best Practices](https://shopify.dev/docs/apps/build/webhooks)
- [Prisma Best Practices](https://www.prisma.io/docs/guides/performance-and-optimization/connection-management)
- [Remix Deferred Data](https://remix.run/docs/en/main/guides/streaming)
