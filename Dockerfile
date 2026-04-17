FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application
COPY . .

# Create data directory for databases
RUN mkdir -p /data

# Build arguments
ARG NODE_ENV=production
ENV NODE_ENV=$NODE_ENV

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Run migrations and start application
CMD ["sh", "-c", "npm run migrate && node src/index.js"]
