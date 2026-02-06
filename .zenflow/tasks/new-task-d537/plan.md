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

### [x] Step: BullMQ and Worker Infrastructure
<!-- chat-id: bee739da-f833-4eb3-a0fd-e2edb8301841 -->

Set up BullMQ job queue system with Redis and worker process.

**Tasks:**
- [x] Install dependencies: `bullmq`, `ioredis`
- [x] Create `app/queue.server.ts` with BullMQ queue registry singleton (queue names from spec section 8.1: poll-scheduler, carrier-poll, fulfillment-sync, send-notification, data-cleanup)
- [x] Create `app/jobs/queues.ts` with queue name constants
- [x] Create `worker/index.ts` entry point with graceful shutdown handling
- [x] Create placeholder worker files for each queue (will be implemented in later phases)
- [x] Update `package.json` with worker start script: `"worker": "tsx worker/index.ts"`
- [x] Update Dockerfile for both web and worker process support

**Verification:**
- Worker process starts and connects to Redis
- `npx tsc --noEmit` passes

### [x] Step: Health Check and Deployment Configuration
<!-- chat-id: 19c506a6-a3ac-4637-a2c4-cabe25360781 -->

Add health check endpoint and prepare Railway deployment configuration.

**Tasks:**
- [x] Create `app/routes/healthz.tsx` returning JSON health status with database and Redis connectivity checks
- [x] Create `railway.toml` or document Railway service configuration for web + worker
- [x] Verify OAuth flow works with a Shopify dev store
- [x] Test that app installs and creates Session record in PostgreSQL

**Verification:**
- `GET /healthz` returns 200 with status info
- App successfully installs on Shopify dev store
- Session record visible in database

---

## Phase 2: Shopify Integration (Data Ingestion)

### [x] Step: Merchant Management and Authentication
<!-- chat-id: b35ab555-df5c-45a5-ae42-995c19528772 -->

Implement merchant record creation on app install.

**Tasks:**
- [x] Create `app/services/merchant.service.ts` with createOrUpdateMerchant function
- [x] Modify `app/routes/app.tsx` loader to create Merchant record on first load (after OAuth)
- [x] Generate random poll offset (0-239) for each new merchant
- [x] Set default settings JSON structure per spec section 4.3
- [x] Add Zod schema for MerchantSettings validation in `app/lib/validation.ts`
- [x] Write unit tests for merchant creation logic

**Verification:**
- On app install, Merchant record created with correct defaults
- Tests pass: `npx vitest run`

### [x] Step: Webhook Handlers for Fulfillments
<!-- chat-id: 9a5666d9-a4a8-4e7c-9cd2-fe2a32fd8b5f -->

Implement webhook handlers for fulfillment events.

**Tasks:**
- [x] Update `shopify.app.toml` with webhook subscriptions from spec section 5.4
- [x] Create `app/routes/webhooks.fulfillments.create.tsx` - validates HMAC, creates Shipment record, enqueues carrier-poll job
- [x] Create `app/routes/webhooks.fulfillments.update.tsx` - updates tracking number/carrier if changed
- [x] Create `app/routes/webhooks.app.uninstalled.tsx` - marks merchant uninstalled, schedules data purge
- [x] Create `app/services/shipment.service.ts` with createShipmentFromFulfillment function
- [x] Implement carrier detection logic in `app/services/carriers/carrier.service.ts` (from spec section 6.2)
- [x] Add Zod schemas for webhook payload validation
- [x] Write unit tests for carrier detection and shipment creation

**Verification:**
- Webhook trigger via `shopify webhook trigger fulfillments/create` creates Shipment record
- Carrier correctly detected from tracking_company and tracking number patterns
- Tests pass

### [x] Step: Initial Fulfillment Sync
<!-- chat-id: 5582bd23-b4a0-49bf-a60b-d5533dece0b8 -->

Implement initial sync of fulfillments from Shopify.

