# DelayGuard — Product Requirements Document (PRD)

**Version:** 1.0
**Date:** 2026-02-04
**Status:** Draft

---

## 1. Product Overview

**App Name:** DelayGuard
**Tagline:** Proactive shipment delay detection
**Platform:** Shopify App Store (Public, Embedded App)
**Target Users:** Shopify merchants who ship physical products, especially time-sensitive/perishable goods

DelayGuard monitors shipments for delivery delays and enables merchants to proactively notify customers before they ask "Where's my order?" The app polls carrier APIs, detects delays, displays an admin dashboard, and allows merchants to send notification emails to affected customers.

### Core Value Proposition

1. **Early Warning System** — Detect delays before customers complain
2. **Proactive Communication** — Send delay notifications to maintain customer trust
3. **Operational Visibility** — Dashboard showing all shipment statuses and delay metrics
4. **Reduced Support Tickets** — Fewer "where is my order?" inquiries

---

## 2. Technology Stack

| Component | Technology |
|-----------|------------|
| Framework | Shopify CLI with Remix (official template) |
| Language | TypeScript |
| Database | PostgreSQL |
| ORM | Prisma (included with Shopify Remix template) |
| Hosting | Railway |
| Background Jobs | BullMQ + Redis |
| Authentication | Shopify App Bridge (OAuth) |
| Billing | Shopify Billing API |
| Email Sending | Third-party transactional email service (e.g., Resend or SendGrid) |
| UI Components | Shopify Polaris (included with template) |

### App Type

- Embedded app within Shopify Admin (using App Bridge)
- Merchant accesses via Shopify Admin → Apps → DelayGuard

---

## 3. Functional Requirements

### 3.1 Shopify Integration

#### FR-SHOP-1: OAuth & Session Management
- App uses Shopify CLI's built-in OAuth flow
- On install, app requests scopes: `read_orders`, `read_fulfillments`, `write_fulfillments`, `read_customers`
- Session tokens stored securely; app uses Shopify session management from the Remix template

#### FR-SHOP-2: Webhook Subscriptions
- Subscribe to `fulfillments/create` — capture new shipments in real-time
- Subscribe to `fulfillments/update` — capture tracking info updates
- Subscribe to `app/uninstalled` — clean up merchant data (stop tracking, retain data 30 days, then purge)

#### FR-SHOP-3: Initial Sync
- On install, sync the last 5 days of fulfillments from Shopify
- Respect Shopify rate limits (40 req/min REST, GraphQL bucket)
- For high-volume merchants, throttle sync and show "sync in progress" indicator
- Extract per fulfillment: `tracking_number`, `tracking_company`, `created_at`, `order.name`, `order.email`, `order.phone`, `order.shipping_address`, `shipment_status`

#### FR-SHOP-4: Ongoing Data Capture
- Process `fulfillments/create` webhooks to add new shipments
- Process `fulfillments/update` webhooks to update tracking info
- Validate webhook signatures using Shopify's HMAC verification

---

### 3.2 Carrier Integration

#### FR-CARRIER-1: Supported Carriers (v1)
- UPS — Track API (OAuth 2.0)
- FedEx — Track API (OAuth 2.0, client credentials)
- USPS — Web Tools API (User ID auth)

**Not supported in v1:** International shipments, regional/local carriers, DHL, Amazon Logistics.

#### FR-CARRIER-2: Carrier Detection
- Primary: Use `tracking_company` field from Shopify fulfillment data
- Fallback auto-detect by tracking number format:
  - UPS: Starts with "1Z"
  - FedEx: 12-22 digits, often starts with "96" (Ground)
  - USPS: 20-22 digits, often starts with "94", "92", "93"
- If carrier cannot be determined, mark shipment as "Unknown carrier" for merchant review

#### FR-CARRIER-3: Carrier API Credentials
- App-level credentials: DelayGuard maintains a single set of API keys per carrier for all merchants
- Merchants do not need to provide their own carrier API credentials

#### FR-CARRIER-4: Data Retrieved from Carriers
For each tracking poll, retrieve and store:
- Expected delivery date
- Current status (in transit, out for delivery, delivered, exception, etc.)
- Exception flag and exception reason
- Last scan location and timestamp
- Rescheduled delivery date (if carrier provides one)

