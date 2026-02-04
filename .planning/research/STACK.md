# Technology Stack

**Project:** DelayGuard
**Researched:** 2026-02-04

## Recommended Stack

### Core Framework
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Remix | ^2.16.1 | Full-stack web framework | Official Shopify template, file-based routing, built-in data loading patterns |
| @shopify/shopify-app-remix | ^4.1.0 | Shopify authentication & API | Handles OAuth, session tokens, Admin API integration, App Bridge setup |
| Node.js | >=20.19 <22 or >=22.12 | JavaScript runtime | Required by Shopify template, modern features, Prisma compatibility |
| TypeScript | ^5.2.2 | Type safety | Prevents runtime errors, better DX, required for Shopify API codegen |
| Vite | ^6.2.2 | Build tool & dev server | Fast HMR, optimized production builds, Remix v2 default |

### Database & ORM
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| PostgreSQL | 15+ | Primary database | Production-ready, multi-instance support, Railway managed hosting |
| Prisma | ^6.2.1 | ORM & migrations | Type-safe queries, migrations, official Shopify session storage adapter |
| @shopify/shopify-app-session-storage-prisma | ^8.0.0 | Session persistence | Official adapter, handles OAuth tokens, shop data |

### Background Jobs
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| BullMQ | ^5.x | Job queue & worker | Redis-backed, TypeScript-first, robust retry logic, job prioritization |
| Redis | 7+ | Queue backend & cache | BullMQ dependency, fast in-memory storage, Railway managed hosting |
| ioredis | ^5.x | Redis client | BullMQ dependency, cluster support, TypeScript types |

### UI Framework
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| @shopify/polaris | ^12.0.0 | UI component library | Official Shopify design system, merchant-familiar patterns, accessibility |
| @shopify/app-bridge-react | ^4.1.6 | Admin embedding | Required for embedded apps, navigation, modals, toasts |
| React | ^18.2.0 | UI rendering | Polaris dependency, Remix default, industry standard |

### Infrastructure
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Railway | N/A | Cloud hosting | Simple deployment, managed PostgreSQL & Redis, environment variables, affordable |
| Docker | N/A | Containerization | Railway support, reproducible builds, Shopify template includes Dockerfile |

### Supporting Libraries
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| isbot | ^5.1.0 | Bot detection | Included in template, prevents bot requests from triggering OAuth |
| @remix-run/serve | ^2.16.1 | Production server | Serves built Remix app in production |
| vite-tsconfig-paths | ^5.0.1 | Path mapping | Enables `~/` imports in TypeScript |
| graphql-codegen | Latest | GraphQL type generation | Generates TypeScript types from Shopify Admin API schema |

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Framework | Remix | React Router v7 | Shopify recommends React Router for NEW apps, but Remix template is more mature and migration path exists |
| Framework | Remix | Next.js | No official Shopify template, more complex to configure OAuth, App Bridge setup manual |
| Database | PostgreSQL | SQLite | Template default but NOT production-ready for multi-instance deployments, session conflicts |
| Database | PostgreSQL | MongoDB | Less mature Shopify session adapter, Prisma support more complex, SQL better for transactional data |
| Job Queue | BullMQ | Quirrel | Discontinued project, less community support |
| Job Queue | BullMQ | Graphile Worker | PostgreSQL-only (can't separate concerns), less TypeScript-friendly |
| Hosting | Railway | Heroku | More expensive, less modern DX, requires more manual configuration |
| Hosting | Railway | Vercel | Serverless conflicts with background workers, Redis/PostgreSQL add-ons less integrated |
| Hosting | Railway | Fly.io | More complex deployment, less managed services, steeper learning curve |

## Installation

### Initial Scaffold
```bash
# Create new Shopify app with Remix template
npx @shopify/create-app@latest

# Select "Remix" as framework when prompted
# App will be created with SQLite by default
```

### Core Dependencies (Already Included)
```bash
# These are included in the template
npm install @shopify/shopify-app-remix @shopify/polaris @shopify/app-bridge-react
npm install @prisma/client prisma
npm install react react-dom
```

### Add BullMQ & Redis
```bash
# Background job processing
npm install bullmq ioredis
npm install -D @types/ioredis
```

### Dev Dependencies (Already Included)
```bash
# These are included in the template
npm install -D @types/node @types/react @types/react-dom
npm install -D eslint prettier typescript
npm install -D @shopify/api-codegen-preset
```

### Switch to PostgreSQL

1. Update `prisma/schema.prisma`:
```prisma
datasource db {
  provider = "postgresql"  // Change from "sqlite"
  url      = env("DATABASE_URL")
}
```

2. Update environment variables:
```bash
# .env (local development)
DATABASE_URL="postgresql://user:password@localhost:5432/delayguard_dev"

# Railway (production) - auto-generated from Railway PostgreSQL service
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

3. Clean up old migrations and generate new ones:
```bash
rm -rf prisma/migrations
npx prisma migrate dev --name init
```

## Node Version Requirements

**Required:** Node.js >= 20.19 (< 22) OR >= 22.12

**Reason:**
- `@shopify/polaris` v12 requires Node 18+ (v13 requires Node 20.10+)
- Prisma 6.x requires Node 18+
- Remix 2.x requires Node 18+

**Recommended:** Node 20.19+ for best compatibility

## Environment Variables

| Variable | Required | Purpose | Example |
|----------|----------|---------|---------|
| `SHOPIFY_API_KEY` | Yes | App API key from Partners dashboard | `abc123...` |
| `SHOPIFY_API_SECRET` | Yes | App API secret from Partners dashboard | `shpss_xyz...` |
| `SHOPIFY_APP_URL` | Yes | Public URL of deployed app | `https://delayguard.railway.app` |
| `SCOPES` | Yes | Shopify API scopes | `read_orders,read_products` |
| `DATABASE_URL` | Yes | PostgreSQL connection string | `postgresql://...` |
| `REDIS_URL` | Yes | Redis connection string (for BullMQ) | `redis://...` |
| `NODE_ENV` | Yes | Environment mode | `production` |

## Sources

- [Shopify Remix App Template (GitHub)](https://github.com/Shopify/shopify-app-template-remix)
- [Shopify Remix Template package.json](https://github.com/Shopify/shopify-app-template-remix/blob/main/package.json)
- [@shopify/shopify-app-remix NPM](https://www.npmjs.com/package/@shopify/shopify-app-remix)
- [BullMQ Documentation](https://docs.bullmq.io/)
- [Railway Remix Deployment Guide](https://docs.railway.com/guides/remix)
- [Prisma for Shopify Guide](https://www.prisma.io/docs/guides/shopify)
- [Integrating BullMQ into Node Applications (Jacob Paris)](https://www.jacobparis.com/content/bullmq-integration-guide)

## Migration Note

**Shopify now recommends React Router v7** (`@shopify/shopify-app-react-router`) for new apps. Remix and React Router have merged. The Remix template works but is in maintenance mode.

**For DelayGuard:** Start with Remix (more mature ecosystem, established patterns). Migration to React Router can be deferred and is straightforward when needed.