**Tasks:**
- [x] Create `app/services/sync.service.ts` with syncFulfillments function
- [x] Implement GraphQL query for fulfillments from last 5 days with pagination
- [x] Create `app/jobs/fulfillment-sync.job.ts` job definition
- [x] Create `worker/fulfillment-sync.worker.ts` with progress tracking
- [x] Handle rate limiting (GraphQL cost-based throttling)
- [x] Skip already-synced fulfillments (by shopifyFulfillmentId)
- [x] Create `app/routes/api.sync.tsx` for manual re-sync trigger
- [x] Write unit tests for sync logic

**Verification:**
- Initial sync pulls fulfillments from test store
- Duplicate fulfillments not created
- Sync progress trackable

---

## Phase 3: Carrier Integration & Delay Detection

### [x] Step: Carrier Adapter Interface and UPS Integration
<!-- chat-id: f34bf3d8-44ff-4869-80bf-5f59505f26d6 -->

Implement carrier adapter interface and UPS Track API integration.

**Tasks:**
- [x] Create `app/services/carriers/carrier.interface.ts` with TrackingResult, TrackingEvent, CarrierAdapter interfaces from spec section 6.1
- [x] Create `app/services/carriers/carrier.types.ts` with shared types
- [x] Create `app/services/carriers/ups.adapter.ts`:
  - OAuth 2.0 token management with Redis caching (TTL = expires_in - 60s)
  - Track API call to `https://onlinetools.ups.com/api/track/v1/details/{trackingNumber}`
  - Parse response into TrackingResult (exception: status.type === "X", delivered: status.type === "D")
  - Build tracking URL
- [x] Add Zod schema for UPS API response validation
- [x] Write unit tests with mocked UPS API responses

**Verification:**
- UPS adapter correctly parses sample API responses
- Token caching works (Redis key: carrier_token:ups)
- Tests pass

### [x] Step: FedEx and USPS Carrier Adapters
<!-- chat-id: a0c14916-658e-481d-bbb0-0b604f87379b -->

Implement FedEx and USPS carrier adapters.

**Tasks:**
- [x] Create `app/services/carriers/fedex.adapter.ts`:
  - OAuth 2.0 client credentials with Redis caching
  - Track API call to `https://apis.fedex.com/track/v1/trackingnumbers`
  - Parse response (exception: statusByLocale keywords, delivered: code === "DL")
  - Build tracking URL
- [x] Create `app/services/carriers/usps.adapter.ts`:
  - User ID authentication
  - XML API call to `https://secure.shippingapis.com/ShippingAPI.dll`
  - Parse XML response (exception: "Arriving Late", delivered: "Delivered")
  - Build tracking URL
- [x] Update `carrier.service.ts` to delegate to correct adapter based on carrier enum
- [x] Add Zod schemas for FedEx and USPS API response validation
- [x] Write unit tests with mocked API responses for both carriers

**Verification:**
- All three adapters correctly parse sample responses
- Carrier service routes to correct adapter
- Tests pass

### [x] Step: Delay Detection Service
<!-- chat-id: 6269682c-4e5e-4bdb-b58d-0511f90d2179 -->

Implement delay detection logic.

**Tasks:**
- [x] Create `app/services/delay-detection.service.ts` with evaluateDelay function from spec section 7.1
- [x] Implement default delivery windows lookup (spec section 7.2)
- [x] Create `app/lib/business-days.ts` for business day calculations using date-fns
- [x] Service level normalization (fuzzy matching for "UPS GROUND", "Ground", "UPS Ground" -> ups_ground)
- [x] Support merchant overrides from settings.deliveryWindows
- [x] Grace period from settings.delayThresholdHours (default: 8)
- [x] Write comprehensive unit tests for delay scenarios: carrier exception, past due, grace period, rescheduled

**Verification:**
- All delay detection scenarios correctly handled
- Business day calculations accurate
- Tests pass

### [x] Step: Carrier Poll Worker
<!-- chat-id: 3631cebe-fa1a-45a7-bf7a-6a8ef5eaaf96 -->

Implement background worker for carrier polling.