#### FR-CARRIER-5: Tracking Event History
- Store each tracking event as a separate record (tracking_events table)
- Events include: timestamp, event type, description, location (city/state/country), raw carrier data

---

### 3.3 Delay Detection

#### FR-DELAY-1: Delay Flagging Rules
A shipment is flagged as "delayed" when EITHER:
1. Carrier explicitly reports an exception status:
   - UPS: `status.type = "X"` (exception)
   - FedEx: `latestStatusDetail` indicates delivery exception
   - USPS: Status contains "Arriving Late"
2. Current date/time is more than **8 hours past** the expected delivery date (configurable grace period)

#### FR-DELAY-2: Default Delivery Windows
When carrier does not provide an expected delivery date, use service-level defaults:

| Service | Default Window |
|---------|----------------|
| UPS Next Day Air | 1 business day |
| UPS 2nd Day Air | 2 business days |
| UPS Ground | 5 business days |
| FedEx Express (Overnight) | 1 business day |
| FedEx Express (2Day) | 2 business days |
| FedEx Ground | 5 business days |
| USPS Priority Mail Express | 2 business days |
| USPS Priority Mail | 3 business days |
| USPS Ground Advantage | 7 business days |

Merchants can override these defaults in Settings.

#### FR-DELAY-3: Delay Metrics
- Calculate and store `days_delayed` (number of days past expected delivery)
- Record `delay_flagged_at` timestamp when delay is first detected

---

### 3.4 Polling Strategy

#### FR-POLL-1: Smart Scheduling
Poll intervals based on delivery proximity:

| Package Status | Poll Interval |
|----------------|---------------|
| Expected delivery today or tomorrow | Every 4 hours |
| Expected delivery 2-5 days out | Every 6 hours |
| Expected delivery 6+ days out | Every 8 hours |
| Past expected delivery (already late) | Every 2 hours |
| Past expected but carrier rescheduled to tomorrow+ | Every 4 hours |

#### FR-POLL-2: Thundering Herd Prevention
- Each merchant assigned a random offset (0-239 minutes) at install time
- Offset added to poll interval to distribute API calls
- Formula: `next_poll = last_poll + poll_interval + merchant_offset`

#### FR-POLL-3: Error Handling
- If carrier API call fails, queue for next cycle
- If fails 2 cycles in a row, show warning in merchant's dashboard
- Exponential backoff for rate limit errors (HTTP 429)

#### FR-POLL-4: Invalid/Unrecognized Tracking Numbers
- If carrier returns "tracking number not found" for a new shipment: mark as "Pending carrier pickup", continue polling 24-48 hours
- After 1 day with no scans, flag for merchant review
- Don't count toward shipment limits until first scan

#### FR-POLL-5: Shipment Lifecycle
- Track shipments only up to delivery confirmation
- Once delivered, stop polling and record `delivered_at` timestamp
- Auto-archive delivered shipments after configurable period (default: 30 days)

---

### 3.5 Dashboard

#### FR-DASH-1: Summary Cards
Display at top of dashboard:
- Total active shipments (count)
- Delayed shipments (count, with visual badge)
- Shipments delivered today (count)
- Average delivery time by carrier

#### FR-DASH-2: Tab Navigation
Tabs to filter shipment list:
- **All Shipments** — every non-archived shipment
- **Delayed** — shipments flagged as delayed
- **Pending Pickup** — shipments awaiting first carrier scan
- **Resolved** — delayed shipments that have been resolved
- **Delivered** — successfully delivered shipments

#### FR-DASH-3: Shipment List Table
Default columns (all customizable — show/hide, reorder):

| Column | Description |
|--------|-------------|
| Order # | Shopify order number (links to Shopify order) |
| Tracking # | Carrier tracking number (links to carrier tracking page) |
| Carrier | UPS / FedEx / USPS |
| Service Level | Ground, Priority, Next Day, etc. |
| Customer Name | Recipient name |
| Ship Date | When fulfillment was created |
| Expected Delivery | Estimated delivery date |
| Days Delayed | Days past expected, or "On Time" |
| Order Value | Order total amount |

#### FR-DASH-4: Filtering
Filter shipments by:
- Carrier (UPS, FedEx, USPS)
- Service level
- Delay status (delayed, on time, pending)
- Order value range
- Ship date range
- Fulfillment location (for multi-location merchants)

#### FR-DASH-5: Sorting
- Sort by any visible column, ascending or descending
- Default sort: Days Delayed, descending

