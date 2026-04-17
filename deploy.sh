#!/bin/bash

# Admiral Backend Deployment Script
# Usage: ./deploy.sh <environment>

ENVIRONMENT=${1:-production}
PROJECT_DIR="/opt/admiral-backend"
LOG_FILE="/var/log/admiral-deploy.log"

echo "🚀 Admiral Backend Deployment - $ENVIRONMENT" | tee $LOG_FILE

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Error handler
error_exit() {
  echo -e "${RED}❌ $1${NC}" | tee -a $LOG_FILE
  exit 1
}

success_msg() {
  echo -e "${GREEN}✅ $1${NC}" | tee -a $LOG_FILE
}

info_msg() {
  echo -e "${YELLOW}ℹ️  $1${NC}" | tee -a $LOG_FILE
}

# 1. Pre-deployment checks
info_msg "Running pre-deployment checks..."

if [ ! -f ".env" ]; then
  error_exit "Missing .env file. Copy .env.example and configure."
fi

if ! command -v node &> /dev/null; then
  error_exit "Node.js not found. Please install Node.js 18+"
fi

if ! command -v npm &> /dev/null; then
  error_exit "npm not found. Please install npm."
fi

success_msg "Pre-deployment checks passed"

# 2. Stop current service
info_msg "Stopping Admiral service..."
sudo systemctl stop admiral || true

# 3. Backup current database
info_msg "Backing up current database..."
BACKUP_DIR="/backups/admiral"
mkdir -p $BACKUP_DIR
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
if [ -f "admiral.db" ]; then
  cp admiral.db "$BACKUP_DIR/admiral-$TIMESTAMP.db"
  success_msg "Database backed up to $BACKUP_DIR/admiral-$TIMESTAMP.db"
fi

# 4. Update code
info_msg "Updating code from git..."
git pull origin main || error_exit "Git pull failed"
success_msg "Code updated"

# 5. Install dependencies
info_msg "Installing dependencies..."
npm ci --only=production || error_exit "npm install failed"
success_msg "Dependencies installed"

# 6. Run migrations
info_msg "Running database migrations..."
npm run migrate || error_exit "Database migration failed"
success_msg "Migrations completed"

# 7. Start service
info_msg "Starting Admiral service..."
sudo systemctl start admiral || error_exit "Failed to start service"
sleep 2

# 8. Health check
info_msg "Checking service health..."
HEALTH_CHECK=$(curl -s http://localhost:3001/health | grep -c "ok")
if [ $HEALTH_CHECK -eq 1 ]; then
  success_msg "Service is healthy"
else
  error_exit "Service health check failed"
fi

# 9. Summary
echo ""
echo "=========================================="
echo "✅ Deployment completed successfully!"
echo "=========================================="
echo "Environment: $ENVIRONMENT"
echo "Timestamp: $(date)"
echo "Service: Admiral Backend"
echo "Port: 3001"
echo "Database: admiral.db"
echo "Logs: $LOG_FILE"
echo "Backup: $BACKUP_DIR/admiral-$TIMESTAMP.db"
echo "=========================================="
