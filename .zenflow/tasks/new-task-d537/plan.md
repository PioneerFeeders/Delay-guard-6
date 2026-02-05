# DelayGuard - Implementation Plan

## Configuration
- **Artifacts Path**: .zenflow/tasks/new-task-d537
- **Technical Spec**: spec.md
- **Requirements**: requirements.md

---

## Workflow Steps

### [x] Step: Requirements
<!-- chat-id: 5a4b448e-2361-4b6d-9a66-74d29d50e4b9 -->

Create a Product Requirements Document (PRD) based on the feature description.

### [x] Step: Technical Specification
<!-- chat-id: 6aed6f77-4769-47d6-a4b5-49b80ac83fd4 -->

Create a technical specification based on the PRD.

### [x] Step: Planning
<!-- chat-id: 75f95234-3fb1-45d7-9cb4-3ffc2c354a22 -->

Create a detailed implementation plan based on the technical specification.

---

## Phase 1: Foundation

### [x] Step: Project Scaffold and Database Setup
<!-- chat-id: b293fe63-1de5-4a4e-a2d6-085abd18a510 -->

Set up the Shopify Remix app scaffold with PostgreSQL database.

**Tasks:**
- [x] Scaffold project using `npx @shopify/create-app@latest` with Remix template
- [x] Create `.gitignore` with node_modules/, dist/, build/, .cache/, *.log, .env
- [x] Create `.env.example` with all required environment variables from spec section 1.5
- [x] Switch Prisma datasource from SQLite to PostgreSQL in `prisma/schema.prisma`
- [x] Implement full Prisma schema from spec section 4.2 (Session, Merchant, Shipment, TrackingEvent, NotificationLog, ResolutionLog with all enums)
- [x] Run initial Prisma migration
- [x] Create `app/db.server.ts` with Prisma client singleton pattern
- [x] Update `shopify.server.ts` to use Prisma session storage with PostgreSQL

**Verification:**
- `npx prisma validate` passes
- `npx tsc --noEmit` passes
- Database tables created successfully

### [ ] Step: BullMQ and Worker Infrastructure

Set up BullMQ job queue system with Redis and worker process.

**Tasks:**
- [ ] Install dependencies: `bullmq`, `ioredis`
- [ ] Create `app/queue.server.ts` with BullMQ queue registry singleton (queue names from spec section 8.1: poll-scheduler, carrier-poll, fulfillment-sync, send-notification, data-cleanup)
- [ ] Create `app/jobs/queues.ts` with queue name constants
- [ ] Create `worker/index.ts` entry point with graceful shutdown handling
- [ ] Create placeholder worker files for each queue (will be implemented in later phases)
- [ ] Update `package.json` with worker start script: `"worker": "tsx worker/index.ts"`
- [ ] Update Dockerfile for both web and worker process support

**Verification:**
- Worker process starts and connects to Redis
- `npx tsc --noEmit` passes

### [ ] Step: Health Check and Deployment Configuration

Add health check endpoint and prepare Railway deployment configuration.

**Tasks:**
- [ ] Create `app/routes/healthz.tsx` returning JSON health status with database and Redis connectivity checks
- [ ] Create `railway.toml` or document Railway service configuration for web + worker
- [ ] Verify OAuth flow works with a Shopify dev store
- [ ] Test that app installs and creates Session record in PostgreSQL

**Verification:**
- `GET /healthz` returns 200 with status info
- App successfully installs on Shopify dev store
- Session record visible in database

---

## Phase 2: Shopify Integration (Data Ingestion)

### [ ] Step: Merchant Management and Authentication

Implement merchant record creation on app install.

**Tasks:**
- [ ] Create `app/services/merchant.service.ts` with createOrUpdateMerchant function
- [ ] Modify `app/routes/app.tsx` loader to create Merchant record on first load (after OAuth)
- [ ] Generate random poll offset (0-239) for each new merchant
- [ ] Set default settings JSON structure per spec section 4.3
- [ ] Add Zod schema for MerchantSettings validation in `app/lib/validation.ts`
- [ ] Write unit tests for merchant creation logic

