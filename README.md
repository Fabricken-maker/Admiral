# Admiral Phase 2 Backend

Production-ready Node.js + Express backend for Admiral subscription management platform with full Fabricken CRM integration, Meta Ads API support, and deployment readiness.

## 🚀 Features

✅ **Authentication**
- User registration & login with JWT tokens
- Secure password hashing with bcryptjs
- Role-based access control

✅ **Meta Ads Integration**
- Connect Meta Ads accounts
- Sync campaigns from Meta API
- Manage campaign status, budgets, and objectives
- Real-time webhook processing for campaign updates

✅ **Fabricken CRM Sync**
- Automatic customer sync on registration
- Subscription change tracking
- CRM interaction logging
- Read-only connection to fabricken.db

✅ **Subscription Management**
- Tiered subscription plans
- Automatic billing cycle tracking
- Subscription status monitoring

✅ **Admin Dashboard**
- Platform statistics & metrics
- User management
- CRM sync monitoring
- System health checks

✅ **Webhook Processing**
- Meta Ads webhook verification
- Signature validation
- Campaign event processing
- Webhook logging and audit trail

✅ **Deployment Ready**
- Docker-compatible
- Netlify Functions support
- VPS deployment scripts
- GitHub Actions CI/CD ready

## 📋 Prerequisites

- Node.js 18+
- npm or yarn
- SQLite 3
- Access to Fabricken CRM database

## 🛠️ Installation

### 1. Clone & Install Dependencies

```bash
cd /root/.openclaw/workspace/admiral/backend
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your configuration:
```env
PORT=3001
JWT_SECRET=your-secure-random-string
META_APP_SECRET=your-meta-secret
WEBHOOK_VERIFY_TOKEN=your-webhook-token
FRONTEND_URL=https://your-domain.com
```

### 3. Initialize Database

```bash
npm run migrate
```

This creates the Admiral database with all required tables.

### 4. Start Development Server

```bash
npm run dev
```

Server starts on `http://localhost:3001`

## 📚 API Endpoints

### Authentication (`/auth`)

**POST /auth/register**
```json
{
  "email": "user@example.com",
  "password": "secure-password",
  "company_name": "Acme Corp",
  "first_name": "John",
  "last_name": "Doe",
  "phone": "+46701234567"
}
```

**POST /auth/login**
```json
{
  "email": "user@example.com",
  "password": "secure-password"
}
```

**GET /auth/profile** (requires token)

### Campaigns (`/api/campaigns`)

All endpoints require `Authorization: Bearer <token>` header.

**GET /api/campaigns**
List user's campaigns

**POST /api/campaigns/connect-meta**
```json
{
  "account_id": "123456789",
  "access_token": "your-meta-token",
  "account_name": "Primary Account"
}
```

**GET /api/campaigns/meta-accounts**
List connected Meta accounts

**POST /api/campaigns/sync-from-meta**
```json
{
  "meta_account_id": 1
}
```

**PUT /api/campaigns/:id**
```json
{
  "campaign_name": "Updated Name",
  "daily_budget": 100.00,
  "status": "ACTIVE"
}
```

**DELETE /api/campaigns/:id**

### Webhooks (`/api/webhook`)

**GET /api/webhook**
Webhook verification endpoint (Meta Ads)

**POST /api/webhook**
Receive Meta webhook events

**GET /api/webhook/logs**
View recent webhook logs

### Admin (`/api/admin`)

All endpoints require authenticated user.

**GET /api/admin/stats**
Platform statistics

**GET /api/admin/users**
List all users with pagination

**GET /api/admin/crm-sync**
View CRM sync logs

**POST /api/admin/retry-sync/:id**
Retry failed CRM sync

**GET /api/admin/health**
System health check

## 🗄️ Database Schema

### Users Table
```sql
- id (PK)
- email (UNIQUE)
- password (hashed)
- company_name
- first_name, last_name
- phone
- fabricken_customer_id (FK)
- subscription_status
- subscription_tier
- meta_ads_token
- created_at, updated_at
```

### Meta Ads Accounts
```sql
- id (PK)
- user_id (FK)
- account_id (UNIQUE)
- access_token (encrypted in production)
- account_name
- currency, timezone
- is_active
- connected_at
```

### Campaigns
```sql
- id (PK)
- user_id (FK)
- meta_campaign_id (UNIQUE)
- campaign_name
- status, budget, daily_budget
- currency, objective
- created_at, updated_at
```

### Subscriptions
```sql
- id (PK)
- user_id (FK)
- tier, price_monthly
- status
- billing_cycle_start, billing_cycle_end
- auto_renew
- created_at, updated_at
```

