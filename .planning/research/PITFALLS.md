# Domain Pitfalls

**Domain:** Shopify Embedded App (Remix Template)
**Researched:** 2026-02-04

## Critical Pitfalls

Mistakes that cause rewrites, production outages, or major issues.

### Pitfall 1: Using SQLite in Production with Multiple Instances
**What goes wrong:** The template defaults to SQLite for session storage. When you deploy multiple app instances (for redundancy or scaling), each instance has its own SQLite file. OAuth tokens and shop data become inconsistent across instances, causing merchants to be logged out randomly or unable to access the app.

**Why it happens:** The template README mentions SQLite "works in production if your app runs as a single instance," but developers miss this caveat and deploy to platforms that auto-scale (Railway, Heroku, etc.).

**Consequences:**
- Random authentication failures
- Merchants can't install or use the app reliably
- Duplicate data in different instances
- App rejected during Shopify review for reliability issues

**Prevention:**
- Switch to PostgreSQL (or another network-accessible database) IMMEDIATELY, even in development
- Update `prisma/schema.prisma` datasource to `postgresql`
- Use Railway's managed PostgreSQL service
- Test with multiple instances before production

**Detection:**
- Merchants report "app keeps asking me to log in"
- Session data appears/disappears randomly
- Error logs show "session not found" intermittently

---

### Pitfall 2: Not Returning 200 from Webhook Handlers Quickly
**What goes wrong:** Developers process webhook payloads synchronously (API calls, database writes, business logic) before returning a response. Shopify expects a 200 response within a few seconds. If the handler is slow, Shopify retries the webhook, causing duplicate processing.

**Why it happens:** Natural instinct is to "finish the work" before responding. Developers unfamiliar with async patterns don't realize webhooks should enqueue work, not execute it.

**Consequences:**
- Duplicate orders processed
- Customers notified multiple times
- Billing charged multiple times
- Shopify throttles or disables your webhooks for slow responses

**Prevention:**
- Always enqueue to BullMQ within webhook handler
- Return 200 response IMMEDIATELY (within 1-2 seconds)
- Process webhook payload in background worker
- Use idempotency keys to deduplicate jobs

**Detection:**
- Shopify webhooks dashboard shows retries
- Logs show same webhook ID processed multiple times
- Merchants report duplicate actions

---

### Pitfall 3: Storing Access Tokens in Job Payloads
**What goes wrong:** Developers pass Shopify access tokens in BullMQ job data to avoid database lookups in workers. Job data is stored in Redis (often without encryption at rest) and logged, exposing tokens.

**Why it happens:** Convenience; avoids fetching session from database in worker. Developers don't realize Redis stores job data persistently.

**Consequences:**
- Access tokens leaked in logs, Redis exports, error tracking tools
- Security vulnerability; tokens allow full Admin API access
- Shopify may revoke app if tokens are compromised
- GDPR violation (access tokens are personal data)

**Prevention:**
- Pass shop ID or session ID only in job data
- Workers fetch access token from PostgreSQL (via Prisma session storage)
- Encrypt Redis data at rest (Railway managed Redis supports this)
- Never log job payloads containing sensitive data

**Detection:**
- Security audit finds tokens in logs
- Redis data export reveals tokens
- Error tracking service (Sentry, etc.) exposes tokens

---

### Pitfall 4: Not Handling Session Token Authentication for Embedded Apps
**What goes wrong:** Developers test apps outside the Shopify Admin iframe (direct URL) and don't implement session token validation. App works in dev but fails when embedded in production because browsers block third-party cookies.

**Why it happens:** Testing in standalone mode is easier. Developers don't understand that embedded apps MUST use session tokens (JWTs from App Bridge), not cookies.

**Consequences:**
- App fails Shopify review (embedded apps requirement)
- Production app doesn't work in Admin iframe
- Merchants can't use app features

**Prevention:**
- Set `isEmbeddedApp: true` in `shopifyApp()` config
- Enable `future.unstable_newEmbeddedAuthStrategy: true` (uses Shopify managed install + token exchange)
- Always test inside Shopify Admin iframe (Shopify CLI provides this)
- Use `authenticate.admin(request)` which handles session tokens automatically

**Detection:**
- App works at direct URL but not in Admin
- Console errors: "Blocked third-party cookie"
- Shopify review rejection: "Not authenticating with session tokens"

---

### Pitfall 5: Ignoring Webhook Verification (HMAC)
**What goes wrong:** Developers skip HMAC verification for webhooks, assuming all POST requests to `/webhooks` are from Shopify. Attackers send fake webhook payloads to trigger unwanted actions.

**Why it happens:** HMAC verification seems like "extra work" and developers trust their firewall/network security.

**Consequences:**
- Security vulnerability; attackers can forge webhooks
- Fake orders, fraudulent refunds, data manipulation
- Shopify app suspension for security violations

**Prevention:**
- ALWAYS use `authenticate.webhook(request)` from `@shopify/shopify-app-remix`
- Never manually parse webhook bodies without HMAC check
- Template provides this out-of-box; don't remove it

**Detection:**
- Security audit finds unverified webhook routes
- Logs show suspicious webhook payloads
- Unexpected app behavior from forged webhooks

---

## Moderate Pitfalls

Mistakes that cause delays, technical debt, or customer frustration.

### Pitfall 6: Not Implementing GDPR Webhooks Before Public Launch
**What goes wrong:** Shopify requires all apps to handle GDPR webhooks (`customers/data_request`, `customers/redact`, `shop/redact`). Apps submitted without these handlers are rejected during review.

**Prevention:**
- Implement GDPR webhooks early (template provides stubs)
- `customers/data_request`: Return all customer data in JSON
- `customers/redact`: Delete customer data (or anonymize)
- `shop/redact`: Delete all shop data after 48 hours of uninstall
- Test with Shopify CLI: `shopify webhook trigger customers/data_request`

