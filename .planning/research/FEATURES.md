# Feature Landscape

**Domain:** Shopify Embedded App (Order Delay Monitoring)
**Researched:** 2026-02-04

## Table Stakes

Features users expect from a Shopify embedded app. Missing = product feels incomplete or unprofessional.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **OAuth Installation Flow** | Shopify requirement for all apps | Low | Template provides out-of-box, `authenticate.admin()` handles redirects |
| **Session Management** | Apps must persist shop data and access tokens | Low | Template uses Prisma session storage adapter |
| **Embedded Admin UI** | Apps must render inside Shopify Admin iframe | Medium | App Bridge + Polaris required, template configures in `app.tsx` layout |
| **App Uninstall Webhook** | Clean up data when merchant uninstalls | Low | Template includes webhook handler, just add cleanup logic |
| **Settings Page** | Merchants expect to configure app behavior | Medium | Standard Polaris form components, persist to database |
| **GDPR Webhooks** | Required for apps in EU, must handle data requests | Medium | Shopify mandates: `customers/data_request`, `customers/redact`, `shop/redact` |
| **Error Handling & Logging** | Production apps must handle failures gracefully | Medium | Add error boundaries, structured logging (Winston, Pino) |
| **Mobile-Responsive UI** | Merchants use Shopify Admin on mobile | Low | Polaris components are responsive by default |

## Differentiators

Features that set DelayGuard apart. Not expected, but valued by target customers.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Real-Time Order Monitoring** | Continuous background checking for delays | High | Requires BullMQ workers, scheduled jobs, webhook listeners |
| **Carrier Integration** | Automatic tracking number parsing and carrier detection | High | May need external APIs (AfterShip, EasyPost), carrier-specific logic |
| **Smart Delay Detection** | ML/rules-based prediction of potential delays | Very High | Requires historical data analysis, delay pattern recognition |
| **Automated Customer Notifications** | Email/SMS alerts to customers about delays | Medium | BullMQ job + email service (SendGrid, Postmark), template integration |
| **Merchant Dashboard** | Visual analytics of delay trends, impact metrics | Medium | Polaris data visualization, aggregation queries, caching |
| **Custom Delay Rules** | Merchant-defined criteria for what counts as "delayed" | Medium | Settings UI + flexible backend logic (time thresholds, carrier exceptions) |
| **Proactive Delay Prevention** | Suggest actions before delays occur (split shipments, etc.) | Very High | Requires domain expertise, predictive analytics |
| **Multi-Channel Support** | Monitor orders from POS, online store, and other sales channels | Medium | Shopify API supports all channels, but UI/logic complexity increases |

## Anti-Features

Features to explicitly NOT build. Common mistakes in this domain or scope creep risks.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Custom Carrier Tracking** | Building your own tracking infrastructure is expensive, error-prone, and redundant | Use existing APIs (AfterShip, EasyPost, TrackingMore) or Shopify's built-in tracking |
| **In-App Messaging/Chat** | Adds complexity, maintenance burden, and diverts from core value prop | Let merchants use existing tools (email, Shopify Inbox), focus on delay detection |
| **Advanced Analytics/BI** | Building a full analytics platform is a separate product | Provide basic metrics; integrate with Shopify's built-in analytics or export to CSV |
| **Multi-Tenant Architecture (Early)** | Premature optimization; Shopify apps are inherently multi-tenant via shop scoping | Use shop-scoped queries, don't build complex tenant isolation until scale requires it |
| **SMS Notifications (MVP)** | SMS adds cost, compliance (TCPA, GDPR), and complexity | Start with email; add SMS post-MVP if customer demand exists |
| **Order Editing/Fulfillment** | Scope creep; merchants expect this in Shopify Admin, not third-party apps | Read-only order data; link to Shopify Admin for order management |
| **Custom Branding (for Merchants)** | White-labeling is complex and rarely needed for embedded apps | Use Polaris defaults; merchants expect Shopify-native look/feel |
| **Mobile Native App** | Embedded apps work on mobile web; native app is expensive to maintain | Ensure responsive design with Polaris; mobile web is sufficient |