**Verification:**
- On app install, Merchant record created with correct defaults
- Tests pass: `npx vitest run`

### [ ] Step: Webhook Handlers for Fulfillments

Implement webhook handlers for fulfillment events.

**Tasks:**
- [ ] Update `shopify.app.toml` with webhook subscriptions from spec section 5.4
- [ ] Create `app/routes/webhooks.fulfillments.create.tsx` - validates HMAC, creates Shipment record, enqueues carrier-poll job
- [ ] Create `app/routes/webhooks.fulfillments.update.tsx` - updates tracking number/carrier if changed
- [ ] Create `app/routes/webhooks.app.uninstalled.tsx` - marks merchant uninstalled, schedules data purge
- [ ] Create `app/services/shipment.service.ts` with createShipmentFromFulfillment function
- [ ] Implement carrier detection logic in `app/services/carriers/carrier.service.ts` (from spec section 6.2)
- [ ] Add Zod schemas for webhook payload validation
- [ ] Write unit tests for carrier detection and shipment creation

**Verification:**
- Webhook trigger via `shopify webhook trigger fulfillments/create` creates Shipment record
- Carrier correctly detected from tracking_company and tracking number patterns
- Tests pass

### [ ] Step: Initial Fulfillment Sync

Implement initial sync of fulfillments from Shopify.

**Tasks:**
- [ ] Create `app/services/sync.service.ts` with syncFulfillments function
- [ ] Implement GraphQL query for fulfillments from last 5 days with pagination
- [ ] Create `app/jobs/fulfillment-sync.job.ts` job definition
- [ ] Create `worker/fulfillment-sync.worker.ts` with progress tracking
- [ ] Handle rate limiting (GraphQL cost-based throttling)
- [ ] Skip already-synced fulfillments (by shopifyFulfillmentId)
- [ ] Create `app/routes/api.sync.tsx` for manual re-sync trigger
- [ ] Write unit tests for sync logic

**Verification:**
- Initial sync pulls fulfillments from test store
- Duplicate fulfillments not created
- Sync progress trackable

---

## Phase 3: Carrier Integration & Delay Detection

### [ ] Step: Carrier Adapter Interface and UPS Integration

Implement carrier adapter interface and UPS Track API integration.

**Tasks:**
- [ ] Create `app/services/carriers/carrier.interface.ts` with TrackingResult, TrackingEvent, CarrierAdapter interfaces from spec section 6.1
- [ ] Create `app/services/carriers/carrier.types.ts` with shared types
- [ ] Create `app/services/carriers/ups.adapter.ts`:
  - OAuth 2.0 token management with Redis caching (TTL = expires_in - 60s)
  - Track API call to `https://onlinetools.ups.com/api/track/v1/details/{trackingNumber}`
  - Parse response into TrackingResult (exception: status.type === "X", delivered: status.type === "D")
  - Build tracking URL
- [ ] Add Zod schema for UPS API response validation
- [ ] Write unit tests with mocked UPS API responses

**Verification:**
- UPS adapter correctly parses sample API responses
- Token caching works (Redis key: carrier_token:ups)
- Tests pass

### [ ] Step: FedEx and USPS Carrier Adapters

Implement FedEx and USPS carrier adapters.

**Tasks:**
- [ ] Create `app/services/carriers/fedex.adapter.ts`:
  - OAuth 2.0 client credentials with Redis caching
  - Track API call to `https://apis.fedex.com/track/v1/trackingnumbers`
  - Parse response (exception: statusByLocale keywords, delivered: code === "DL")
  - Build tracking URL
- [ ] Create `app/services/carriers/usps.adapter.ts`:
  - User ID authentication
  - XML API call to `https://secure.shippingapis.com/ShippingAPI.dll`
  - Parse XML response (exception: "Arriving Late", delivered: "Delivered")
  - Build tracking URL
