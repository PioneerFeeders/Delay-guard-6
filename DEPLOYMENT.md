# DelayGuard - Railway Deployment Guide

This guide covers deploying DelayGuard to Railway with both web and worker services.

## Architecture Overview

DelayGuard requires three Railway services:
1. **Web Service** - Remix app serving the Shopify embedded app
2. **Worker Service** - BullMQ worker processing background jobs
3. **PostgreSQL** - Database for application data
4. **Redis** - Message queue for BullMQ jobs

## Prerequisites

- Railway account (https://railway.app)
- Shopify Partner account with app created
- Carrier API credentials (UPS, FedEx, USPS)
- Resend account for email notifications

## Step 1: Create Railway Project

1. Log in to Railway Dashboard
2. Click "New Project"
3. Select "Empty Project"
4. Name it "delayguard"

## Step 2: Add PostgreSQL

1. Click "New" in your project
2. Select "Database" → "PostgreSQL"
3. Railway will provision the database and provide `DATABASE_URL`

## Step 3: Add Redis

1. Click "New" in your project
2. Select "Database" → "Redis"
3. Railway will provision Redis and provide `REDIS_URL`

## Step 4: Deploy Web Service

1. Click "New" → "GitHub Repo"
2. Select your DelayGuard repository
3. Railway will detect the Dockerfile

### Configure Web Service Variables

Set the following environment variables:

```
# Shopify (from Shopify Partner Dashboard)
SHOPIFY_API_KEY=your_api_key
SHOPIFY_API_SECRET=your_api_secret
SHOPIFY_APP_URL=https://your-web-service.railway.app
SCOPES=read_orders,read_fulfillments,write_fulfillments,read_customers

# Database (auto-populated if you reference the PostgreSQL service)
DATABASE_URL=${{Postgres.DATABASE_URL}}

# Redis (auto-populated if you reference the Redis service)
REDIS_URL=${{Redis.REDIS_URL}}

# Carrier APIs
UPS_CLIENT_ID=your_ups_client_id
UPS_CLIENT_SECRET=your_ups_client_secret
FEDEX_CLIENT_ID=your_fedex_client_id
FEDEX_CLIENT_SECRET=your_fedex_client_secret
USPS_USER_ID=your_usps_user_id

# Email
RESEND_API_KEY=your_resend_api_key

# Environment
NODE_ENV=production
```

### Web Service Settings

- **Start Command**: (uses Dockerfile CMD by default)
- **Health Check Path**: `/healthz`
- **Port**: 3000

## Step 5: Deploy Worker Service

1. Click "New" → "GitHub Repo"
2. Select the same DelayGuard repository
3. **Important**: Override the start command

### Configure Worker Service

In the worker service settings:

- **Start Command**: `npm run worker`

### Worker Service Variables

Set the same environment variables as the web service:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
UPS_CLIENT_ID=your_ups_client_id
UPS_CLIENT_SECRET=your_ups_client_secret
FEDEX_CLIENT_ID=your_fedex_client_id
FEDEX_CLIENT_SECRET=your_fedex_client_secret
USPS_USER_ID=your_usps_user_id
RESEND_API_KEY=your_resend_api_key
NODE_ENV=production
```

Note: The worker doesn't need Shopify credentials as it operates on data already in the database.

## Step 6: Configure Shopify App

1. Go to Shopify Partners Dashboard
2. Select your app
3. Update App URL to your Railway web service URL
4. Update Allowed redirection URLs:
   - `https://your-web-service.railway.app/auth/callback`
   - `https://your-web-service.railway.app/auth/shopify/callback`
   - `https://your-web-service.railway.app/api/auth/callback`

## Step 7: Run Database Migrations

After the first deployment, run migrations:

```bash
# Using Railway CLI
railway run npx prisma migrate deploy
```

Or SSH into the web service and run:
```bash
npx prisma migrate deploy
```

## Health Checks

The web service exposes `/healthz` endpoint that checks:
- Database connectivity (PostgreSQL)
- Redis connectivity

Example response:
```json
{
  "status": "ok",
  "timestamp": "2026-02-05T12:00:00.000Z",
  "version": "1.0.0",
  "database": { "status": "ok" },
  "redis": { "status": "ok" }
}
```

## Scaling Considerations

### Web Service
- Railway automatically scales based on traffic
- For high traffic, enable auto-scaling in service settings

### Worker Service
- Single worker handles all queues with concurrency settings
- For high volume, deploy multiple worker instances
- Each worker processes jobs independently (BullMQ handles distribution)

### Database
- Railway PostgreSQL handles connection pooling
- For high load, consider upgrading to a dedicated instance

### Redis
- Monitor memory usage for job queues
- Configure job retention settings in `queue.server.ts`

## Monitoring

### Logs
- View logs in Railway Dashboard for each service
- Web service logs: HTTP requests, errors
- Worker service logs: Job processing, carrier API calls

### Metrics
- Railway provides basic CPU/memory metrics
- For detailed monitoring, integrate with external services

## Troubleshooting

### Common Issues

**OAuth fails with redirect error**
- Verify SHOPIFY_APP_URL matches your Railway domain
- Check redirect URLs in Shopify Partner Dashboard

**Worker not processing jobs**
- Verify REDIS_URL is correctly set
- Check worker logs for connection errors
- Ensure worker service is running

**Database connection errors**
- Verify DATABASE_URL is correctly set
- Check if migrations have been run
- Verify PostgreSQL service is healthy

**Health check failing**
- Check `/healthz` endpoint response
- Verify both database and Redis are accessible
- Check service logs for detailed errors

## Environment Variable Reference

| Variable | Required | Description |
|----------|----------|-------------|
| SHOPIFY_API_KEY | Yes | Shopify app API key |
| SHOPIFY_API_SECRET | Yes | Shopify app API secret |
| SHOPIFY_APP_URL | Yes | Public URL of web service |
| SCOPES | Yes | Shopify API scopes |
| DATABASE_URL | Yes | PostgreSQL connection string |
| REDIS_URL | Yes | Redis connection string |
| UPS_CLIENT_ID | Yes | UPS API client ID |
| UPS_CLIENT_SECRET | Yes | UPS API client secret |
| FEDEX_CLIENT_ID | Yes | FedEx API client ID |
| FEDEX_CLIENT_SECRET | Yes | FedEx API client secret |
| USPS_USER_ID | Yes | USPS API user ID |
| RESEND_API_KEY | Yes | Resend email API key |
| NODE_ENV | Yes | Set to "production" |
| SHOP_CUSTOM_DOMAIN | No | Custom shop domain (if applicable) |
