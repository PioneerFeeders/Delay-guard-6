FROM node:22-alpine

# Install curl for healthchecks
RUN apk add --no-cache curl

EXPOSE 3000
WORKDIR /app

ENV NODE_ENV=production

# Copy dependency files
COPY package.json package-lock.json* ./

# Install dependencies (including dev dependencies for tsx)
RUN npm ci && npm cache clean --force

# Generate Prisma client
COPY prisma ./prisma
RUN npx prisma generate

# Copy application code
COPY . .

# Build the Remix app
RUN npm run build

# Default command runs the web server
# Override with: CMD ["npm", "run", "worker"] for worker process
CMD ["npm", "run", "docker-start"]