**Tasks:**
- [x] Create `app/jobs/carrier-poll.job.ts` job definition
- [x] Create `worker/carrier-poll.worker.ts` implementing logic from spec section 8.3:
  - Load shipment and merchant from DB
  - Skip if carrier === UNKNOWN
  - Call carrier adapter
  - Upsert tracking events into TrackingEvent table
  - Update shipment fields (currentStatus, lastScanLocation, etc.)
  - Run delay detection, update isDelayed/delayFlaggedAt
  - Handle delivery (isDelivered, deliveredAt)
  - Calculate nextPollAt using smart scheduling (spec section 8.4)
  - Error handling with pollErrorCount
- [x] Set concurrency to 10 as per spec
- [x] Write integration tests with mocked carrier adapters

**Verification:**
- Shipment status updated after poll
- Tracking events stored
- Delay correctly flagged
- nextPollAt calculated correctly

### [x] Step: Poll Scheduler and Data Cleanup Workers
<!-- chat-id: 5ebc2776-ea6f-4dfa-b6c2-9382ebf2db93 -->

Implement scheduler for triggering polls and data cleanup.

**Tasks:**
- [x] Create `app/jobs/poll-scheduler.job.ts` job definition
- [x] Create `worker/poll-scheduler.worker.ts`:
  - Query shipments where nextPollAt <= now(), not archived/delivered, merchant active
  - Enqueue carrier-poll jobs with deduplication (jobId = poll-{shipment.id})
  - Priority based on urgency (past-due = higher)
  - Run as BullMQ repeatable job every 15 minutes
- [x] Create `app/jobs/data-cleanup.job.ts` job definition
- [x] Create `worker/data-cleanup.worker.ts`:
  - Archive: isArchived=true for delivered shipments past autoArchiveDays
  - Purge: Delete data for merchants uninstalled > 30 days
  - Run as daily repeatable job
- [x] Write unit tests

**Verification:**
- Scheduler correctly identifies shipments due for polling
- Jobs enqueued with proper deduplication
- Cleanup archives and purges correctly

---

## Phase 4: Dashboard & Core UI

### [x] Step: Dashboard Layout and Summary Cards
<!-- chat-id: 8b231911-ef07-42fc-a106-6752851206f2 -->

Implement main dashboard layout with summary metrics.

**Tasks:**
- [x] Create `app/routes/app._index.tsx` with loader that checks onboardingDone, redirects if needed
- [x] Create `app/components/dashboard/SummaryCards.tsx` displaying:
  - Total active shipments
  - Delayed shipments (with badge)
  - Delivered today
  - Average delivery time by carrier
- [x] Create `app/components/dashboard/TabNav.tsx` with tabs: All, Delayed, Pending Pickup, Resolved, Delivered
- [x] Style with Polaris components (Page, Layout, Card, Badge)
- [x] Implement loader query for summary statistics

**Verification:**
- Dashboard loads with summary cards
- Tab navigation works
- `npx tsc --noEmit` passes

### [x] Step: Shipment API Endpoint
<!-- chat-id: 972ff22a-dcbc-43a6-ad92-62c06b083f49 -->

Implement JSON API for querying shipments with filtering and pagination.

**Tasks:**
- [x] Create `app/routes/api.shipments.tsx` GET endpoint with query params from spec section 5.2
- [x] Implement pagination (page, pageSize with max 100)
- [x] Implement filtering: tab, carrier, serviceLevel, delayStatus, orderValueMin/Max, shipDateFrom/To, locationId
- [x] Implement sorting: sortBy, sortDir
- [x] Return response shape: { shipments, pagination, summary }
- [x] Add Zod schema for query parameter validation
- [x] Write unit tests for query building

**Verification:**
- API returns correct filtered/sorted/paginated results
- Query parameters validated
- Tests pass

### [x] Step: Shipment Table and Detail Panel
<!-- chat-id: 23910f7c-abb2-4642-9b2a-18ef3833f501 -->

Implement shipment data table with expandable details.