- [ ] Update `carrier.service.ts` to delegate to correct adapter based on carrier enum
- [ ] Add Zod schemas for FedEx and USPS API response validation
- [ ] Write unit tests with mocked API responses for both carriers

**Verification:**
- All three adapters correctly parse sample responses
- Carrier service routes to correct adapter
- Tests pass

### [ ] Step: Delay Detection Service

Implement delay detection logic.

**Tasks:**
- [ ] Create `app/services/delay-detection.service.ts` with evaluateDelay function from spec section 7.1
- [ ] Implement default delivery windows lookup (spec section 7.2)
- [ ] Create `app/lib/business-days.ts` for business day calculations using date-fns
- [ ] Service level normalization (fuzzy matching for "UPS GROUND", "Ground", "UPS Ground" -> ups_ground)
- [ ] Support merchant overrides from settings.deliveryWindows
- [ ] Grace period from settings.delayThresholdHours (default: 8)
- [ ] Write comprehensive unit tests for delay scenarios: carrier exception, past due, grace period, rescheduled

**Verification:**
- All delay detection scenarios correctly handled
- Business day calculations accurate
- Tests pass

### [ ] Step: Carrier Poll Worker

Implement background worker for carrier polling.

**Tasks:**
- [ ] Create `app/jobs/carrier-poll.job.ts` job definition
- [ ] Create `worker/carrier-poll.worker.ts` implementing logic from spec section 8.3:
  - Load shipment and merchant from DB
  - Skip if carrier === UNKNOWN
  - Call carrier adapter
  - Upsert tracking events into TrackingEvent table
  - Update shipment fields (currentStatus, lastScanLocation, etc.)
  - Run delay detection, update isDelayed/delayFlaggedAt
  - Handle delivery (isDelivered, deliveredAt)
  - Calculate nextPollAt using smart scheduling (spec section 8.4)
  - Error handling with pollErrorCount
- [ ] Set concurrency to 10 as per spec
- [ ] Write integration tests with mocked carrier adapters

**Verification:**
- Shipment status updated after poll
- Tracking events stored
- Delay correctly flagged
- nextPollAt calculated correctly

### [ ] Step: Poll Scheduler and Data Cleanup Workers

Implement scheduler for triggering polls and data cleanup.

**Tasks:**
- [ ] Create `app/jobs/poll-scheduler.job.ts` job definition
- [ ] Create `worker/poll-scheduler.worker.ts`:
  - Query shipments where nextPollAt <= now(), not archived/delivered, merchant active
  - Enqueue carrier-poll jobs with deduplication (jobId = poll-{shipment.id})
  - Priority based on urgency (past-due = higher)
  - Run as BullMQ repeatable job every 15 minutes
- [ ] Create `app/jobs/data-cleanup.job.ts` job definition
- [ ] Create `worker/data-cleanup.worker.ts`:
  - Archive: isArchived=true for delivered shipments past autoArchiveDays
  - Purge: Delete data for merchants uninstalled > 30 days
  - Run as daily repeatable job
- [ ] Write unit tests

**Verification:**
- Scheduler correctly identifies shipments due for polling
- Jobs enqueued with proper deduplication
- Cleanup archives and purges correctly

---

## Phase 4: Dashboard & Core UI

### [ ] Step: Dashboard Layout and Summary Cards

Implement main dashboard layout with summary metrics.

**Tasks:**
- [ ] Create `app/routes/app._index.tsx` with loader that checks onboardingDone, redirects if needed
- [ ] Create `app/components/dashboard/SummaryCards.tsx` displaying:
  - Total active shipments
  - Delayed shipments (with badge)
  - Delivered today
  - Average delivery time by carrier
- [ ] Create `app/components/dashboard/TabNav.tsx` with tabs: All, Delayed, Pending Pickup, Resolved, Delivered
- [ ] Style with Polaris components (Page, Layout, Card, Badge)
- [ ] Implement loader query for summary statistics

**Verification:**
- Dashboard loads with summary cards
- Tab navigation works
- `npx tsc --noEmit` passes