## Feature Dependencies

```
                     ┌─────────────────────────┐
                     │   OAuth Installation    │
                     └───────────┬─────────────┘
                                 │
                     ┌───────────▼─────────────┐
                     │  Session Management     │
                     └───────────┬─────────────┘
                                 │
                ┌────────────────┼────────────────┐
                │                │                │
    ┌───────────▼─────┐  ┌──────▼──────┐  ┌──────▼──────────┐
    │ Webhook Handlers│  │  Settings   │  │  BullMQ Jobs    │
    └───────────┬─────┘  └──────┬──────┘  └──────┬──────────┘
                │                │                │
                └────────────────┼────────────────┘
                                 │
                     ┌───────────▼──────────────┐
                     │  Order Monitoring Logic  │
                     └───────────┬──────────────┘
                                 │
                ┌────────────────┼────────────────┐
                │                │                │
    ┌───────────▼─────┐  ┌──────▼──────┐  ┌──────▼──────────┐
    │ Delay Detection │  │  Dashboard  │  │  Notifications  │
    └─────────────────┘  └─────────────┘  └─────────────────┘
```

**Critical Path:**
1. OAuth → Session → Webhooks/Settings → Order Monitoring → Delay Detection → Notifications
2. BullMQ infrastructure must exist before Order Monitoring can function
3. Settings page should be built before Delay Detection (defines delay criteria)

**Parallel Tracks:**
- Dashboard can be built independently once order monitoring data exists
- GDPR webhooks can be built in parallel with core features (compliance requirement)

## MVP Recommendation

For MVP, prioritize table stakes + core differentiators. Defer advanced features to post-MVP.

### Phase 1: Foundation (Week 1-2)
1. OAuth installation flow (template provides)
2. Session management with PostgreSQL (template + configuration)
3. App uninstall webhook (template + cleanup logic)
4. Basic settings page (enable/disable monitoring)

### Phase 2: Monitoring Infrastructure (Week 3-4)
1. BullMQ + Redis setup
2. Order webhook subscriptions (`orders/create`, `orders/updated`, `orders/fulfilled`)
3. Background job for periodic order checking
4. Basic delay detection logic (time-based rules)

### Phase 3: Notifications (Week 5-6)
1. Email notification system (BullMQ job + SendGrid/Postmark)
2. Notification templates
3. Merchant notification preferences (settings page)

### Phase 4: Dashboard (Week 7-8)
1. Polaris data table for monitored orders
2. Delay status indicators
3. Basic metrics (% delayed, avg delay time)

### Defer to Post-MVP:
- **Carrier integration**: Start with manual tracking number input; add API integration after validating demand
- **Smart delay detection**: Use simple time thresholds first; ML/predictive features require historical data
- **SMS notifications**: Email-only for MVP; add SMS if customers request it
- **Advanced analytics**: Basic metrics only; full BI is separate product
- **GDPR webhooks**: Required for EU, but can be stubbed initially and fleshed out before public launch

## Feature Prioritization Framework

**Must-Have (Blocking MVP):**
- OAuth, session management, embedded UI, app uninstall webhook
- Order monitoring via webhooks + background jobs
- Basic delay detection (time-based)
- Email notifications

**Should-Have (High Value, Low Effort):**
- Settings page (delay thresholds, notification preferences)
- Dashboard with order list and delay status
- Basic metrics/analytics

**Nice-to-Have (Post-MVP):**
- Carrier integration
- Smart delay prediction
- SMS notifications
- Advanced analytics

**Won't-Have (Out of Scope):**
- Custom carrier tracking infrastructure
- In-app messaging
- Order editing/fulfillment
- Mobile native app

## Sources

- [Shopify App Requirements](https://shopify.dev/docs/apps/launch/app-requirements)
- [Shopify GDPR Webhooks](https://shopify.dev/docs/apps/build/privacy-law-compliance)
- [Shopify Embedded App Best Practices](https://shopify.dev/docs/apps/best-practices/embedded-apps)
- [BullMQ Use Cases](https://docs.bullmq.io/)
- Community insights from Shopify Developer Forums and GitHub issues
