# Admiral Phase 2 Backend - Deployment Guide

Complete guide for deploying Admiral backend to production environments.

## 📋 Table of Contents

1. [Quick Start](#quick-start)
2. [VPS Deployment](#vps-deployment)
3. [Docker Deployment](#docker-deployment)
4. [Netlify Deployment](#netlify-deployment)
5. [GitHub Actions](#github-actions)
6. [Production Configuration](#production-configuration)
7. [Monitoring & Maintenance](#monitoring--maintenance)

## 🚀 Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env

# Initialize database
npm run migrate

# Start development server
npm run dev
```

Server runs on `http://localhost:3001`

## 🖥️ VPS Deployment

### Prerequisites

- Linux VPS (Ubuntu 20.04+)
- Node.js 18+
- npm or yarn
- sudo access
- Git

### Step 1: Server Setup

```bash
# SSH into VPS
ssh root@your.vps.ip

# Update system
apt update && apt upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt install -y nodejs npm

# Install SQLite3 (for database support)
apt install -y sqlite3

# Create application directory
mkdir -p /opt/admiral-backend
cd /opt/admiral-backend
```

### Step 2: Clone Repository

```bash
# Clone from GitHub
git clone https://github.com/your-org/admiral-backend.git .

# Or initialize git if local repo
git init
git remote add origin https://github.com/your-org/admiral-backend.git
git pull origin main
```

### Step 3: Configure Environment

```bash
# Copy environment template
cp .env.example .env

# Edit with production values
nano .env
```

Set these critical values:
```env
NODE_ENV=production
PORT=3001
JWT_SECRET=<generate-secure-random-string>
META_APP_SECRET=<your-meta-app-secret>
WEBHOOK_VERIFY_TOKEN=<your-webhook-token>
FRONTEND_URL=https://admiral.yourdomain.com
DB_PATH=/data/admiral.db
FABRICKEN_DB_PATH=/data/fabricken.db
```

Generate JWT secret:
```bash
openssl rand -base64 32
```

### Step 4: Install & Initialize

```bash
# Install dependencies
npm ci --only=production

# Copy Fabricken database
sudo mkdir -p /data
sudo cp /root/.openclaw/workspace/crm/fabricken.db /data/

# Run migrations
npm run migrate
```

### Step 5: Create Systemd Service

```bash
# Create service file
sudo nano /etc/systemd/system/admiral.service
```

Paste:
```ini
[Unit]
Description=Admiral Backend API
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/admiral-backend
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment="NODE_ENV=production"
EnvironmentFile=/opt/admiral-backend/.env

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable admiral
sudo systemctl start admiral

# Check status
sudo systemctl status admiral
```

### Step 6: Reverse Proxy (Nginx)

```bash
# Install Nginx
apt install -y nginx

# Create config
sudo nano /etc/nginx/sites-available/admiral
```

Paste:
```nginx
upstream admiral_backend {
    server localhost:3001;
}

server {
    listen 80;
    server_name admiral.yourdomain.com;

    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name admiral.yourdomain.com;

    # SSL certificates (use Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/admiral.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/admiral.yourdomain.com/privkey.pem;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    # Proxy settings
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Frontend
    location / {
        root /opt/admiral-backend/public;
        try_files $uri $uri/ /login.html;
    }

    # API
    location /auth {
        proxy_pass http://admiral_backend;
    }

    location /api {
        proxy_pass http://admiral_backend;
    }

    # Health check (internal only)
    location /health {
        proxy_pass http://admiral_backend;
        access_log off;
    }
}
```

Enable site:
```bash
sudo ln -s /etc/nginx/sites-available/admiral /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### Step 7: SSL Certificate (Let's Encrypt)

```bash
# Install certbot
apt install -y certbot python3-certbot-nginx

# Create certificate
sudo certbot certonly --standalone -d admiral.yourdomain.com

# Auto-renew
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer
```

### Step 8: Verify Deployment

```bash
# Check service status
sudo systemctl status admiral

# Check application
curl http://localhost:3001/health

# Check Nginx
curl https://admiral.yourdomain.com/health

# View logs
sudo journalctl -u admiral -f
```

## 🐳 Docker Deployment

### Build Docker Image

```bash
# Build image
docker build -t admiral-backend:latest .

# Tag for registry
docker tag admiral-backend:latest your-registry/admiral-backend:latest

# Push to registry
docker push your-registry/admiral-backend:latest
```

### Run Container

```bash
# Create data directory
mkdir -p /data/admiral

# Copy databases
cp /root/.openclaw/workspace/crm/fabricken.db /data/admiral/

# Run container
docker run -d \
  --name admiral \
  -p 3001:3001 \
  -e NODE_ENV=production \
  -e JWT_SECRET=<your-secret> \
  -e META_APP_SECRET=<your-secret> \
  -v /data/admiral:/data \
  your-registry/admiral-backend:latest
```

### Docker Compose

```bash
# Start stack
docker-compose up -d

# View logs
docker-compose logs -f admiral-backend

# Stop stack
docker-compose down
```

### Kubernetes Deployment (Optional)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: admiral-backend
spec:
  replicas: 2
  selector:
    matchLabels:
      app: admiral-backend
  template:
    metadata:
      labels:
        app: admiral-backend
    spec:
      containers:
      - name: admiral
        image: your-registry/admiral-backend:latest
        ports:
        - containerPort: 3001
        env:
        - name: NODE_ENV
          value: "production"
        - name: JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: admiral-secrets
              key: jwt-secret
        volumeMounts:
        - name: data
          mountPath: /data
        livenessProbe:
          httpGet:
            path: /health
            port: 3001
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3001
          initialDelaySeconds: 5
          periodSeconds: 5
      volumes:
      - name: data
        persistentVolumeClaim:
          claimName: admiral-data
---
apiVersion: v1
kind: Service
metadata:
  name: admiral-service
spec:
  selector:
    app: admiral-backend
  ports:
  - protocol: TCP
    port: 80
    targetPort: 3001
  type: LoadBalancer
```

## 🌐 Netlify Deployment

### Prerequisites
- Netlify account
- GitHub repository

### Step 1: Connect Repository

1. Go to netlify.com
2. Click "New site from Git"
3. Select GitHub and authorize
4. Choose admiral-backend repository

### Step 2: Configure Build

In Netlify dashboard:
- **Build command**: `npm run migrate && npm run build`
- **Publish directory**: `public`
- **Functions directory**: `netlify/functions`

### Step 3: Environment Variables

Set in Netlify dashboard:
```
JWT_SECRET=<your-secret>
META_APP_SECRET=<your-secret>
WEBHOOK_VERIFY_TOKEN=<your-token>
NODE_ENV=production
```

### Step 4: Deploy

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Login to Netlify
netlify login

# Deploy
netlify deploy --prod
```

## 🔄 GitHub Actions

### Setup

1. Add repository secrets in GitHub:
   - `VPS_HOST`: Your VPS IP/domain
   - `VPS_USER`: SSH user (e.g., root)
   - `VPS_SSH_KEY`: Private SSH key for deployment

2. Workflow runs on:
   - Push to `main` branch
   - Pull requests to `main`

### Manual Deployment

```bash
# Trigger deployment via GitHub CLI
gh workflow run deploy.yml --ref main
```

## ⚙️ Production Configuration

### Environment Variables

```env
# Security
NODE_ENV=production
JWT_SECRET=<32-character-minimum-secure-random-string>
JWT_EXPIRES_IN=24h

# Meta Ads API
META_APP_SECRET=<your-meta-app-secret>
META_API_VERSION=v19.0
WEBHOOK_VERIFY_TOKEN=<webhook-verify-token>

# Database
DB_PATH=/data/admiral.db
FABRICKEN_DB_PATH=/data/fabricken.db

# Frontend
FRONTEND_URL=https://admiral.yourdomain.com
CORS_ORIGIN=https://admiral.yourdomain.com

# API
PORT=3001
API_RATE_LIMIT=100

# Monitoring
LOG_LEVEL=info
SENTRY_DSN=https://your-sentry-dsn@sentry.io/123456
```

### Security Best Practices

```bash
# 1. File permissions
chmod 600 .env
chmod 755 src/ public/

# 2. Database permissions
chmod 600 /data/admiral.db
chown www-data:www-data /data/admiral.db

# 3. Update system regularly
apt update && apt upgrade -y

# 4. Firewall rules
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable

# 5. Automated backups
# Add to crontab:
# 0 2 * * * sqlite3 /data/admiral.db ".backup '/backups/admiral-$(date +\%Y\%m\%d).db'"
```

### Database Backups

```bash
# Manual backup
sqlite3 /data/admiral.db ".backup '/backups/admiral-$(date +%Y%m%d-%H%M%S).db'"

# Automated backup (cron)
# Add to /etc/cron.d/admiral-backup:
0 2 * * * root sqlite3 /data/admiral.db ".backup '/backups/admiral-\$(date +\%Y\%m\%d).db'" && find /backups -name "admiral-*.db" -mtime +30 -delete
```

## 📊 Monitoring & Maintenance

### Health Checks

```bash
# Application health
curl https://admiral.yourdomain.com/health

# Database health
curl -H "Authorization: Bearer <token>" \
  https://admiral.yourdomain.com/api/admin/health
```

### Logs

```bash
# Service logs
sudo journalctl -u admiral -f

# Last 100 lines
sudo journalctl -u admiral -n 100

# Errors only
sudo journalctl -u admiral -p err

# Nginx logs
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

### Monitoring Setup

Install monitoring tools:
```bash
# Prometheus & Grafana
docker run -d -p 9090:9090 prom/prometheus
docker run -d -p 3000:3000 grafana/grafana
```

### Troubleshooting

**Service won't start**
```bash
sudo systemctl status admiral
sudo journalctl -u admiral -n 50 -e
npm run migrate # Re-run migrations
```

**Database locked**
```bash
# Check for processes
lsof /data/admiral.db

# Restart service
sudo systemctl restart admiral
```

**High memory usage**
```bash
# Check process
ps aux | grep node

# Increase Node memory limit
NODE_OPTIONS=--max-old-space-size=2048 node src/index.js
```

**SSL certificate issues**
```bash
# Renew certificate
sudo certbot renew

# Check certificate
sudo certbot certificates
```

## 📞 Support & Updates

Check for updates:
```bash
npm outdated
npm update
npm audit fix
```

Keep backups:
```bash
# Daily backups to offsite storage
aws s3 cp /backups/admiral-latest.db s3://your-bucket/admiral-backups/
```

Version tracking:
```bash
git tag -a v2.0.0 -m "Production release"
git push origin v2.0.0
```

---

**Last Updated**: 2026-04-17
**Version**: 2.0.0
**Maintainer**: Sofia (Fabricken)