### [ ] Step: Shipment API Endpoint

Implement JSON API for querying shipments with filtering and pagination.

**Tasks:**
- [ ] Create `app/routes/api.shipments.tsx` GET endpoint with query params from spec section 5.2
- [ ] Implement pagination (page, pageSize with max 100)
- [ ] Implement filtering: tab, carrier, serviceLevel, delayStatus, orderValueMin/Max, shipDateFrom/To, locationId
- [ ] Implement sorting: sortBy, sortDir
- [ ] Return response shape: { shipments, pagination, summary }
- [ ] Add Zod schema for query parameter validation
- [ ] Write unit tests for query building

**Verification:**
- API returns correct filtered/sorted/paginated results
- Query parameters validated
- Tests pass

### [ ] Step: Shipment Table and Detail Panel

Implement shipment data table with expandable details.

**Tasks:**
- [ ] Create `app/components/dashboard/ShipmentTable.tsx`:
  - Polaris IndexTable with selection
  - Default columns from spec (Order#, Tracking#, Carrier, Service Level, Customer Name, Ship Date, Expected Delivery, Days Delayed, Order Value)
  - Links: Order# -> Shopify order, Tracking# -> carrier tracking page
  - Row click expands detail panel
- [ ] Create `app/components/dashboard/ShipmentDetailPanel.tsx`:
  - Full customer info
  - Tracking timeline from TrackingEvent records
  - Carrier status details
  - Notification history
  - Resolution history
  - Quick action buttons
- [ ] Integrate with api.shipments endpoint using fetcher for AJAX updates
- [ ] Implement loading states

**Verification:**
- Table displays shipment data
- Detail panel shows complete information
- Row selection works

### [ ] Step: Filtering and Column Customization

Implement filter controls and column customization.

**Tasks:**
- [ ] Create `app/components/dashboard/FilterBar.tsx`:
  - Carrier filter (multi-select)
  - Service level filter
  - Delay status filter
  - Order value range inputs
  - Ship date range picker
  - Location filter (for multi-location merchants)
  - Clear filters button
- [ ] Implement column customization:
  - Column visibility toggles (Polaris Popover with checkboxes)
  - Column reorder (drag-drop or picker)
  - Save preferences to merchant.settings via API
- [ ] Create `app/routes/api.settings.tsx` POST endpoint for saving preferences
- [ ] Filters update URL params and trigger fetcher

**Verification:**
- All filters work correctly
- Column visibility persists
- Preferences saved to database

---

## Phase 5: Notifications & Resolution

### [ ] Step: Send Notification Flow

Implement individual notification sending.

**Tasks:**
- [ ] Create `app/components/notifications/SendNotificationModal.tsx`:
  - Pre-filled recipient email (editable)
  - Pre-filled subject from template (editable)
  - Pre-filled body from template with variables replaced (editable)
  - Email preview
  - Send button
- [ ] Create `app/services/notification.service.ts`:
  - renderTemplate function with variable replacement (spec section 9.1)
  - sendNotificationEmail function using Resend (spec section 9.2)
  - createNotificationLog function
- [ ] Install `resend` package
- [ ] Create `app/routes/api.shipments.$id.notify.tsx` POST endpoint
- [ ] Create `app/jobs/send-notification.job.ts` job definition
- [ ] Create `worker/send-notification.worker.ts`
- [ ] Update ShipmentTable/DetailPanel with Send Notification action
- [ ] Write unit tests for template rendering

**Verification:**
- Notification modal opens with pre-filled data
- Email sent successfully via Resend
- NotificationLog record created
- Shipment marked as notificationSent=true

### [ ] Step: Resolution Workflow

Implement shipment resolution flow.

**Tasks:**
- [ ] Create `app/components/resolution/ResolveModal.tsx`:
  - Resolution reason dropdown (enum values from spec FR-RESOLVE-1)
  - Optional notes field (500 char max)
  - Resolve button
- [ ] Create `app/services/resolution.service.ts`:
  - resolveShipment function
  - createResolutionLog function (includes timeDelayedBeforeResolution calculation)
- [ ] Create `app/routes/api.shipments.$id.resolve.tsx` POST endpoint
- [ ] Update ShipmentTable/DetailPanel with Resolve action
- [ ] Resolution history in detail panel
- [ ] Write unit tests

**Verification:**
- Resolution modal captures reason and notes
- Shipment moves to Resolved tab
- ResolutionLog record created with audit trail

### [ ] Step: Bulk Actions and CSV Export

Implement bulk operations and export functionality.

**Tasks:**
- [ ] Create `app/components/dashboard/BulkActionBar.tsx`:
  - Shows when rows selected
  - "Send Notification to All" button
  - "Mark All as Resolved" button
  - "Export Selected" button
- [ ] Create `app/routes/api.shipments.bulk-notify.tsx` POST endpoint (enqueues jobs, returns immediately)
- [ ] Create `app/routes/api.shipments.bulk-resolve.tsx` POST endpoint
- [ ] Create `app/lib/csv.ts` with generateCSV function
- [ ] Create `app/routes/api.shipments.export.tsx` GET endpoint:
  - Same query params as api.shipments
  - Returns Content-Type: text/csv with Content-Disposition: attachment
  - Include all visible columns plus customer email
- [ ] Wire up bulk actions in ShipmentTable
- [ ] Write unit tests for CSV generation

**Verification:**
- Bulk notify enqueues multiple jobs
- Bulk resolve updates all selected
- CSV downloads with correct data
- Tests pass

### [ ] Step: Notification Template Settings

Implement notification template customization.

**Tasks:**
- [ ] Create `app/components/settings/NotificationSettings.tsx`:
  - Subject field (editable)
  - Body textarea (editable, must keep core variables)
  - Template variable reference
  - Preview with sample data
  - Save button
- [ ] Add template validation (must contain {tracking_number}, {order_number})
- [ ] Integrate into Settings page
- [ ] Load/save from merchant.settings.notificationTemplate

**Verification:**
- Template customization saves correctly
- Preview renders with sample data
- Validation prevents removing required variables

---

## Phase 6: Billing, Onboarding & Settings

### [ ] Step: Shopify Billing Integration

Implement billing flow with Shopify Billing API.

**Tasks:**
- [ ] Update `app/shopify.server.ts` with billing configuration from spec section 10.1
- [ ] Create `app/services/billing.service.ts`:
  - Plan limit constants (spec section 10.2)
  - getCurrentUsage function (count shipments with hasCarrierScan=true in current billing cycle)
  - checkPlanLimit function
  - Feature gating checks (spec section 10.3)
- [ ] Create `app/routes/api.billing.tsx` with actions:
  - selectPlan: creates Shopify subscription, returns confirmationUrl
  - confirmPlan: handles callback, activates plan
- [ ] Implement plan limit enforcement:
  - In webhook handler: check limit before creating shipment
  - In carrier-poll worker: check on first scan
  - Show upgrade prompt when at limit
- [ ] Write unit tests for billing logic

**Verification:**
- Plan selection redirects to Shopify approval
- Plan activated after approval
- Shipment counting works correctly
- Feature gating enforced

### [ ] Step: Onboarding Wizard

Implement four-step onboarding flow.

**Tasks:**
- [ ] Create `app/routes/app.onboarding.tsx` with multi-step wizard
- [ ] Create `app/components/onboarding/WelcomeStep.tsx`:
  - Value proposition
  - "Let's get you set up" CTA
- [ ] Create `app/components/onboarding/PreferencesStep.tsx`:
  - Polling frequency preference
  - Delay threshold setting (default: 8 hours)
  - Timezone selection
  - Template preview
- [ ] Create `app/components/onboarding/SyncStep.tsx`:
  - Progress indicator
  - Trigger fulfillment-sync job
  - Poll for completion
  - Show "Synced X shipments! Y are currently delayed."
- [ ] Create `app/components/onboarding/TestModeStep.tsx`:
  - Option to add test shipment
  - Pre-loaded dummy data option
  - Skip to dashboard button
- [ ] Set merchant.onboardingDone = true on completion
- [ ] Redirect from dashboard if onboardingDone = false

**Verification:**
- Wizard flows through all steps
- Sync progress displayed
- Preferences saved
- Completes and reaches dashboard

### [ ] Step: Settings Page

Implement full settings page with all sections.

**Tasks:**
- [ ] Create `app/routes/app.settings.tsx` with sectioned layout
- [ ] Create `app/components/settings/PollingSettings.tsx`:
  - Polling frequency preferences
  - Delay threshold (hours)
  - Default delivery windows table (editable)
- [ ] Create `app/components/settings/DashboardPreferences.tsx`:
  - Column visibility toggles
  - Default sort order
  - Location filtering defaults
- [ ] Reuse NotificationSettings from Phase 5
- [ ] Create `app/components/settings/DisplaySettings.tsx`:
  - Timezone selection
  - Auto-archive days setting
- [ ] Create `app/components/settings/AccountBilling.tsx`:
  - Current plan display
  - Usage meter (shipments this cycle vs limit)
  - Upgrade/downgrade buttons
  - Billing history (from Shopify)
- [ ] All settings save to merchant.settings JSON
- [ ] Write unit tests for settings validation

**Verification:**
- All settings sections render
- Changes save and persist
- Billing section shows correct info

### [ ] Step: Edge Cases and App Lifecycle

Handle edge cases and app lifecycle events.

**Tasks:**
- [ ] Handle store paused/frozen:
  - Check shop status in app.tsx loader
  - Show paused message if store frozen
  - Pause polling for frozen stores
- [ ] Handle merchant downgrades:
  - Stop tracking new shipments immediately
  - Continue in-progress shipments
  - Show downgrade messaging
- [ ] Implement test mode:
  - Add test shipment with real or fake tracking number
  - Pre-loaded dummy data
  - "Test Data" badge display
  - "Clear test data" function
- [ ] Handle duplicate tracking numbers:
  - Detection in webhook handler
  - Warning display in dashboard
  - Merchant decision flow
- [ ] Complete `webhooks.app.uninstalled.tsx`:
  - Mark merchant as uninstalled
  - Stop all polling
  - Schedule data purge job (30 days)
- [ ] Write tests for edge cases

**Verification:**
- Paused stores handled gracefully
- Downgrades enforced correctly
- Test mode works
- Duplicates flagged
- Uninstall cleans up properly

---

## Phase 7: Testing and Polish

### [ ] Step: Comprehensive Testing

Add comprehensive test coverage.

**Tasks:**
- [ ] Unit tests for all services (aim for >80% coverage on business logic)
- [ ] Integration tests for:
  - Carrier adapters with sandbox/mock APIs
  - Webhook handlers with mocked authenticate.webhook
  - API routes with mocked Prisma
- [ ] E2E test scenarios:
  - Install -> onboarding -> dashboard
  - Create fulfillment -> webhook -> shipment appears
  - Carrier poll -> delay detected -> notification sent -> resolved
- [ ] Set up Vitest configuration
- [ ] Add test scripts to package.json

**Verification:**
- `npx vitest run` passes
- Coverage report shows adequate coverage
- All critical paths tested

### [ ] Step: Code Quality and Documentation

Final code quality pass and documentation.

**Tasks:**
- [ ] Run ESLint, fix all errors: `npx eslint . --fix`
- [ ] Run type check: `npx tsc --noEmit`
- [ ] Run Prisma validate: `npx prisma validate`
- [ ] Review all TODO comments and resolve
- [ ] Add inline documentation for complex functions
- [ ] Create DEPLOYMENT.md with Railway setup instructions
- [ ] Verify all environment variables documented in .env.example

**Verification:**
- No lint errors
- No type errors
- All checks pass
- Deployment guide complete