---

### Pitfall 7: Forgetting to Clean Up on App Uninstall
**What goes wrong:** Merchants uninstall app, but data remains in PostgreSQL. Database grows indefinitely with orphaned records. Merchants who reinstall see stale data.

**Prevention:**
- Hook into `app/uninstalled` webhook (template includes this)
- Delete shop record, sessions, orders, notifications
- Consider 48-hour grace period before deletion (allows reinstalls)
- Schedule cleanup job (BullMQ) instead of deleting synchronously

---

### Pitfall 8: Hardcoding API Versions
**What goes wrong:** Developers hardcode Shopify API version (e.g., `2024-01`) in GraphQL queries. When Shopify deprecates the version, app breaks.

**Prevention:**
- Use `process.env.SHOPIFY_API_VERSION` from shopify.server.ts config
- Let Shopify CLI manage API version via `shopify.app.toml`
- Test against stable and unstable API versions
- Subscribe to Shopify API changelog

---

### Pitfall 9: Not Paginating GraphQL Queries
**What goes wrong:** Apps with many shops or orders query GraphQL without pagination. Queries hit Shopify's GraphQL cost limit (1000 points) or timeout.

**Prevention:**
- Always use `first`/`after` pagination for lists
- Implement cursor-based pagination in UI
- Monitor GraphQL query costs (Shopify returns `extensions.cost`)
- Use Shopify's bulk operations API for large datasets

---

### Pitfall 10: Running Database Migrations on Startup in Multi-Instance Deployments
**What goes wrong:** Multiple app instances run `prisma migrate deploy` simultaneously on startup. Migrations conflict, leaving schema in inconsistent state.

**Prevention:**
- Run migrations in separate CI/CD step BEFORE deploying app instances
- Railway: Use `setup` script that runs once per deploy
- Use Prisma's migration locking (automatic in Prisma 4+)
- Never run `prisma migrate dev` in production (use `deploy`)

---

## Minor Pitfalls

Mistakes that cause annoyance but are fixable.

### Pitfall 11: Polaris Version Mismatch with Node Version
**What goes wrong:** Polaris v13 requires Node 20.10+, but developers use Node 18. App fails to build or has runtime errors.

**Prevention:**
- Check `package.json` engines field: `>=20.19 <22 || >=22.12`
- Use Node 20.19+ for Polaris v12 compatibility (template default)
- Upgrade to Node 20.10+ if using Polaris v13

---

### Pitfall 12: Not Handling GraphQL Errors
**What goes wrong:** Admin API returns errors (rate limit, invalid query, permission denied), but app assumes success. UI shows stale data or crashes.

**Prevention:**
- Always check `response.ok` and `data.errors` from Admin API
- Display Polaris error banners for failures
- Implement retry logic with exponential backoff
- Log errors to monitoring service (Sentry, LogRocket)

---

### Pitfall 13: Forgetting to Export `headers` from Routes
**What goes wrong:** Remix routes using `authenticate.admin()` don't export `headers` function. App works locally but fails in production with CSP errors.

**Prevention:**
- Always export `headers` in routes calling `authenticate.admin()`
- Use template pattern:
```typescript
export const headers = (headersArgs) => {
  return {
    'Content-Security-Policy': "frame-ancestors 'self' https://admin.shopify.com",
  };
};
```

---

### Pitfall 14: Not Testing with Real Shopify Stores
**What goes wrong:** Developers test only with development stores (fake data). Production stores have edge cases (null fields, legacy data formats) that break the app.

**Prevention:**
- Test with real Shopify stores (use your own or partners)
- Test with stores in different countries (localization issues)
- Test with Plus stores (different features, APIs)
- Use Shopify's GraphQL introspection to discover nullable fields

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| **Foundation & Setup** | Using SQLite in production | Switch to PostgreSQL immediately |
| **Authentication** | Not enabling session token auth | Set `isEmbeddedApp: true`, `future.unstable_newEmbeddedAuthStrategy: true` |
| **BullMQ Setup** | Storing secrets in job data | Pass shop ID only, fetch tokens in worker |
| **Webhook Handling** | Processing webhooks synchronously | Enqueue job, return 200 immediately |
| **Order Monitoring** | Not paginating order queries | Use GraphQL pagination, monitor query costs |
| **Notifications** | Email deliverability issues | Use reputable service (SendGrid), verify domain, SPF/DKIM |
| **Billing** | Not testing trial expiration | Manually advance system time, test grace periods |
| **Admin UI** | App Bridge version mismatch | Use unversioned CDN script tag (Shopify 2025-10 recommendation) |
| **Deployment** | Multiple instances running migrations | Run migrations in separate CI/CD step |

## Sources

- [Shopify App Remix Template Issues (GitHub)](https://github.com/Shopify/shopify-app-template-remix/issues)
- [Shopify Community Forums: Remix Authentication Issues](https://community.shopify.com/c/authentication-and-access/remix-oauth-authentication-flow/td-p/2259480)
- [Shopify GDPR Webhooks Requirements](https://shopify.dev/docs/apps/build/privacy-law-compliance)
- [Shopify Webhook Best Practices](https://shopify.dev/docs/apps/build/webhooks/subscribe/get-started)
- [BullMQ Security Best Practices](https://docs.bullmq.io/guide/architecture)
- [Prisma Connection Management](https://www.prisma.io/docs/guides/performance-and-optimization/connection-management)
- [Session Token Authentication](https://shopify.dev/docs/apps/build/authentication-authorization/session-tokens)
- Developer war stories from Shopify Remix app builders (Medium, blogs, GitHub discussions)
