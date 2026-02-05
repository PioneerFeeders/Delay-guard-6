FROM node:22-alpine

# Install curl for healthchecks
RUN apk add --no-cache curl

EXPOSE 3000
WORKDIR /app

ENV NODE_ENV=production

# Copy dependency files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci --omit=dev && npm cache clean --force

# Generate Prisma client
COPY prisma ./prisma
RUN npx prisma generate

# Copy application code
COPY . .

# Build the Remix app
RUN npm run build

# Run migrations and start the server
CMD ["npm", "run", "docker-start"]
