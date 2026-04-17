# Admiral Phase 2 Backend - Quick Start

**Get Admiral running in 5 minutes** ⚡

## 1️⃣ Install & Configure

```bash
cd /root/.openclaw/workspace/admiral/backend

# Install dependencies
npm install

# Copy configuration template
cp .env.example .env

# Edit with your values (minimal required)
nano .env
```

**Minimal .env values:**
```env
NODE_ENV=development
JWT_SECRET=temporary-dev-secret-change-in-production
META_APP_SECRET=your-meta-app-secret-here
WEBHOOK_VERIFY_TOKEN=your-webhook-token-here
```

## 2️⃣ Initialize Database

```bash
npm run migrate
```

This creates `admiral.db` with all tables needed.

## 3️⃣ Start Development Server

```bash
npm run dev
```

You'll see:
```
🚀 Admiral Backend running on port 3001
📊 Health check: http://localhost:3001/health
🔐 Auth: http://localhost:3001/auth
```

## 4️⃣ Test It Works

**Open in browser:**
```
http://localhost:3001
```

You should see the Admiral login page.

**Or test via curl:**
```bash
# Health check
curl http://localhost:3001/health

# Result: {"status":"ok","timestamp":"2026-04-17T..."}
```

## 5️⃣ Create Your First Account

**Via frontend:** Click "Register" on http://localhost:3001

**Via curl:**
```bash
curl -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "you@fabricken.se",
    "password": "secure-password",
    "company_name": "Fabricken",
    "first_name": "Erik",
    "last_name": "Ågerup",
    "phone": "+46701234567"
  }'
```

**Response includes JWT token:**
```json
{
  "message": "User registered successfully",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "email": "you@fabricken.se",
    "company_name": "Fabricken",
    "subscription_tier": "starter"
  }
}
```

## 🔑 Login & Access Dashboard

1. **Copy your token** from registration response (or login)
2. **Open dashboard:** http://localhost:3001/dashboard.html
3. Token auto-stored in localStorage
4. Dashboard loads your account info

## 🔗 Connect Meta Ads

1. In dashboard, click "Connect Meta Ads Account"
2. Get your Meta Ads credentials:
   - **Account ID**: From your Meta Business Account
   - **Access Token**: Create via Meta App Dashboard
3. Connect account
4. Click "Sync from Meta" to pull your campaigns

## 📊 Check Admin Panel

```bash
# Get platform stats
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3001/api/admin/stats

# View users
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3001/api/admin/users

# Check CRM sync
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3001/api/admin/crm-sync
```

## 🛑 Stop & Restart

```bash
# Ctrl+C in terminal (if running in foreground)

# Or stop the process
killall node

# Restart
npm run dev
```

## 📂 Project Structure

```
admiral/backend/
├── src/
│   ├── index.js          ← Main server
│   ├── routes/           ← API endpoints
│   └── utils/            ← Database & CRM sync
├── public/
│   ├── login.html        ← Registration & login
│   └── dashboard.html    ← Admin interface
├── admiral.db            ← SQLite database (created on migrate)
├── .env                  ← Configuration (you created this)
├── package.json          ← Dependencies
└── README.md            ← Full documentation
```

## 🐛 Troubleshooting

**Error: Cannot find module 'express'**
```bash
npm install
```

**Error: Database locked**
```bash
rm admiral.db
npm run migrate
```

**Error: Port 3001 already in use**
```bash
# Change PORT in .env
PORT=3002

# Or kill process using 3001
lsof -i :3001  # Find process
kill -9 <PID>  # Kill it
```

**Error: Cannot connect to Meta API**
- Verify META_APP_SECRET in .env
- Check Meta access token format
- Review API logs: `GET /api/webhook/logs`

## 🚀 Going to Production

When ready to deploy:

1. **Read** `DEPLOYMENT.md` (complete guide)
2. **Choose platform:**
   - VPS: Follow "VPS Deployment" section
   - Docker: Run `docker-compose up -d`
   - Netlify: Push to GitHub, connect to Netlify

3. **Security checklist:**
   - Generate strong JWT_SECRET: `openssl rand -base64 32`
   - Set production domain in FRONTEND_URL
   - Enable HTTPS (Let's Encrypt included)
   - Configure backups

## 📚 Next Steps

- **Full API docs:** See `README.md`
- **Deployment guide:** See `DEPLOYMENT.md`
- **Project details:** See `PROJECT-SUMMARY.md`

## 💬 Quick Commands Reference

```bash
# Development
npm run dev                    # Start dev server
npm run migrate               # Initialize database
npm test                      # Run tests

# Production
NODE_ENV=production npm start  # Start production server

# Database
sqlite3 admiral.db            # Open SQLite CLI
sqlite3 admiral.db ".tables"  # List tables
sqlite3 admiral.db ".schema"  # Show schema

# API Testing
curl http://localhost:3001/health
curl http://localhost:3001/auth/login -X POST -H "Content-Type: application/json" -d '{"email":"user@example.com","password":"pass"}'

# Logs
npm run dev 2>&1 | tee admiral.log  # Log to file
tail -f admiral.log                  # Watch log
```

---

**Status:** ✅ Ready to use  
**Time to first request:** ~5 minutes  
**Support:** Check README.md or DEPLOYMENT.md

🎉 **You're ready!** Start with step 1 above.
