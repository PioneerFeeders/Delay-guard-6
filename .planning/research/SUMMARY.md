# Research Summary: DelayGuard Shopify App

**Domain:** Shopify Embedded App (Remix Template)
**Researched:** 2026-02-04
**Overall confidence:** HIGH

## Executive Summary

The Shopify Remix app template provides a comprehensive, batteries-included foundation for building embedded Shopify apps. The template scaffolds a full-stack TypeScript application with authentication, database session management, GraphQL API integration, webhook handling, and UI components pre-configured. However, **Shopify has officially deprecated the Remix template in favor of React Router v7** as of late 2024, though the Remix template remains functional and widely used.

The template uses Prisma with SQLite by default for session storage, Vite for building, and provides built-in patterns for OAuth flows, API routes, and webhook subscriptions. For DelayGuard, the key architectural decision will be **adding BullMQ for background job processing** (order monitoring, delay detection) and **switching from SQLite to PostgreSQL** for production reliability on Railway.

The Shopify ecosystem has made significant shifts in 2025, including stabilizing Polaris web components and moving to unversioned CDN-based delivery of App Bridge and Polaris libraries. For new apps, Shopify recommends using framework-agnostic web components over React-specific Polaris components.

## Key Findings

**Stack:** Remix (or React Router v7) + Prisma + PostgreSQL + BullMQ + Railway deployment
**Architecture:** Monorepo with separate web server and background worker processes, shared Prisma client, Redis-backed job queue
**Critical pitfall:** Using SQLite in production with multiple instances will cause session conflicts; must use PostgreSQL or similar for session storage

## Implications for Roadmap

Based on research, suggested phase structure:

1. **Foundation & Setup** - Scaffold template, configure PostgreSQL, set up Railway project
   - Addresses: Project initialization, database setup, environment configuration
   - Avoids: SQLite production issues, delayed infrastructure decisions

2. **Authentication & Shop Management** - OAuth flow, shop model, basic session handling
   - Addresses: Table stakes authentication, shop data persistence
   - Avoids: Auth complexity later, session management issues

3. **BullMQ Infrastructure** - Add BullMQ, Redis, worker process, job registry
   - Addresses: Background job foundation for order monitoring
   - Avoids: Bolting on job system later, architectural mismatch

4. **Order Monitoring System** - Webhook subscriptions, order tracking, delay detection logic
   - Addresses: Core product functionality
   - Avoids: Building on unstable job infrastructure

5. **Notification System** - Email/in-app notifications via BullMQ jobs
   - Addresses: Customer-facing alerts
   - Avoids: Notification complexity before monitoring is stable

6. **Billing Integration** - Shopify Billing API, plan enforcement, trial period
   - Addresses: Revenue model, access control
   - Avoids: Building features before monetization path is clear

7. **Admin UI & Dashboard** - Polaris components, analytics, settings pages
   - Addresses: Merchant experience, app configuration
   - Avoids: UI churn from earlier architectural changes

**Phase ordering rationale:**
- Authentication must come first (required for all Shopify API calls)
- BullMQ infrastructure before order monitoring (monitoring depends on background jobs)
- Billing after core features (proves value before asking for payment)
- UI last (prevents rework from backend changes)

**Research flags for phases:**
- Phase 4 (Order Monitoring): Will need deeper research on Shopify Order API, webhook reliability patterns, and retry strategies
- Phase 5 (Notifications): Email delivery services (SendGrid, Postmark, etc.) need evaluation
- Phase 6 (Billing): Billing API edge cases (trial expiration, plan changes, cancellation flows) need investigation

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Official Shopify template well-documented, BullMQ patterns established |
| Features | MEDIUM | Order monitoring logic and delay detection need domain-specific research |
| Architecture | HIGH | Remix + BullMQ patterns verified across multiple sources, Railway deployment understood |
| Pitfalls | HIGH | SQLite production issues, webhook reliability, session token requirements documented |

## Gaps to Address

- **Shopify Order API specifics**: How to query orders efficiently, what fields are available for delay tracking, rate limiting considerations
- **Webhook reliability**: Best practices for handling missed webhooks, retry logic, webhook verification in production
- **Email delivery**: Which service integrates best with BullMQ, cost considerations for notification volume
- **DelayGuard domain logic**: What constitutes a "delay"? Carrier integration? Tracking number parsing?
- **React Router migration path**: When/if to migrate from Remix to React Router (currently optional but recommended for new apps)

## Migration Note: Remix → React Router

**Important:** Shopify officially recommends using `@shopify/shopify-app-react-router` for new projects as of late 2024. Remix and React Router have merged as of React Router v7. The Remix template remains functional but is in maintenance mode.

**Decision for DelayGuard:** Unless there's a compelling reason to use React Router, starting with the Remix template is acceptable for this project timeline (2026 Q1). The migration path is straightforward and can be deferred until the framework stabilizes further.
