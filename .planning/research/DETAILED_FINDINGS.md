# Detailed Research Findings: Shopify Remix App Template

**Project:** DelayGuard
**Researched:** 2026-02-04
**Purpose:** Technical specification foundation

This document provides detailed answers to the 10 specific research questions requested.

---

## 1. Shopify Remix Template Structure

**What `npx @shopify/create-app@latest` produces:**

### Directory Structure
```
my-shopify-app/
├── .github/              # GitHub Actions workflows
├── .vscode/              # VS Code settings
├── app/                  # Main application code
│   ├── routes/          # File-based routing
│   │   ├── app.tsx                    # Layout for authenticated admin routes
│   │   ├── app._index.tsx             # Main app page (/app)
│   │   ├── auth.$.tsx                 # OAuth splat route (handles /auth/*)
│   │   ├── webhooks.app.uninstalled.tsx      # App uninstall webhook
│   │   └── webhooks.app.scopes_update.tsx    # Scope update webhook
│   ├── entry.client.tsx      # Client-side entry point
│   ├── entry.server.tsx      # Server-side entry point
│   ├── root.tsx              # Root layout
│   └── shopify.server.ts     # Shopify SDK configuration (OAuth, API, webhooks)
├── extensions/           # App extensions (checkout, theme, etc.)
├── prisma/              # Database schema and migrations
│   ├── schema.prisma    # Prisma schema (SQLite by default)
│   └── migrations/      # Database migrations
├── public/              # Static assets
├── .eslintrc.cjs        # ESLint configuration
├── .graphqlrc.ts        # GraphQL codegen configuration
├── .prettierignore      # Prettier ignore rules
├── Dockerfile           # Container configuration
├── package.json         # Dependencies and scripts
├── prisma.config.ts     # Prisma configuration
├── remix.config.js      # Remix configuration (deprecated in v2, moved to vite.config)
├── shopify.app.toml     # Shopify app configuration
├── shopify.web.toml     # Web server configuration
├── tsconfig.json        # TypeScript configuration
└── vite.config.ts       # Vite bundler configuration
```

### Key Files Explained

**`app/shopify.server.ts`** - Core configuration file:
- Exports `shopifyApp()` with API credentials, scopes, API version
- Configures session storage (PrismaSessionStorage)
- Exports `authenticate.admin()`, `authenticate.webhook()` methods
- Sets up billing configuration (optional)
- Configures webhooks for auto-registration

**`app/routes/app.tsx`** - Layout for authenticated routes:
- Wraps admin UI pages with `AppProvider` (App Bridge + Polaris)
- Authenticates user via `authenticate.admin(request)`
- Passes API key to frontend for App Bridge initialization
- Provides Polaris theme and navigation context

**`app/routes/auth.$.tsx`** - Auth splat route:
- Catches all `/auth/*` paths
- Calls `authenticate.admin(request)` which:
  - Starts OAuth flow if no session exists
  - Handles OAuth callback from Shopify
  - Exchanges auth code for access token
  - Saves session to Prisma storage
  - Redirects to app

**`prisma/schema.prisma`** - Database schema:
- Default datasource: SQLite (`provider = "sqlite"`)
- Default model: `Session` table (required for OAuth)
- Fields: `id`, `shop`, `state`, `isOnline`, `scope`, `expires`, `accessToken`, `userId`

**`shopify.app.toml`** - App configuration:
- App name, version, API version
- Webhook subscriptions (topics, delivery URLs)
- App access scopes
- Extension settings

**`vite.config.ts`** - Build configuration:
- Remix Vite plugin setup
- TypeScript path resolution
- Environment variable handling

### Default Generated Code

The template includes example code for:
- Fetching products from Shopify Admin API (GraphQL)
- Displaying data in Polaris components (DataTable, Card, Page)
- Handling form submissions with Remix actions
- Validating HMAC for webhooks

### Scripts (package.json)
- `npm run dev` - Starts Shopify CLI dev server (tunnel, OAuth, env vars)
- `npm run build` - Builds production bundle with Vite
- `npm run start` - Starts production server with `remix-serve`
- `npm run setup` - Runs Prisma migrations (`prisma generate && prisma migrate deploy`)
- `npm run prisma` - Access Prisma CLI
- `npm run shopify` - Access Shopify CLI