#### FR-DASH-6: Bulk Actions
- Checkbox selection on each row (select all / select individual)
- "Send Notification to All Selected" button
- "Mark All Selected as Resolved" button
- "Export Selected" button

#### FR-DASH-7: Individual Row Actions
Each row provides:
- "Send Notification" button
- "Mark Resolved" button
- Expandable row or modal for "View Details"

#### FR-DASH-8: Shipment Detail View
Expandable row or modal showing:
- Full customer info (name, email, phone, address)
- Complete tracking history timeline (from tracking_events)
- Carrier status details (current status, exception info)
- Notification history (all notifications sent for this shipment)
- Resolution history (if resolved, reason and notes)
- Quick action buttons (Send Notification, Mark Resolved)

#### FR-DASH-9: CSV Export
- Export shipment data as CSV
- Export respects current tab, filters, and selection
- If specific rows selected, export only those; otherwise export all matching current filters
- Include all visible columns plus customer email

#### FR-DASH-10: Column Customization
- Merchants can show/hide columns via a column picker
- Merchants can reorder columns
- Preferences saved per-merchant in settings

---

### 3.6 Notification System

#### FR-NOTIF-1: Send Notification Flow
1. Merchant clicks "Send Notification" on a delayed shipment (individual or bulk)
2. Modal appears with pre-filled fields:
   - Recipient email (from customer data, editable)
   - Subject line (from template, editable)
   - Email body (from template with variables replaced, editable)
   - Preview of rendered email
3. Merchant can edit subject and body
4. Merchant clicks "Send"
5. Email sent via transactional email service
6. Success toast notification shown
7. Shipment marked as "Notified" in dashboard
8. Notification logged in `notifications_log` table

#### FR-NOTIF-2: Email Template
Default template:

**Subject:** `Update on your order #{order_number}`

**Body:**
```
Hi {customer_first_name},

We wanted to let you know that your recent order (#{order_number}) is experiencing a slight delay in transit.

Current Status: {carrier_status}
Carrier: {carrier_name}
Tracking Number: {tracking_number}
Track your package: {tracking_url}

We apologize for any inconvenience and are monitoring your shipment closely. If you have any questions, please don't hesitate to reach out.

Thank you for your patience!

{shop_name}
```

#### FR-NOTIF-3: Template Variables
Available variables for template customization:
- `{customer_first_name}`, `{customer_full_name}`
- `{order_number}`
- `{tracking_number}`, `{tracking_url}`
- `{carrier_name}`, `{carrier_status}`
- `{expected_delivery_date}`
- `{shop_name}`

#### FR-NOTIF-4: Template Customization
- Merchants can edit subject and body in Settings → Notifications
- Template must retain core variables (tracking_number, order_number minimum)
- Preview template with sample data before saving