**Tasks:**
- [x] Create `app/components/dashboard/ShipmentTable.tsx`:
  - Polaris IndexTable with selection
  - Default columns from spec (Order#, Tracking#, Carrier, Service Level, Customer Name, Ship Date, Expected Delivery, Days Delayed, Order Value)
  - Links: Order# -> Shopify order, Tracking# -> carrier tracking page
  - Row click expands detail panel
- [x] Create `app/components/dashboard/ShipmentDetailPanel.tsx`:
  - Full customer info
  - Tracking timeline from TrackingEvent records
  - Carrier status details
  - Notification history
  - Resolution history
  - Quick action buttons
- [x] Integrate with api.shipments endpoint using fetcher for AJAX updates
- [x] Implement loading states

**Verification:**
- Table displays shipment data
- Detail panel shows complete information
- Row selection works

### [x] Step: Filtering and Column Customization
<!-- chat-id: b3df8bdd-8df9-4615-8292-fc1bbd69f6d8 -->

Implement filter controls and column customization.

**Tasks:**
- [x] Create `app/components/dashboard/FilterBar.tsx`:
  - Carrier filter (multi-select)
  - Service level filter
  - Delay status filter
  - Order value range inputs
  - Ship date range picker
  - Location filter (for multi-location merchants)
  - Clear filters button
- [x] Implement column customization:
  - Column visibility toggles (Polaris Popover with checkboxes)
  - Column reorder (drag-drop or picker)
  - Save preferences to merchant.settings via API
- [x] Create `app/routes/api.settings.tsx` POST endpoint for saving preferences
- [x] Filters update URL params and trigger fetcher

**Verification:**
- All filters work correctly
- Column visibility persists
- Preferences saved to database

---

## Phase 5: Notifications & Resolution

### [x] Step: Send Notification Flow
<!-- chat-id: 0bec18c8-503b-4f7c-942a-a9853fa8c3db -->

Implement individual notification sending.

**Tasks:**
- [x] Create `app/components/notifications/SendNotificationModal.tsx`:
  - Pre-filled recipient email (editable)
  - Pre-filled subject from template (editable)
  - Pre-filled body from template with variables replaced (editable)
  - Email preview
  - Send button
- [x] Create `app/services/notification.service.ts`:
  - renderTemplate function with variable replacement (spec section 9.1)
  - sendNotificationEmail function using Resend (spec section 9.2)
  - createNotificationLog function
- [x] Install `resend` package
- [x] Create `app/routes/api.shipments.$id.notify.tsx` POST endpoint
- [x] Create `app/jobs/send-notification.job.ts` job definition
- [x] Create `worker/send-notification.worker.ts`
- [x] Update ShipmentTable/DetailPanel with Send Notification action
- [x] Write unit tests for template rendering

**Verification:**
- Notification modal opens with pre-filled data
- Email sent successfully via Resend
- NotificationLog record created
- Shipment marked as notificationSent=true

### [x] Step: Resolution Workflow
<!-- chat-id: 6419183b-16ed-441e-afd0-eba8dc402277 -->

Implement shipment resolution flow.

**Tasks:**
- [x] Create `app/components/resolution/ResolveModal.tsx`:
  - Resolution reason dropdown (enum values from spec FR-RESOLVE-1)
  - Optional notes field (500 char max)
  - Resolve button
- [x] Create `app/services/resolution.service.ts`:
  - resolveShipment function
  - createResolutionLog function (includes timeDelayedBeforeResolution calculation)
- [x] Create `app/routes/api.shipments.$id.resolve.tsx` POST endpoint
- [x] Update ShipmentTable/DetailPanel with Resolve action
- [x] Resolution history in detail panel
- [x] Write unit tests

**Verification:**
- Resolution modal captures reason and notes
- Shipment moves to Resolved tab
- ResolutionLog record created with audit trail

### [x] Step: Bulk Actions and CSV Export
<!-- chat-id: 54262570-7827-4095-a49a-6b5ed3f473af -->

Implement bulk operations and export functionality.

**Tasks:**
- [x] Create `app/components/dashboard/BulkActionBar.tsx`:
  - Shows when rows selected
  - "Send Notification to All" button
  - "Mark All as Resolved" button
  - "Export Selected" button
- [x] Create `app/routes/api.shipments.bulk-notify.tsx` POST endpoint (enqueues jobs, returns immediately)
- [x] Create `app/routes/api.shipments.bulk-resolve.tsx` POST endpoint
- [x] Create `app/lib/csv.ts` with generateCSV function
- [x] Create `app/routes/api.shipments.export.tsx` GET endpoint:
  - Same query params as api.shipments
  - Returns Content-Type: text/csv with Content-Disposition: attachment
  - Include all visible columns plus customer email
- [x] Wire up bulk actions in ShipmentTable
- [x] Write unit tests for CSV generation

**Verification:**
- Bulk notify enqueues multiple jobs
- Bulk resolve updates all selected
- CSV downloads with correct data
- Tests pass

### [x] Step: Notification Template Settings
<!-- chat-id: b2a3c9ec-237e-4d23-8e7e-7170f908b9a4 -->

Implement notification template customization.

**Tasks:**
- [x] Create `app/components/settings/NotificationSettings.tsx`:
  - Subject field (editable)
  - Body textarea (editable, must keep core variables)
  - Template variable reference
  - Preview with sample data
  - Save button
- [x] Add template validation (must contain {tracking_number}, {order_number})
- [x] Integrate into Settings page
- [x] Load/save from merchant.settings.notificationTemplate

**Verification:**
- Template customization saves correctly
- Preview renders with sample data
- Validation prevents removing required variables

---

## Phase 6: Billing, Onboarding & Settings

### [x] Step: Shopify Billing Integration
<!-- chat-id: 36c1db1e-74ca-410c-bb98-3605f06a5463 -->

Implement billing flow with Shopify Billing API.

**Tasks:**
- [x] Update `app/shopify.server.ts` with billing configuration from spec section 10.1
- [x] Create `app/services/billing.service.ts`:
  - Plan limit constants (spec section 10.2)
  - getCurrentUsage function (count shipments with hasCarrierScan=true in current billing cycle)
  - checkPlanLimit function
  - Feature gating checks (spec section 10.3)
- [x] Create `app/routes/api.billing.tsx` with actions:
  - selectPlan: creates Shopify subscription, returns confirmationUrl
  - confirmPlan: handles callback, activates plan
- [x] Implement plan limit enforcement:
  - In webhook handler: check limit before creating shipment
  - In carrier-poll worker: check on first scan
  - Show upgrade prompt when at limit
- [x] Write unit tests for billing logic

**Verification:**
- Plan selection redirects to Shopify approval
- Plan activated after approval
- Shipment counting works correctly
- Feature gating enforced

### [x] Step: Onboarding Wizard
<!-- chat-id: 3490aee5-f0b7-402d-aec6-f8ec8d93bcd3 -->

Implement four-step onboarding flow.

**Tasks:**
- [x] Create `app/routes/app.onboarding.tsx` with multi-step wizard
- [x] Create `app/components/onboarding/WelcomeStep.tsx`:
  - Value proposition
  - "Let's get you set up" CTA
- [x] Create `app/components/onboarding/PreferencesStep.tsx`:
  - Polling frequency preference
  - Delay threshold setting (default: 8 hours)
  - Timezone selection
  - Template preview
- [x] Create `app/components/onboarding/SyncStep.tsx`:
  - Progress indicator
  - Trigger fulfillment-sync job
  - Poll for completion
  - Show "Synced X shipments! Y are currently delayed."
- [x] Create `app/components/onboarding/TestModeStep.tsx`:
  - Option to add test shipment
  - Pre-loaded dummy data option
  - Skip to dashboard button
- [x] Set merchant.onboardingDone = true on completion
- [x] Redirect from dashboard if onboardingDone = false

**Verification:**
- Wizard flows through all steps
- Sync progress displayed
- Preferences saved
- Completes and reaches dashboard

### [x] Step: Settings Page
<!-- chat-id: f41aeb64-e2ec-40ad-8617-dd2bb0b77f8e -->

Implement full settings page with all sections.

**Tasks:**
- [x] Create `app/routes/app.settings.tsx` with sectioned layout
- [x] Create `app/components/settings/PollingSettings.tsx`:
  - Polling frequency preferences
  - Delay threshold (hours)
  - Default delivery windows table (editable)
- [x] Create `app/components/settings/DashboardPreferences.tsx`:
  - Column visibility toggles
  - Default sort order
  - Location filtering defaults
- [x] Reuse NotificationSettings from Phase 5
- [x] Create `app/components/settings/DisplaySettings.tsx`:
  - Timezone selection
  - Auto-archive days setting
- [x] Create `app/components/settings/AccountBilling.tsx`:
  - Current plan display
  - Usage meter (shipments this cycle vs limit)
  - Upgrade/downgrade buttons
  - Billing history (from Shopify)
- [x] All settings save to merchant.settings JSON
- [x] Write unit tests for settings validation

**Verification:**
- All settings sections render
- Changes save and persist
- Billing section shows correct info

### [x] Step: Edge Cases and App Lifecycle
<!-- chat-id: 800230fd-8dd3-4bf7-a92e-de47489c7e83 -->

Handle edge cases and app lifecycle events.

**Tasks:**
- [x] Handle store paused/frozen:
  - Check shop status in app.tsx loader
  - Show paused message if store frozen
  - Pause polling for frozen stores
- [x] Handle merchant downgrades:
  - Stop tracking new shipments immediately
  - Continue in-progress shipments
  - Show downgrade messaging
- [x] Implement test mode:
  - Add test shipment with real or fake tracking number
  - Pre-loaded dummy data
  - "Test Data" badge display
  - "Clear test data" function
- [x] Handle duplicate tracking numbers:
  - Detection in webhook handler
  - Warning display in dashboard
  - Merchant decision flow
- [x] Complete `webhooks.app.uninstalled.tsx`:
  - Mark merchant as uninstalled
  - Stop all polling
  - Schedule data purge job (30 days)
- [x] Write tests for edge cases

**Verification:**
- Paused stores handled gracefully
- Downgrades enforced correctly
- Test mode works
- Duplicates flagged
- Uninstall cleans up properly

---

## Phase 7: Testing and Polish

### [x] Step: Comprehensive Testing
<!-- chat-id: c33c4769-0bc6-4cc2-9008-3b3dfdf04471 -->

Add comprehensive test coverage.

**Tasks:**
- [x] Unit tests for all services (aim for >80% coverage on business logic)
- [x] Integration tests for:
  - Carrier adapters with sandbox/mock APIs
  - Webhook handlers with mocked authenticate.webhook
  - API routes with mocked Prisma
- [x] E2E test scenarios:
  - Install -> onboarding -> dashboard
  - Create fulfillment -> webhook -> shipment appears
  - Carrier poll -> delay detected -> notification sent -> resolved
- [x] Set up Vitest configuration
- [x] Add test scripts to package.json

**Verification:**
- [x] `npx vitest run` passes (588 tests)
- [x] Coverage report shows adequate coverage
- [x] All critical paths tested

### [x] Step: Code Quality and Documentation
<!-- chat-id: 08f6cfcb-da3a-45bc-8c32-0d423612a83c -->

Final code quality pass and documentation.

**Tasks:**
- [x] Run ESLint, fix all errors: `npx eslint . --fix`
- [x] Run type check: `npx tsc --noEmit`
- [x] Run Prisma validate: `npx prisma validate`
- [x] Review all TODO comments and resolve
- [x] Add inline documentation for complex functions
- [x] Create DEPLOYMENT.md with Railway setup instructions
- [x] Verify all environment variables documented in .env.example

**Verification:**
- [x] No lint errors
- [x] No type errors
- [x] All checks pass
- [x] Deployment guide complete
