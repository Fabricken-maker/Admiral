# Supabase Integration - Step by Step

**Time:** ~30 minutes total  
**Status:** Two new serverless functions ready (`auth-register-supabase.js` + `auth-login-supabase.js`)

---

## STEP 1: Create Supabase Project (10 min)

### 1.1 Go to Supabase
- https://supabase.com
- Click "Start your project"
- Sign up or login

### 1.2 Create New Project
- Organization: Choose or create
- Project name: `admiral-db`
- Database password: Generate strong password (save it!)
- Region: **Frankfurt** (closest to Sweden)
- Click "Create new project"

**⏳ Wait 2-5 minutes for project to initialize...**

### 1.3 Get Credentials
Once project is ready:
1. Go to **Settings** (⚙️) → **API**
2. Under "Project API keys", copy:
   - **Project URL** → `SUPABASE_URL`
   - **anon public** → `SUPABASE_ANON_KEY` (not needed for now)
   - **service_role secret** → `SUPABASE_SERVICE_KEY` ⚠️ (keep secret!)

---

## STEP 2: Create Database Tables (5 min)

### 2.1 Open SQL Editor
1. In Supabase dashboard, go to **SQL Editor** (left sidebar)
2. Click "New query"

### 2.2 Run This SQL

Copy-paste entire block and click "Run":

```sql
-- Users table
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  company_name TEXT,
  subscription_tier TEXT DEFAULT 'starter',
  subscription_status TEXT DEFAULT 'active',
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- Index for fast email lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Campaigns table (for future use)
CREATE TABLE IF NOT EXISTS campaigns (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  campaign_name TEXT,
  meta_campaign_id TEXT,
  spend DECIMAL(10,2),
  cpm DECIMAL(8,2),
  conversion_rate DECIMAL(5,2),
  roi DECIMAL(8,2),
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);
```

✅ You should see "Query OK" at bottom

---

## STEP 3: Set Environment Variables in Netlify (3 min)

### 3.1 Go to Netlify
- https://app.netlify.com
- Select "admiralen" site
- Go to **Site Settings** → **Build & deploy** → **Environment**

### 3.2 Add Variables
Click "Edit variables" and add:

```
SUPABASE_URL = https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY = eyJh... (the service_role key)
JWT_SECRET = (generate with: openssl rand -base64 32)
```

⚠️ **Important:**
- `SUPABASE_SERVICE_KEY` = secret! Never expose!
- `JWT_SECRET` = generate new random string (not "test-secret")

### 3.3 Save and Deploy
Click "Deploy site" to apply new env vars

---

## STEP 4: Swap Auth Functions (5 min)

### 4.1 Delete Old Functions

SSH into VPS or use terminal:

```bash
cd /root/.openclaw/workspace/admiral/backend/netlify/functions

# Rename old functions (backup)
mv auth-register.js auth-register-OLD.js
mv auth-login.js auth-login-OLD.js

# Rename new Supabase functions
mv auth-register-supabase.js auth-register.js
mv auth-login-supabase.js auth-login.js
```

### 4.2 Commit and Push

```bash
cd /root/.openclaw/workspace/admiral/backend

git add netlify/functions/
git commit -m "Swap to Supabase-backed auth functions"
git push origin main
```

**Netlify will auto-deploy within 1-2 minutes**

---

## STEP 5: Install Supabase Client (1 min)

The functions use `@supabase/supabase-js`. Make sure it's in `package.json`:

```bash
npm install @supabase/supabase-js
```

Verify it's in `package.json`:
```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.x.x",
    "bcryptjs": "^2.4.3",
    "jsonwebtoken": "^9.0.2"
  }
}
```

---

## STEP 6: Test Live! (5 min)

### 6.1 Go to admiralen.netlify.app

1. **Register new account:**
   - Email: test@yourcompany.com
   - Password: Test123456
   - Click "Registrera konto"

2. **Check Supabase:**
   - Go to Supabase dashboard
   - Click **Table Editor**
   - Select "users" table
   - You should see your new user! ✅

3. **Login:**
   - Click "Logga in"
   - Use same email + password
   - Should redirect to dashboard ✅

4. **Dashboard:**
   - Should show your email at top
   - KPI cards should load ✅

---

## TROUBLESHOOTING

### Error: "Cannot find package @supabase/supabase-js"
**Fix:** Run `npm install @supabase/supabase-js` and redeploy

### Error: "SUPABASE_URL not defined"
**Fix:** Check Netlify env variables are set (refresh page if just added)

### Error: "User already exists" when registering
**Fix:** Email already in database. Try different email or delete row in Supabase

### Dashboard shows "Failed to load user"
**Fix:** 
1. Check JWT_SECRET is set in Netlify
2. Check token in localStorage (DevTools → Application → localStorage)
3. Try logout + login again

---

## NEXT STEPS AFTER SUPABASE

1. ✅ Users stored in database
2. Add **rate limiting** (prevent brute force)
3. Add **email verification** (confirm email addresses)
4. Add **password reset** flow
5. Integrate **Meta Ads API** (fetch real campaigns)

---

**Status:** All files ready. Just follow steps 1-5 above! 🚀