### CRM Sync Log
```sql
- id (PK)
- user_id (FK)
- action
- fabricken_customer_id
- payload (JSON)
- status (pending/success/failed)
- error_message
- created_at
```

### Webhook Logs
```sql
- id (PK)
- event_type
- user_id (FK, nullable)
- payload (JSON)
- processed (boolean)
- response
- created_at
```

## 🔄 CRM Integration

### Automatic Sync on Registration
When a user registers:
1. New user record created in Admiral database
2. Automatically synced to Fabricken CRM customers table
3. `fabricken_customer_id` stored for future reference
4. Viktor (Ekonomi-agent) notified via sessions_send

### Sync Log Tracking
All CRM operations logged in `crm_sync_log` table:
- Action type (register, subscribe, cancel, etc.)
- Payload (JSON)
- Status tracking (pending → success/failed)
- Error messages for debugging

### CRM Events
- **customer_registered**: New user signed up
- **subscription_changed**: Plan upgrade/downgrade
- **subscription_canceled**: User canceled subscription
- **subscription_renewed**: Billing cycle renewed

## 🌐 Frontend Files

### login.html
- Registration form
- Login form
- JWT token storage in localStorage
- Email validation
- Password strength indication

### dashboard.html
- Account overview
- Connected Meta Ads accounts
- Campaign management
- Sync operations
- Responsive design

## 🚀 Deployment

### Option 1: VPS Deployment

```bash
# Clone to VPS
git clone <repo> /opt/admiral-backend
cd /opt/admiral-backend
npm install
npm run migrate

# Create systemd service
sudo tee /etc/systemd/system/admiral.service > /dev/null <<EOF
[Unit]
Description=Admiral Backend
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/admiral-backend
ExecStart=/usr/bin/node src/index.js
Restart=always
Environment="NODE_ENV=production"
EnvironmentFile=/opt/admiral-backend/.env

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable admiral
sudo systemctl start admiral
```

### Option 2: Netlify Functions

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Configure netlify.toml
cat > netlify.toml <<EOF
[functions]
  directory = "netlify/functions"
  node_bundler = "esbuild"

[build]
  command = "npm run migrate && npm run build"
EOF

# Deploy
netlify deploy --prod
```

### Option 3: Docker

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

RUN npm run migrate

EXPOSE 3001
CMD ["node", "src/index.js"]
```

```bash
docker build -t admiral-backend .
docker run -p 3001:3001 \
  -e DB_PATH=/data/admiral.db \
  -e FABRICKEN_DB_PATH=/data/fabricken.db \
  -e JWT_SECRET=your-secret \
  -v /path/to/data:/data \
  admiral-backend
```

## 📊 Monitoring & Logging

### Health Check
```bash
curl http://localhost:3001/health
```

### Database Backups
```bash
# Automated backups in production
sqlite3 admiral.db ".backup '/backups/admiral-backup-$(date +%Y%m%d).db'"
```

### Log Files
- Application logs: stdout (configure with logger in production)
- Webhook logs: webhook_logs table
- CRM sync logs: crm_sync_log table
- Error logs: console.error() output

## 🔐 Security Considerations

✅ **Implemented**
- Password hashing with bcryptjs
- JWT token expiration (24h)
- CORS configuration
- Meta webhook signature verification
- Database readonly connection for CRM

⚠️ **Production Checklist**
- [ ] Change JWT_SECRET to secure random value
- [ ] Set META_APP_SECRET correctly
- [ ] Enable HTTPS/SSL
- [ ] Configure strong CORS origin
- [ ] Use environment variables for all secrets
- [ ] Set up rate limiting
- [ ] Enable database encryption at rest
- [ ] Implement audit logging
- [ ] Set up monitoring/alerting
- [ ] Regular database backups
- [ ] API key rotation schedule

## 🧪 Testing

```bash
# Run tests
npm test

# Test auth endpoints
curl -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "test123",
    "company_name": "Test Co"
  }'

# Test campaigns endpoint
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3001/api/campaigns
```

## 📞 Support

For issues or questions:
1. Check logs: `npm run dev` shows all requests
2. Review webhook logs: GET `/api/webhook/logs`
3. Check CRM sync status: GET `/api/admin/crm-sync`
4. Review database: `sqlite3 admiral.db ".schema"`

## 📝 Version History

**v2.0.0** (Current)
- Initial production release
- Full Meta Ads integration
- Fabricken CRM sync
- Admin dashboard
- Deployment ready

## License

Proprietary - Fabricken