#### FR-NOTIF-5: Email Sending
- Emails sent via a third-party transactional email service (Resend, SendGrid, or similar)
- App-level API key for the email service (merchants don't configure this)
- From address: configurable in settings, defaults to `noreply@delayguard.app` or merchant's shop email
- Track send status (sent/failed) in notifications_log

---

### 3.7 Resolution Workflow

#### FR-RESOLVE-1: Resolution Flow
1. Merchant clicks "Resolve" on a delayed shipment
2. Modal appears with:
   - **Required:** Resolution reason dropdown:
     - "Contacted customer - no action needed"
     - "Sent delay notification"
     - "Issued partial refund"
     - "Issued full refund"
     - "Reshipped order"
     - "Package delivered (false alarm)"
     - "Customer cancelled"
     - "Other"
   - **Optional:** Notes field (free text, 500 character max)
3. Merchant clicks "Mark Resolved"
4. Shipment moves to "Resolved" tab
5. Audit trail record created in `resolution_log` table

#### FR-RESOLVE-2: Bulk Resolution
- When resolving multiple shipments via bulk action, same modal appears
- Single reason and notes applied to all selected shipments
- Each shipment gets its own resolution_log entry

#### FR-RESOLVE-3: Audit Trail
- All resolutions recorded with: timestamp, who resolved (staff email), reason, notes, time delayed before resolution
- Resolution history visible in shipment detail view

---

### 3.8 Onboarding

#### FR-ONBOARD-1: Setup Wizard
Four-screen onboarding flow on first app load:

**Screen 1: Welcome**
- App name and value proposition
- "Let's get you set up" CTA button

**Screen 2: Preferences**
- Polling frequency preference (defaults or customize)
- Delay threshold (default: 8 hours)
- Timezone selection
- Notification email template preview

**Screen 3: Initial Sync**
- "Syncing your recent shipments..." with progress indicator
- Auto-sync last 5 days of fulfillments
- Summary: "Synced X shipments! Y are currently delayed."

**Screen 4: Test Mode Option**
- Option to add a test shipment with real or fake tracking number
- Pre-loaded dummy data available
- "Skip" option to go straight to dashboard

#### FR-ONBOARD-2: Test Mode
- Merchants can add test shipments with real or fake tracking numbers
- Pre-loaded dummy data available on first install
- Test data clearly labeled with "Test Data" badge
- "Clear test data" button available

---

### 3.9 Settings

#### FR-SETTINGS-1: Polling & Detection Settings
- Polling frequency preference (use defaults or customize intervals)
- Delay threshold: hours after expected delivery to flag as delayed (default: 8)
- Default service-level delivery windows (editable table of carrier/service → days)

#### FR-SETTINGS-2: Dashboard Preferences
- Column visibility toggles
- Default sort order selection
- Fulfillment location filtering defaults

#### FR-SETTINGS-3: Notification Settings
- Email notification template customization (subject + body)
- Template preview with sample data
- From email address configuration

#### FR-SETTINGS-4: Display Settings
- Timezone selection
- Auto-archive delivered shipments after X days (default: 30)

#### FR-SETTINGS-5: Account & Billing
- Current plan display
- Usage: shipments tracked this billing cycle vs. plan limit
- Upgrade/downgrade options
- Billing history (from Shopify Billing API)

---

### 3.10 Billing

#### FR-BILL-1: Plan Structure

| Plan | Price | Shipments/Month | Features |
|------|-------|-----------------|----------|
| Starter | $9.99/mo | 100 | Basic dashboard, manual notifications, single carrier display |
| Professional | $29.99/mo | 500 | Multi-carrier, filtering, bulk actions, CSV export |
| Business | $79.99/mo | 2,000 | All features, priority polling, analytics |
| Enterprise | $149.99/mo | Unlimited | All features, API access, custom integrations |

#### FR-BILL-2: Shipment Counting
- A shipment counts toward the plan limit when it receives at least one tracking update from the carrier
- Shipments that never get picked up (no scans) don't count
- Count resets each billing cycle

#### FR-BILL-3: Plan Limit Enforcement
- Hard stop: when merchant exceeds plan limit, stop tracking new shipments
- Existing in-progress shipments continue being tracked until delivered
- Merchant sees upgrade prompt in dashboard
- Clear messaging: "You've reached your plan limit. Upgrade to continue tracking new shipments."

#### FR-BILL-4: No Free Trial
- No free trial offered
- Starter plan at $9.99/mo is the entry point

#### FR-BILL-5: Billing Integration
- All billing via Shopify Billing API (recurring monthly charges)
- Flow: merchant selects plan → app creates subscription via GraphQL → redirect to Shopify confirmation → merchant approves → redirect back → app activates plan

---

### 3.11 Multi-Location Support

#### FR-LOC-1: Location Awareness
- Capture `fulfillment_location_id` and `fulfillment_location_name` from Shopify fulfillments
- Dashboard filtering by fulfillment location
- Grouping shipments by location in dashboard view

---

## 4. Non-Functional Requirements

### NFR-1: Performance
- Dashboard page load under 2 seconds for merchants with up to 2,000 active shipments
- Background polling jobs must not block the web server
- Database queries on shipments table must use appropriate indexes (merchant_id, is_delayed, carrier, ship_date, expected_delivery_date)

### NFR-2: Reliability
- Webhook processing must be idempotent (duplicate webhooks handled gracefully)
- Background jobs must be resilient to failures (retry with backoff)
- Carrier API failures must not crash the polling system

### NFR-3: Security
- Shopify webhook HMAC signature verification on all incoming webhooks
- Access tokens encrypted at rest in database
- No carrier API credentials exposed to merchants
- Session management via Shopify's built-in mechanisms
- Input sanitization on all user-editable fields (notification templates, resolution notes)

### NFR-4: Data Retention
- On merchant uninstall: stop all tracking immediately, retain data 30 days, purge after
- Delivered shipments auto-archived after configurable period (default: 30 days)
- Archived shipments remain in database for reporting/export

### NFR-5: Scalability
- Polling system must handle multiple merchants concurrently via BullMQ
- Database schema must support efficient queries across large shipment volumes
- Staggered polling prevents thundering herd on carrier APIs

### NFR-6: Shopify App Store Compliance
- App must be embedded (App Bridge)
- Must use Shopify Billing API for payments
- Must handle `app/uninstalled` webhook
- Must use Polaris design system for UI

---

## 5. Data Model

### 5.1 merchants
| Field | Type | Description |
|-------|------|-------------|
| id | PK (UUID) | Primary key |
| shopify_shop_id | string (unique) | Shopify shop identifier |
| shopify_access_token | string (encrypted) | OAuth access token |
| shop_domain | string | e.g., "my-shop.myshopify.com" |
| email | string | Shop owner email |
| timezone | string | e.g., "America/New_York" |
| settings | JSON | Merchant preferences (delivery windows, thresholds, column prefs, etc.) |
| plan_tier | enum | starter, professional, business, enterprise |
| billing_status | enum | active, pending, cancelled |
| random_poll_offset | integer | 0-239, minutes offset for polling stagger |
| installed_at | timestamp | When app was installed |
| created_at | timestamp | Record creation |
| updated_at | timestamp | Last update |

### 5.2 shipments
| Field | Type | Description |
|-------|------|-------------|
| id | PK (UUID) | Primary key |
| merchant_id | FK → merchants | Owner merchant |
| shopify_order_id | string | Shopify order ID |
| shopify_fulfillment_id | string (unique per merchant) | Shopify fulfillment ID |
| order_number | string | Display order number (e.g., "#1001") |
| tracking_number | string | Carrier tracking number |
| carrier | enum | ups, fedex, usps, unknown |
| service_level | string | e.g., "Ground", "Priority Mail" |
| customer_name | string | Recipient name |
| customer_email | string | Recipient email |
| customer_phone | string (nullable) | Recipient phone |
| shipping_address | JSON | Full destination address |
| ship_date | timestamp | Fulfillment creation date |
| expected_delivery_date | date (nullable) | Estimated delivery |
| expected_delivery_source | enum | carrier, default, merchant_override |
| current_status | string | Current carrier status description |
| is_delayed | boolean | Whether shipment is flagged delayed |
| delay_flagged_at | timestamp (nullable) | When delay was first detected |
| days_delayed | integer | Days past expected delivery |
| last_carrier_status | string | Raw carrier status string |
| last_scan_location | string (nullable) | Last known location |
| last_scan_time | timestamp (nullable) | Last scan timestamp |
| carrier_exception_code | string (nullable) | Carrier exception code |
| carrier_exception_reason | string (nullable) | Carrier exception description |
| rescheduled_delivery_date | date (nullable) | New ETA if carrier rescheduled |
| fulfillment_location_id | string (nullable) | Shopify location ID |
| fulfillment_location_name | string (nullable) | Location display name |
| order_value | decimal (nullable) | Order total |
| is_resolved | boolean | Whether delay has been resolved |
| resolved_at | timestamp (nullable) | When resolved |
| resolved_by | string (nullable) | Who resolved (staff email) |
| resolution_reason | string (nullable) | Resolution reason |
| resolution_notes | string (nullable) | Free-text notes (500 char max) |
| notification_sent | boolean | Whether notification was sent |
| notification_sent_at | timestamp (nullable) | When last notification sent |
| is_delivered | boolean | Whether package was delivered |
| delivered_at | timestamp (nullable) | Delivery timestamp |
| is_archived | boolean | Whether shipment is archived |
| last_polled_at | timestamp (nullable) | Last carrier API poll |
| next_poll_at | timestamp (nullable) | Next scheduled poll |
| poll_error_count | integer | Consecutive poll failures |
| created_at | timestamp | Record creation |
| updated_at | timestamp | Last update |

### 5.3 tracking_events
| Field | Type | Description |
|-------|------|-------------|
| id | PK (UUID) | Primary key |
| shipment_id | FK → shipments | Parent shipment |
| event_timestamp | timestamp | When event occurred |
| event_type | string | Event classification |
| event_description | string | Human-readable description |
| location_city | string (nullable) | City |
| location_state | string (nullable) | State/province |
| location_country | string (nullable) | Country |
| raw_carrier_data | JSON | Full carrier response for this event |
| created_at | timestamp | Record creation |

### 5.4 notifications_log
| Field | Type | Description |
|-------|------|-------------|
| id | PK (UUID) | Primary key |
| shipment_id | FK → shipments | Related shipment |
| merchant_id | FK → merchants | Sending merchant |
| sent_at | timestamp | When email was sent |
| sent_by | string | Staff email who triggered send |
| recipient_email | string | Customer email |
| email_subject | string | Subject line used |
| email_body_preview | text | First ~500 chars of body |
| status | enum | sent, failed |
| created_at | timestamp | Record creation |

### 5.5 resolution_log
| Field | Type | Description |
|-------|------|-------------|
| id | PK (UUID) | Primary key |
| shipment_id | FK → shipments | Related shipment |
| resolved_at | timestamp | When resolved |
| resolved_by | string | Staff email |
| resolution_reason | enum | See FR-RESOLVE-1 for values |
| notes | text (nullable) | Free text, 500 char max |
| time_delayed_before_resolution | interval | How long shipment was delayed before resolution |
| created_at | timestamp | Record creation |

---

## 6. Edge Cases & Special Handling

### EC-1: Store Paused/Frozen
- If Shopify store is paused: pause all tracking immediately
- Resume when store is reactivated

### EC-2: Merchant Downgrades
- Stop tracking new shipments immediately upon downgrade
- In-progress shipments under old limit continue tracking
- Show clear messaging about reduced capacity

### EC-3: Duplicate Tracking Numbers
- Flag duplicates for merchant review
- Show warning: "This tracking number already exists for Order #X"
- Let merchant decide to keep or remove duplicate

### EC-4: Shipments Never Picked Up
- After 1 day of "Pending carrier pickup" with no scans: flag for merchant review
- Merchant can manually archive or remove
- Don't count toward shipment limits until first scan

### EC-5: Invalid Tracking Numbers
- If carrier returns "not found" for new shipment: mark "Pending carrier pickup"
- Continue polling 24-48 hours
- After 1 day with no scans, flag for merchant review

### EC-6: Carrier API Outages
- If API call fails, queue for next cycle
- If fails 2 cycles in a row, show warning in dashboard
- Exponential backoff for rate limit errors (429)

---

## 7. Assumptions & Decisions

1. **Email sending:** Uses a third-party transactional email service (e.g., Resend) since Shopify does not provide a general-purpose transactional email API for custom app notifications. App-level API key; merchants do not configure email credentials.

2. **Carrier API credentials:** App-level credentials maintained by DelayGuard for all carriers. Merchants do not need to register for or provide their own carrier API keys.

3. **CSV export:** Respects current tab selection, active filters, and row selection. If specific rows are selected, exports only those; otherwise exports all rows matching current view.

4. **v1 Analytics:** Limited to summary cards on the main dashboard (total active, delayed count, delivered today, average delivery time by carrier). Trend charts and detailed analytics are deferred to v2.

5. **Starter plan feature gating:** Starter plan shows all carriers but limits filtering, bulk actions, and CSV export to Professional+ plans. All plans get manual individual notifications.

6. **Database:** Using Prisma ORM (included with Shopify Remix template) with PostgreSQL.

---

## 8. Out of Scope (v1)

- Automatic delay notifications (no human intervention)
- Email digest notifications to merchants
- International shipment tracking
- Refund/chargeback correlation
- DHL, Amazon Logistics, or regional carriers
- Carrier webhook integration (push-based tracking updates)
- Mobile-specific app (embedded app works in Shopify mobile admin)
- Trend analytics and historical reporting dashboards
- API access for Enterprise plan (documented but not built in v1)
- Custom integrations for Enterprise plan

---

## 9. Success Criteria

### Product Metrics
- Delay detection accuracy: correctly flag ≥90% of actually delayed shipments
- Dashboard loads in <2 seconds for typical merchant volume
- Notification emails delivered with >95% success rate
- All carrier APIs polled within scheduled intervals ±15 minutes

### Business Metrics (Year 1 Targets)
- 100-300 paying merchants
- $3,000-$12,000 MRR
- 4.5+ star App Store rating
- <24 hour support response time