**Source:** [Shopify Remix Template GitHub](https://github.com/Shopify/shopify-app-template-remix)

---

## 2. Built-in Auth/Session Management

### How Authentication Works

The template uses `@shopify/shopify-app-remix` package which provides:

#### A. OAuth Flow (Embedded Apps with Managed Installation)
1. **Merchant clicks "Install App"** in Shopify Admin
2. **Shopify redirects** to your app's auth endpoint (`/auth/shopify`)
3. **`authenticate.admin(request)`** in `auth.$.tsx`:
   - Validates request parameters (shop, host, timestamp, HMAC)
   - Starts Shopify managed installation flow (NEW method, post-Feb 2024)
   - Uses **token exchange** instead of redirect-based OAuth
   - Eliminates redirect loops that plagued older templates
4. **Token exchange** happens server-side:
   - App requests access token directly from Shopify
   - No browser redirects needed (faster, better UX)
5. **Session saved** to Prisma storage (PostgreSQL/SQLite)
6. **Redirect** to app's main page (`/app`)

#### B. Session Token Authentication (Embedded Apps)
For embedded apps (render inside Shopify Admin iframe):

- **Browsers block third-party cookies** (Chrome, Safari, Firefox)
- **Session tokens (JWTs)** replace cookies:
  - Shopify App Bridge generates JWT on each request
  - JWT contains: shop, user ID, expiry (1 minute TTL)
  - App validates JWT server-side
- **`authenticate.admin(request)`** handles this automatically:
  - Checks for session token in `Authorization` header
  - Validates JWT signature
  - Fetches session from Prisma storage
  - Returns `admin` object (GraphQL client) and `session` object

#### C. What `shopify.server.ts` Provides

**Configuration:**
```typescript
export const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL!,
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  isEmbeddedApp: true,
  future: {
    unstable_newEmbeddedAuthStrategy: true, // Enable managed install + token exchange
  },
  // Optional: Billing configuration
  billing: {
    // Plan definitions
  },
  // Optional: Webhook subscriptions
  webhooks: {
    APP_UNINSTALLED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks",
    },
  },
});

export const authenticate = shopify.authenticate;
```

**Exports:**
- `shopify.authenticate.admin(request)` - Authenticates admin requests, returns GraphQL client
- `shopify.authenticate.webhook(request)` - Validates webhook HMAC, returns payload
- `shopify.billing.require()` - Checks for active subscription
- `shopify.billing.request()` - Initiates billing flow

**Session Storage:**
- Uses `@shopify/shopify-app-session-storage-prisma`
- Automatically stores/retrieves sessions from database
- Handles token refresh
- Manages online and offline access tokens:
  - **Offline tokens**: Never expire, used for background jobs
  - **Online tokens**: Tied to user session, expire after inactivity

#### D. Key Features

**Automatic Token Refresh:**
- Prisma session storage handles this internally
- App doesn't need manual refresh logic

**Scope Updates:**
- If app requests new scopes, `authenticate.admin()` triggers re-auth
- Webhook `app/scopes_update` notifies when merchant approves

**Multi-Shop Support:**
- Sessions scoped by `shop` domain
- Each shop has separate access token
- Prisma queries filter by `session.shop`

**Security:**
- HMAC validation on all requests from Shopify
- Session tokens prevent CSRF attacks
- Tokens encrypted at rest (Prisma handles this)

**Sources:**
- [Shopify App Remix Authentication Docs](https://shopify.dev/docs/api/shopify-app-remix/v2/authenticate)
- [@shopify/shopify-app-remix NPM](https://www.npmjs.com/package/@shopify/shopify-app-remix)
- [Session Token Documentation](https://shopify.dev/docs/apps/build/authentication-authorization/session-tokens)

---

## 3. Prisma Setup

### Default Configuration

**`prisma/schema.prisma`:**
```prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Session {
  id          String    @id
  shop        String
  state       String
  isOnline    Boolean   @default(false)
  scope       String?
  expires     DateTime?
  accessToken String
  userId      BigInt?
}
```

**Default Database:** SQLite
- File location: `prisma/dev.sqlite` (dev), `prisma/prod.sqlite` (prod)
- **WARNING:** SQLite NOT production-ready for multi-instance deployments

### How to Add Custom Models

1. **Edit `prisma/schema.prisma`:**
```prisma
model Shop {
  id                String   @id @default(cuid())
  shopDomain        String   @unique
  accessToken       String   // Offline token for background jobs
  scopes            String
  installedAt       DateTime @default(now())
  uninstalledAt     DateTime?

  // Relationships
  orders            Order[]
  notifications     Notification[]
  settings          ShopSettings?
}

model Order {
  id                String   @id
  shopifyOrderId    String   @unique
  shopId            String
  orderNumber       String
  createdAt         DateTime
  fulfillmentStatus String?
  trackingNumber    String?
  isDelayed         Boolean  @default(false)
  delayDetectedAt   DateTime?

  shop              Shop     @relation(fields: [shopId], references: [id])
  notifications     Notification[]
}

model Notification {
  id          String   @id @default(cuid())
  orderId     String
  shopId      String
  type        String   // "email", "sms"
  status      String   // "pending", "sent", "failed"
  sentAt      DateTime?
  error       String?

  order       Order    @relation(fields: [orderId], references: [id])
  shop        Shop     @relation(fields: [shopId], references: [id])
}

model ShopSettings {
  id                  String  @id @default(cuid())
  shopId              String  @unique
  delayThresholdHours Int     @default(48)
  notificationsEnabled Boolean @default(true)
  emailTemplate       String?

  shop                Shop    @relation(fields: [shopId], references: [id])
}
```

2. **Create migration:**
```bash
npx prisma migrate dev --name add_custom_models
```

3. **Regenerate Prisma Client:**
```bash
npx prisma generate
```

4. **Use in code:**
```typescript
import { prisma } from "~/db.server";

// Create shop record
await prisma.shop.create({
  data: {
    shopDomain: "example.myshopify.com",
    accessToken: session.accessToken,
    scopes: session.scope,
  },
});

// Query orders with delays
const delayedOrders = await prisma.order.findMany({
  where: {
    shopId: shop.id,
    isDelayed: true,
  },
  include: {
    notifications: true,
  },
});
```

### Switching to PostgreSQL

**Why:** SQLite doesn't work with multiple app instances (Railway auto-scales, causing session conflicts)

**Steps:**

1. **Update `prisma/schema.prisma`:**
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

2. **Add PostgreSQL service in Railway:**
- Click "New Service" → "Database" → "PostgreSQL"
- Railway auto-generates `DATABASE_URL` environment variable

3. **Clean up old migrations:**
```bash
rm -rf prisma/migrations
```

4. **Create initial migration:**
```bash
npx prisma migrate dev --name init
```

5. **Update `.env` for local dev:**
```env
DATABASE_URL="postgresql://user:password@localhost:5432/delayguard_dev"
```

6. **Run migrations in production:**
```bash
# Railway runs this automatically via setup script
npx prisma migrate deploy
```

### Prisma Best Practices

**Singleton Pattern (Prevent Connection Pool Exhaustion):**
```typescript
// app/db.server.ts
import { PrismaClient } from '@prisma/client';

declare global {
  var __db: PrismaClient | undefined;
}

let prisma: PrismaClient;

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient();
} else {
  if (!global.__db) {
    global.__db = new PrismaClient();
  }
  prisma = global.__db;
}

export { prisma };
```

**Prisma Studio (GUI for Database):**
```bash
npx prisma studio
# Opens http://localhost:5555 with GUI for viewing/editing data
```

**Sources:**
- [Shopify Prisma Guide](https://www.prisma.io/docs/guides/shopify)
- [Prisma PostgreSQL Guide](https://www.prisma.io/docs/concepts/database-connectors/postgresql)
- [Shopify Remix Template Prisma Setup](https://github.com/Shopify/shopify-app-template-remix)

---

## 4. Remix Routes Pattern

### File Naming Conventions

Remix uses **flat file routing** with dot notation:

| File Name | URL Path | Purpose |
|-----------|----------|---------|
| `app._index.tsx` | `/app` | Main app page (nested under `app.tsx` layout) |
| `app.settings.tsx` | `/app/settings` | Settings page |
| `app.orders.$id.tsx` | `/app/orders/:id` | Dynamic order detail page |
| `app.orders._index.tsx` | `/app/orders` | Orders list page |
| `webhooks.orders.updated.tsx` | `/webhooks/orders/updated` | Webhook handler (no UI) |
| `api.jobs.$id.tsx` | `/api/jobs/:id` | API endpoint (JSON response) |
| `auth.$.tsx` | `/auth/*` | Splat route (matches any `/auth/...` path) |

**Key Syntax:**
- **`.` (dot)**: Path separator (e.g., `app.settings` → `/app/settings`)
- **`$` (dollar)**: Dynamic segment (e.g., `orders.$id` → `/orders/:id`)
- **`_index`**: Index route for parent (e.g., `app._index` → `/app`)
- **`$` (splat)**: Catch-all (e.g., `auth.$` → `/auth/*`)

### Loader Functions (Data Fetching)

**Purpose:** Fetch data on the server before rendering the page

**Pattern:**
```typescript
// app/routes/app._index.tsx
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate } from "~/shopify.server";

// Server-side data fetching
export async function loader({ request }: LoaderFunctionArgs) {
  // Authenticate the request
  const { admin, session } = await authenticate.admin(request);

  // Query Shopify Admin API
  const response = await admin.graphql(`
    #graphql
    query getOrders {
      orders(first: 10) {
        edges {
          node {
            id
            name
            fulfillmentStatus
            createdAt
          }
        }
      }
    }
  `);

  const { data } = await response.json();

  // Return data to component
  return json({
    orders: data.orders.edges.map(edge => edge.node),
  });
}

// Client-side component
export default function Index() {
  const { orders } = useLoaderData<typeof loader>();

  return (
    <Page title="Orders">
      <DataTable
        columnContentTypes={["text", "text", "text"]}
        headings={["Order", "Status", "Date"]}
        rows={orders.map(order => [
          order.name,
          order.fulfillmentStatus,
          new Date(order.createdAt).toLocaleDateString(),
        ])}
      />
    </Page>
  );
}

// REQUIRED for embedded apps
export function headers(headersArgs: HeadersArgs) {
  return {
    "Content-Security-Policy": "frame-ancestors https://admin.shopify.com https://*.myshopify.com",
  };
}
```

### Action Functions (Form Handling, Mutations)

**Purpose:** Handle form submissions, mutations, side effects

**Pattern:**
```typescript
// app/routes/app.settings.tsx
import { json, redirect, type ActionFunctionArgs } from "@remix-run/node";
import { Form, useActionData } from "@remix-run/react";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const delayThreshold = Number(formData.get("delayThreshold"));
  const notificationsEnabled = formData.get("notificationsEnabled") === "on";

  // Validation
  if (delayThreshold < 1 || delayThreshold > 168) {
    return json(
      { error: "Delay threshold must be between 1 and 168 hours" },
      { status: 400 }
    );
  }

  // Save to database
  await prisma.shopSettings.upsert({
    where: { shopId: session.shop },
    update: { delayThreshold, notificationsEnabled },
    create: { shopId: session.shop, delayThreshold, notificationsEnabled },
  });

  // Redirect or return success
  return redirect("/app/settings?success=true");
}

export default function Settings() {
  const actionData = useActionData<typeof action>();

  return (
    <Form method="post">
      <TextField
        label="Delay Threshold (hours)"
        name="delayThreshold"
        type="number"
        error={actionData?.error}
      />
      <Checkbox
        label="Enable notifications"
        name="notificationsEnabled"
      />
      <Button submit>Save</Button>
    </Form>
  );
}
```

### API Routes (JSON Endpoints)

**Purpose:** Return JSON data (not HTML) for AJAX requests or external integrations

**Pattern:**
```typescript
// app/routes/api.jobs.$id.tsx
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { orderMonitorQueue } from "~/queue.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const jobId = params.id!;

  // Fetch job status from BullMQ
  const job = await orderMonitorQueue.getJob(jobId);

  if (!job) {
    return json({ error: "Job not found" }, { status: 404 });
  }

  return json({
    id: job.id,
    status: await job.getState(),
    progress: job.progress,
    data: job.data,
  });
}
```

**Client-side usage:**
```typescript
// Fetch job status via API
const response = await fetch(`/api/jobs/${jobId}`);
const job = await response.json();
console.log(job.status); // "active", "completed", "failed"
```

### Page Routes vs. API Routes

**Page Routes:**
- Export default React component
- Return JSX from component
- Render HTML in Shopify Admin iframe
- Use Polaris components for UI
- Files: `app.*.tsx`

**API Routes:**
- No default export (or export minimal component)
- Return `json()` from loader/action
- Return JSON for programmatic access
- Files: `api.*.ts` or `api.*.tsx`

### Resource Routes (No UI)

**Purpose:** Handle webhooks, background job triggers, health checks

**Pattern:**
```typescript
// app/routes/webhooks.orders.updated.tsx
import { type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { orderMonitorQueue } from "~/queue.server";

export async function action({ request }: ActionFunctionArgs) {
  const { topic, shop, session, payload } = await authenticate.webhook(request);

  console.log(`Received webhook: ${topic} from ${shop}`);

  // Enqueue background job
  await orderMonitorQueue.add("monitor", {
    orderId: payload.id,
    shopId: session.id,
  });

  // MUST return 200 quickly
  return new Response(null, { status: 200 });
}

// No default export = no UI rendering
```

**Sources:**
- [Remix Route File Conventions](https://remix.run/docs/en/main/file-conventions/routes)
- [Shopify Remix Template Routes](https://github.com/Shopify/shopify-app-template-remix/tree/main/app/routes)

---

## 5. Shopify App Bridge / Polaris Integration

### How They're Integrated in the Template

#### A. App Bridge Setup

**Purpose:** App Bridge enables apps to render inside Shopify Admin iframe, access Shopify features (navigation, modals, toasts)

**Setup in `app/routes/app.tsx` (Layout):**
```typescript
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);

  return json({
    apiKey: process.env.SHOPIFY_API_KEY || "",
  });
}

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app">Home</Link>
        <Link to="/app/settings">Settings</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}
```

**What `AppProvider` does:**
- Initializes Shopify App Bridge
- Configures Polaris theme
- Sets up context for child components
- Handles App Bridge redirects, modals, toasts

#### B. Polaris Components

**Purpose:** Polaris is Shopify's design system. Provides React components that match Shopify Admin UI.

**Common Components:**
- `Page` - Page container with title, breadcrumbs
- `Card` - Content container
- `Layout` - Grid layout system
- `DataTable` - Tables for data
- `Form`, `TextField`, `Checkbox`, `Button` - Form controls
- `Banner` - Alerts and notifications
- `Modal` - Dialogs
- `Spinner` - Loading indicators
- `Toast` - Temporary messages

**Example:**
```typescript
import {
  Page,
  Layout,
  Card,
  Button,
  DataTable,
  Banner,
} from "@shopify/polaris";

export default function OrdersPage() {
  const { orders } = useLoaderData<typeof loader>();

  return (
    <Page
      title="Orders"
      primaryAction={{
        content: "Refresh",
        onAction: () => window.location.reload(),
      }}
    >
      <Layout>
        <Layout.Section>
          <Banner status="info">
            Monitoring {orders.length} orders for delays
          </Banner>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <DataTable
              columnContentTypes={["text", "text", "numeric"]}
              headings={["Order", "Status", "Days Since Fulfillment"]}
              rows={orders.map(order => [
                order.name,
                order.fulfillmentStatus,
                calculateDaysSince(order.fulfilledAt),
              ])}
            />
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
```

#### C. UI Patterns in Template

**1. Authenticated Layout Pattern:**
- `app.tsx` wraps all admin pages
- Provides `AppProvider` + `NavMenu`
- All child routes (`app._index.tsx`, `app.settings.tsx`) render inside this layout

**2. Toast Notifications (App Bridge):**
```typescript
import { useAppBridge } from "@shopify/app-bridge-react";

export default function MyPage() {
  const shopify = useAppBridge();

  const handleSave = async () => {
    // ... save logic
    shopify.toast.show("Settings saved");
  };

  return <Button onClick={handleSave}>Save</Button>;
}
```

**3. Modal Pattern:**
```typescript
import { Modal } from "@shopify/polaris";
import { useState } from "react";

export default function OrdersPage() {
  const [modalActive, setModalActive] = useState(false);

  return (
    <>
      <Button onClick={() => setModalActive(true)}>View Details</Button>
      <Modal
        open={modalActive}
        onClose={() => setModalActive(false)}
        title="Order Details"
      >
        <Modal.Section>
          {/* Modal content */}
        </Modal.Section>
      </Modal>
    </>
  );
}
```

**4. Loading States:**
```typescript
import { Spinner } from "@shopify/polaris";
import { useNavigation } from "@remix-run/react";

export default function OrdersPage() {
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

  if (isLoading) {
    return <Spinner accessibilityLabel="Loading orders" />;
  }

  return <DataTable rows={orders} />;
}
```

#### D. 2025 Update: Polaris Web Components

**NEW:** Shopify now recommends using Polaris web components (framework-agnostic) via CDN instead of `@shopify/polaris` React package.

**Migration Path (Optional for New Apps):**
```html
<!-- app/root.tsx -->
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
<script src="https://cdn.shopify.com/shopifycloud/polaris.js"></script>
```

**Benefits:**
- Always up-to-date (unversioned CDN)
- Framework-agnostic (works with any frontend)
- Smaller bundle size

**Trade-off:**
- Less control over version upgrades
- React-specific features (hooks) may differ

**Recommendation for DelayGuard:** Stick with `@shopify/polaris` React package (v12) for now. It's more mature and better documented.

**Sources:**
- [App Bridge Documentation](https://shopify.dev/docs/api/app-bridge)
- [Polaris React Documentation](https://polaris.shopify.com/)
- [Polaris Goes Stable (2025)](https://www.shopify.com/partners/blog/polaris-goes-stable-the-future-of-shopify-app-development-is-here)

---

## 6. Webhook Handling

### How the Template Handles Webhooks

#### A. Webhook Registration (Two Methods)

**Method 1: TOML Configuration (Declarative)**
```toml
# shopify.app.toml
[webhooks]
api_version = "2025-01"

[[webhooks.subscriptions]]
topics = ["app/uninstalled"]
uri = "/webhooks/app/uninstalled"

[[webhooks.subscriptions]]
topics = ["orders/updated"]
uri = "/webhooks/orders/updated"
```

**Method 2: Programmatic Registration (shopify.server.ts)**
```typescript
export const shopify = shopifyApp({
  // ... other config
  webhooks: {
    APP_UNINSTALLED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/app/uninstalled",
    },
    ORDERS_UPDATED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/orders/updated",
    },
  },
});
```

**When webhooks are registered:**
- Automatically during app installation (via `afterAuth` hook)
- When app scopes are updated
- Can be manually triggered via Shopify CLI: `shopify webhook trigger orders/updated`

#### B. Webhook Handler Pattern

**File:** `app/routes/webhooks.orders.updated.tsx`

```typescript
import { type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { orderMonitorQueue } from "~/queue.server";

export async function action({ request }: ActionFunctionArgs) {
  // Validate webhook authenticity (HMAC check)
  const { topic, shop, session, payload } = await authenticate.webhook(request);

  console.log(`📥 Webhook received: ${topic} from ${shop}`);

  // Extract order data from payload
  const { id, name, fulfillment_status, line_items } = payload;

  // Enqueue background job (don't process here!)
  await orderMonitorQueue.add("monitor", {
    orderId: id,
    shopId: session.id,
    orderName: name,
    fulfillmentStatus: fulfillment_status,
  });

  // MUST return 200 within seconds
  return new Response(null, { status: 200 });
}
```

**Key Points:**
1. **HMAC Validation:** `authenticate.webhook(request)` verifies webhook is from Shopify
2. **Fast Response:** Return 200 within 2-3 seconds or Shopify retries
3. **Enqueue Work:** Use BullMQ to process webhook asynchronously
4. **No UI:** Webhook routes don't export default component

#### C. Webhook Payload Structure

**Example: `orders/updated` webhook payload**
```json
{
  "id": 1234567890,
  "name": "#1001",
  "email": "customer@example.com",
  "created_at": "2025-01-15T10:30:00Z",
  "updated_at": "2025-01-16T14:20:00Z",
  "fulfillment_status": "fulfilled",
  "financial_status": "paid",
  "line_items": [
    {
      "id": 9876543210,
      "title": "Product Name",
      "quantity": 2,
      "price": "29.99"
    }
  ],
  "shipping_address": { ... },
  "customer": { ... }
}
```

#### D. Common Webhook Topics for DelayGuard

| Topic | When Fired | Use Case |
|-------|-----------|----------|
| `orders/create` | New order placed | Start monitoring order |
| `orders/updated` | Order details change | Check fulfillment status update |
| `orders/fulfilled` | Order shipped | Start delay detection timer |
| `orders/cancelled` | Order cancelled | Stop monitoring |
| `app/uninstalled` | Merchant uninstalls app | Clean up shop data |
| `customers/data_request` | GDPR data request | Return customer data |
| `customers/redact` | GDPR data deletion | Delete customer data |
| `shop/redact` | Shop deleted | Delete shop data |

#### E. Webhook Reliability Best Practices

**Problem:** Webhooks can be missed, delayed, or duplicated

**Solutions:**

1. **Idempotency Keys:**
```typescript
await orderMonitorQueue.add(
  "monitor",
  { orderId, shopId },
  { jobId: `monitor-${orderId}` } // Prevents duplicates
);
```

2. **Webhook Verification:**
```typescript
// authenticate.webhook() does this automatically
const hmac = request.headers.get("X-Shopify-Hmac-Sha256");
const isValid = verifyHmac(hmac, requestBody, apiSecret);
if (!isValid) {
  return new Response("Forbidden", { status: 403 });
}
```

3. **Fallback Polling:**
- Don't rely solely on webhooks
- Periodic background job to check order status
- Catches missed webhooks

**Sources:**
- [Shopify Webhooks Documentation](https://shopify.dev/docs/apps/build/webhooks)
- [Subscribing to Webhooks (Remix)](https://shopify.dev/docs/api/shopify-app-remix/v1/guide-webhooks)

---

## 7. Shopify Billing API

### How Billing Works in Remix-Based Shopify Apps

#### A. Billing Configuration (shopify.server.ts)

```typescript
import { BillingInterval, LATEST_API_VERSION } from "@shopify/shopify-app-remix/server";

export const shopify = shopifyApp({
  // ... other config
  billing: {
    "Pro Plan": {
      amount: 9.99,
      currencyCode: "USD",
      interval: BillingInterval.Every30Days,
      trialDays: 7,
    },
    "Enterprise Plan": {
      amount: 29.99,
      currencyCode: "USD",
      interval: BillingInterval.Every30Days,
    },
  },
});

export const { billing } = shopify;
```

#### B. Requiring a Billing Plan

**Pattern 1: Require Plan on Specific Route**
```typescript
// app/routes/app._index.tsx
import { billing } from "~/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await billing.require({
    plans: ["Pro Plan"],
    onFailure: async () => {
      // Redirect to Shopify billing page
      return await billing.request({
        plan: "Pro Plan",
        isTest: process.env.NODE_ENV !== "production",
        returnUrl: "/app",
      });
    },
  });

  // Merchant has active subscription, continue
  const { admin, session } = await authenticate.admin(request);
  // ... rest of loader
}
```

**Pattern 2: Redirect to Plan Selection Page**
```typescript
export async function loader({ request }: LoaderFunctionArgs) {
  const hasSubscription = await billing.check({
    plans: ["Pro Plan", "Enterprise Plan"],
  });

  if (!hasSubscription) {
    return redirect("/app/select-plan");
  }

  // Continue with app logic
}
```

#### C. Billing Flow

1. **Merchant installs app** (no billing yet)
2. **Merchant visits app** → Loader calls `billing.require()`
3. **No active subscription** → Redirect to Shopify billing page
4. **Merchant approves** → Shopify redirects back to `returnUrl`
5. **Subscription active** → App functionality unlocked

#### D. Billing API Methods

**`billing.require()`**
- Checks if shop has active payment
- If not, executes `onFailure` callback
- Use in route loaders to enforce billing

**`billing.request()`**
- Initiates billing flow with Shopify
- Returns redirect response to Shopify billing page
- Options: `plan`, `isTest`, `returnUrl`, `returnObject`

**`billing.cancel()`**
- Cancels active subscription
- Requires subscription ID
- Use in settings page "Cancel Plan" action

**`billing.check()`**
- Non-blocking check for active subscription
- Returns boolean
- Use for conditional features

#### E. Trial Period Handling

**Configuration:**
```typescript
billing: {
  "Pro Plan": {
    amount: 9.99,
    currencyCode: "USD",
    interval: BillingInterval.Every30Days,
    trialDays: 7, // 7-day free trial
  },
}
```

**Behavior:**
- Merchant not charged for 7 days
- After trial, automatic billing starts
- Cannot change trial days once subscription starts (must cancel and recreate)

**Testing Trials:**
```typescript
// In loader
return await billing.request({
  plan: "Pro Plan",
  isTest: true, // Test mode (no actual charges)
  returnUrl: "/app",
});
```

#### F. Usage-Based Billing (Advanced)

**New in v3 Billing API:**
```typescript
billing: {
  "Pay As You Go": {
    lineItems: [
      {
        amount: 5.0,
        currencyCode: "USD",
        interval: BillingInterval.Every30Days,
      },
      {
        amount: 1.0,
        currencyCode: "USD",
        interval: BillingInterval.Usage,
        terms: "1 dollar per 1000 notifications sent",
      },
    ],
  },
}
```

**Enable v3 Billing:**
```typescript
export const shopify = shopifyApp({
  future: {
    v3_lineItemBilling: true,
  },
  billing: { ... },
});
```

#### G. Known Issues

- Calling billing API from `action` (instead of `loader`) can return 401 errors
- Free plan handling is tricky (billing API only checks paid plans)
- Trial expiration edge cases (merchant reinstalls app)

**Sources:**
- [Shopify Billing API Documentation](https://shopify.dev/docs/api/shopify-app-remix/v2/apis/billing)
- [How to Implement Billing in Remix (MageComp)](https://magecomp.com/blog/implement-billing-plan-with-trial-shopify-remix-app/)
- [Mastering Billing with Shopify Remix (Medium)](https://medium.com/breaktheloop/mastering-billing-with-shopify-app-remix-template-5fccca26ac56)

---

## 8. BullMQ Integration with Remix

### Standard Pattern for Adding BullMQ

#### A. Install Dependencies

```bash
npm install bullmq ioredis
npm install -D @types/ioredis
```

#### B. Queue Registry (Singleton Pattern)

**File:** `app/queue.server.ts`

```typescript
import { Queue, QueueEvents, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';

// Redis connection (shared across queues)
const connection = new IORedis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// Global registry (prevents duplicate queue instances)
declare global {
  var __registeredQueues: Record<string, any> | undefined;
}

const registeredQueues =
  global.__registeredQueues ||
  (global.__registeredQueues = {});

// Queue registration function
export function registerQueue<T>(
  name: string,
  processor?: (job: Job<T>) => Promise<any>
) {
  if (!registeredQueues[name]) {
    const queue = new Queue<T>(name, { connection });
    const queueEvents = new QueueEvents(name, { connection });

    // Only create workers in worker process (not web server)
    if (process.env.PROCESS_TYPE === 'worker' && processor) {
      const worker = new Worker<T>(name, processor, {
        connection,
        concurrency: 5, // Process 5 jobs concurrently
      });

      worker.on('completed', (job) => {
        console.log(`✅ Job ${job.id} completed`);
      });

      worker.on('failed', (job, err) => {
        console.error(`❌ Job ${job?.id} failed:`, err);
      });

      registeredQueues[name] = { queue, queueEvents, worker };
    } else {
      registeredQueues[name] = { queue, queueEvents };
    }
  }

  return registeredQueues[name].queue;
}

// Define queues
export const orderMonitorQueue = registerQueue('order-monitor');
export const delayDetectorQueue = registerQueue('delay-detector');
export const notificationQueue = registerQueue('notification');
```

#### C. Enqueueing Jobs (From Remix Routes)

**From webhook handler:**
```typescript
// app/routes/webhooks.orders.updated.tsx
import { orderMonitorQueue } from "~/queue.server";

export async function action({ request }: ActionFunctionArgs) {
  const { payload, session } = await authenticate.webhook(request);

  await orderMonitorQueue.add(
    'monitor',
    {
      orderId: payload.id,
      shopId: session.shop,
    },
    {
      jobId: `monitor-${payload.id}`, // Idempotency
      attempts: 3, // Retry up to 3 times
      backoff: {
        type: 'exponential',
        delay: 5000, // Start with 5 second delay
      },
    }
  );

  return new Response(null, { status: 200 });
}
```

**From scheduled job:**
```typescript
// Add repeatable job (runs every hour)
await orderMonitorQueue.add(
  'periodic-check',
  {},
  {
    repeat: {
      pattern: '0 * * * *', // Cron: every hour
    },
  }
);
```

#### D. Worker Process (Separate from Web Server)

**File:** `worker.ts` (new file at project root)

```typescript
import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { prisma } from './app/db.server';
import { shopify } from './app/shopify.server';

// Set environment flag
process.env.PROCESS_TYPE = 'worker';

const connection = new IORedis(process.env.REDIS_URL!);

// Order Monitor Worker
const orderMonitorWorker = new Worker(
  'order-monitor',
  async (job: Job) => {
    const { orderId, shopId } = job.data;

    console.log(`Processing order ${orderId} for shop ${shopId}`);

    // Fetch shop session from database
    const session = await prisma.session.findFirst({
      where: { shop: shopId },
    });

    if (!session) {
      throw new Error(`No session found for shop ${shopId}`);
    }

    // Create Admin API client
    const admin = shopify.unauthenticated.admin(shopId);

    // Query order from Shopify
    const response = await admin.graphql(`
      query getOrder($id: ID!) {
        order(id: $id) {
          id
          name
          fulfillmentStatus
          displayFulfillmentStatus
        }
      }
    `, {
      variables: { id: `gid://shopify/Order/${orderId}` },
    });

    const { data } = await response.json();

    // Run delay detection logic
    if (data.order.fulfillmentStatus === 'FULFILLED') {
      // Enqueue delay detection job
      await delayDetectorQueue.add('detect', {
        orderId,
        shopId,
      });
    }

    return { processed: true };
  },
  {
    connection,
    concurrency: 10, // Process 10 jobs concurrently
  }
);

// Delay Detector Worker
const delayDetectorWorker = new Worker(
  'delay-detector',
  async (job: Job) => {
    const { orderId, shopId } = job.data;

    // Fetch order from database
    const order = await prisma.order.findUnique({
      where: { shopifyOrderId: String(orderId) },
    });

    if (!order) {
      console.log(`Order ${orderId} not found in database`);
      return;
    }

    // Delay detection logic
    const daysSinceFulfillment = differenceInDays(new Date(), order.fulfilledAt);
    const isDelayed = daysSinceFulfillment > 3;

    if (isDelayed && !order.isDelayed) {
      // Update database
      await prisma.order.update({
        where: { id: order.id },
        data: { isDelayed: true, delayDetectedAt: new Date() },
      });

      // Enqueue notification job
      await notificationQueue.add('send', {
        orderId: order.id,
        type: 'delay_detected',
      });
    }

    return { isDelayed };
  },
  { connection, concurrency: 5 }
);

// Notification Worker
const notificationWorker = new Worker(
  'notification',
  async (job: Job) => {
    const { orderId, type } = job.data;

    // Send email via SendGrid, etc.
    console.log(`Sending ${type} notification for order ${orderId}`);

    // ... email sending logic

    return { sent: true };
  },
  { connection, concurrency: 3 }
);

// Graceful shutdown
const shutdown = async () => {
  console.log('Shutting down workers...');
  await orderMonitorWorker.close();
  await delayDetectorWorker.close();
  await notificationWorker.close();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

console.log('🚀 Workers started');
```

#### E. Worker vs. Web Server

**Key Difference:** Separate processes

**Web Server (`npm run start`):**
- Handles HTTP requests (Remix routes)
- Enqueues jobs to BullMQ
- Returns responses quickly
- Stateless (can scale horizontally)

**Worker (`node worker.ts`):**
- Processes jobs from Redis queues
- Long-running tasks (API calls, email sending)
- Stateful (maintains worker instances)
- Scales independently from web server

**Why Separate:**
- Web server stays responsive (not blocked by slow jobs)
- Workers can be scaled independently (more workers = faster processing)
- Worker crashes don't affect web server
- Different resource requirements (web: CPU, worker: I/O)

**Sources:**
- [BullMQ Integration Guide (Jacob Paris)](https://www.jacobparis.com/content/bullmq-integration-guide)
- [BullMQ Workers Documentation](https://docs.bullmq.io/guide/workers)
- [BullMQ GitHub Gist for Remix (m5r)](https://gist.github.com/m5r/b2f1f0d044bba435d58aab67e82cf79b)

---

## 9. Deployment on Railway

### Configuration for Railway

#### A. Railway Project Structure

```
DelayGuard Railway Project
├── Web Service (Remix App)
│   ├── Start Command: npm run start
│   ├── Build Command: npm run build
│   └── Port: 3000
├── Worker Service (Background Jobs)
│   ├── Start Command: node worker.ts
│   ├── Build Command: npm run build
│   └── Port: (none)
├── PostgreSQL Service (Managed)
│   └── Provides: DATABASE_URL
└── Redis Service (Managed)
    └── Provides: REDIS_URL
```

#### B. Setting Up Services

**1. Create Railway Project:**
```bash
railway init
```

**2. Add PostgreSQL:**
- Railway Dashboard → "New Service" → "Database" → "PostgreSQL"
- Railway auto-generates `DATABASE_URL` variable

**3. Add Redis:**
- Railway Dashboard → "New Service" → "Database" → "Redis"
- Railway auto-generates `REDIS_URL` variable

**4. Add Web Service:**
- Connect GitHub repository
- Railway detects `package.json` and builds automatically
- Set environment variables:
  ```
  SHOPIFY_API_KEY=your_api_key
  SHOPIFY_API_SECRET=your_api_secret
  SHOPIFY_APP_URL=https://your-app.railway.app
  SCOPES=read_orders,write_orders
  NODE_ENV=production
  DATABASE_URL=${{Postgres.DATABASE_URL}}
  REDIS_URL=${{Redis.REDIS_URL}}
  ```

**5. Add Worker Service:**
- Same GitHub repository (different start command)
- Railway → "New Service" → "GitHub Repo" (same repo)
- Custom start command: `node worker.ts`
- Share environment variables with web service

#### C. Railway Configuration Files

**Option 1: `railway.toml`**
```toml
# railway.toml
[deploy]
builder = "NIXPACKS"
buildCommand = "npm run build"
startCommand = "npm run start"

[deploy.healthcheck]
path = "/healthz"
timeout = 100

[[deploy.services]]
name = "web"
startCommand = "npm run start"

[[deploy.services]]
name = "worker"
startCommand = "node worker.ts"
```

**Option 2: `Procfile`** (Railway doesn't support this natively, use separate services instead)

#### D. Running Both Web + Workers

**Method 1: Separate Services (Recommended)**
- Create two Railway services from same GitHub repo
- Web service: `npm run start`
- Worker service: `node worker.ts`
- Both share same environment variables (DATABASE_URL, REDIS_URL)

**Method 2: Single Service with Process Manager (Not Recommended)**
```json
// package.json
{
  "scripts": {
    "start": "concurrently \"npm run start:web\" \"npm run start:worker\"",
    "start:web": "remix-serve ./build/server/index.js",
    "start:worker": "node worker.ts"
  }
}
```
- Install `concurrently`: `npm install concurrently`
- Less flexible (can't scale web/worker independently)

#### E. Environment Variables

**Required:**
| Variable | Source | Example |
|----------|--------|---------|
| `DATABASE_URL` | Railway PostgreSQL | `postgresql://user:pass@host:5432/db` |
| `REDIS_URL` | Railway Redis | `redis://host:6379` |
| `SHOPIFY_API_KEY` | Shopify Partners Dashboard | `abc123...` |
| `SHOPIFY_API_SECRET` | Shopify Partners Dashboard | `shpss_xyz...` |
| `SHOPIFY_APP_URL` | Railway domain | `https://delayguard.up.railway.app` |
| `SCOPES` | Your requirements | `read_orders,write_orders` |
| `NODE_ENV` | Production flag | `production` |

**Optional:**
| Variable | Purpose | Example |
|----------|---------|---------|
| `PROCESS_TYPE` | Distinguish web vs worker | `web` or `worker` |
| `SENDGRID_API_KEY` | Email service | `SG.xxx...` |

#### F. Health Checks

**Add health check endpoint:**
```typescript
// app/routes/healthz.tsx
export async function loader() {
  return new Response("OK", { status: 200 });
}
```

**Configure in Railway:**
- Settings → Health Check → Path: `/healthz`
- Railway pings this endpoint to verify service is running

#### G. Deployment Workflow

1. **Push to GitHub:**
```bash
git add .
git commit -m "Deploy to Railway"
git push origin main
```

2. **Railway auto-deploys:**
- Detects changes via GitHub webhook
- Runs `npm run build`
- Runs database migrations (via `setup` script)
- Restarts services

3. **Monitor logs:**
```bash
railway logs
```

#### H. Cost Estimate

**Railway Pricing (as of 2025):**
- **Starter Plan:** $5/month (includes $5 usage credit)
- **PostgreSQL:** ~$2-5/month (depending on usage)
- **Redis:** ~$1-3/month
- **Total:** ~$8-13/month for small app

**Sources:**
- [Railway Remix Deployment Guide](https://docs.railway.com/guides/remix)
- [Railway Multiple Services Guide](https://docs.railway.com/guides/services)
- [Railway Pricing](https://railway.app/pricing)

---

## 10. Key npm Packages

### Core Packages in Shopify Remix Template

| Package | Version | Purpose | Documentation |
|---------|---------|---------|---------------|
| **@shopify/shopify-app-remix** | ^4.1.0 | Main Shopify SDK for Remix (OAuth, Admin API, webhooks, billing) | [Docs](https://shopify.dev/docs/api/shopify-app-remix) |
| **@shopify/polaris** | ^12.0.0 | UI component library (design system) | [Docs](https://polaris.shopify.com/) |
| **@shopify/app-bridge-react** | ^4.1.6 | App Bridge React bindings (modals, toasts, navigation) | [Docs](https://shopify.dev/docs/api/app-bridge) |
| **@shopify/shopify-app-session-storage-prisma** | ^8.0.0 | Prisma adapter for session storage | [Docs](https://github.com/Shopify/shopify-app-js) |
| **@prisma/client** | ^6.2.1 | Prisma ORM client (database queries) | [Docs](https://www.prisma.io/docs) |
| **prisma** | ^6.2.1 | Prisma CLI (migrations, codegen) | [Docs](https://www.prisma.io/docs) |
| **@remix-run/node** | ^2.16.1 | Remix Node.js adapter (server-side runtime) | [Docs](https://remix.run/docs) |
| **@remix-run/react** | ^2.16.1 | Remix React library (hooks, components) | [Docs](https://remix.run/docs) |
| **@remix-run/serve** | ^2.16.1 | Production server for Remix apps | [Docs](https://remix.run/docs) |
| **@remix-run/dev** | ^2.16.1 | Remix development server and build tools | [Docs](https://remix.run/docs) |
| **react** | ^18.2.0 | React library (UI rendering) | [Docs](https://react.dev/) |
| **react-dom** | ^18.2.0 | React DOM renderer | [Docs](https://react.dev/) |
| **vite** | ^6.2.2 | Build tool and dev server (Remix v2 default) | [Docs](https://vitejs.dev/) |
| **typescript** | ^5.2.2 | TypeScript compiler | [Docs](https://www.typescriptlang.org/) |
| **isbot** | ^5.1.0 | Bot detection (prevents bots from triggering OAuth) | [NPM](https://www.npmjs.com/package/isbot) |

### Additional Packages for DelayGuard

| Package | Version | Purpose | Installation |
|---------|---------|---------|--------------|
| **bullmq** | ^5.x | Job queue and worker management | `npm install bullmq` |
| **ioredis** | ^5.x | Redis client (BullMQ dependency) | `npm install ioredis` |
| **@types/ioredis** | ^5.x | TypeScript types for ioredis | `npm install -D @types/ioredis` |
| **@sendgrid/mail** | ^8.x | SendGrid email service | `npm install @sendgrid/mail` |
| **date-fns** | ^3.x | Date utilities (delay calculations) | `npm install date-fns` |
| **zod** | ^3.x | Schema validation (form validation, API responses) | `npm install zod` |

### Dev Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| **@remix-run/eslint-config** | ^2.16.1 | Remix ESLint configuration |
| **@shopify/api-codegen-preset** | ^1.1.1 | GraphQL codegen preset for Shopify Admin API |
| **@types/node** | ^22.2.0 | Node.js TypeScript types |
| **@types/react** | ^18.2.31 | React TypeScript types |
| **@types/react-dom** | ^18.2.14 | React DOM TypeScript types |
| **eslint** | ^8.42.0 | JavaScript linter |
| **eslint-config-prettier** | ^10.0.1 | Prettier integration for ESLint |
| **prettier** | ^3.2.4 | Code formatter |
| **vite-tsconfig-paths** | ^5.0.1 | TypeScript path mapping for Vite |

### Package Relationships

```
@shopify/shopify-app-remix
├── Depends on: @shopify/shopify-api
├── Integrates with: @remix-run/node
└── Uses: @shopify/shopify-app-session-storage-*

@shopify/polaris
├── Depends on: react, react-dom
└── Provides: UI components

@shopify/app-bridge-react
├── Depends on: @shopify/app-bridge, react
└── Provides: React hooks for App Bridge

BullMQ
├── Depends on: ioredis
└── Provides: Queue, Worker, QueueEvents

Prisma
├── Generates: @prisma/client
└── Uses: DATABASE_URL environment variable
```

### Version Compatibility Notes

- **Node.js:** >= 20.19 (< 22) OR >= 22.12
- **Polaris v13:** Requires Node 20.10+ (template uses v12 for Node 18 compatibility)
- **Remix v2:** Uses Vite (v1 used esbuild)
- **Shopify API Version:** 2025-01 (defined in `shopify.app.toml`)

**Sources:**
- [Shopify Remix Template package.json](https://github.com/Shopify/shopify-app-template-remix/blob/main/package.json)
- [@shopify/shopify-app-remix NPM](https://www.npmjs.com/package/@shopify/shopify-app-remix)
- [BullMQ NPM](https://www.npmjs.com/package/bullmq)
- [Prisma NPM](https://www.npmjs.com/package/prisma)

---

## Summary

This research covers all 10 requested areas for building DelayGuard on the Shopify Remix template:

1. **Template Structure:** File-based routing, `shopify.server.ts` config, Prisma setup
2. **Auth/Session:** OAuth with token exchange, session tokens for embedded apps, Prisma session storage
3. **Prisma:** SQLite default (switch to PostgreSQL), custom models, migrations
4. **Routes:** Loader/action pattern, file naming conventions, API vs. page routes
5. **App Bridge/Polaris:** AppProvider setup, Polaris components, 2025 web components shift
6. **Webhooks:** TOML/programmatic registration, HMAC validation, fast response pattern
7. **Billing:** `billing.require()`, trial periods, usage-based billing (v3)
8. **BullMQ:** Singleton queue registry, separate worker process, job enqueueing
9. **Railway:** Multiple services (web + worker), managed PostgreSQL/Redis, environment variables
10. **npm Packages:** Core Shopify packages, BullMQ dependencies, dev dependencies

**Next Steps:** Use these findings to create technical specification for DelayGuard.
