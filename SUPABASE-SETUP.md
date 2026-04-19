# Supabase Setup Guide for Admiral

## Why Supabase?
- PostgreSQL serverless (works with Netlify Functions)
- Real-time updates
- Built-in auth (can migrate later)
- Free tier: 500MB database, perfect for MVP

## Steps

### 1. Create Supabase Project
1. Go to https://supabase.com
2. Sign up / Login
3. Click "New Project"
4. Fill: Project name: `admiral-db`
5. Generate strong password
6. Region: Europe (Frankfurt) recommended
7. Create project (wait 2-5 min)

### 2. Get Credentials
Once created:
1. Go to **Settings** → **API**
2. Copy:
   - **Project URL** → `SUPABASE_URL`
   - **Anon Key** → `SUPABASE_ANON_KEY`
   - **Service Key** → `SUPABASE_SERVICE_KEY`

### 3. Create Tables

SQL to run in Supabase SQL Editor:

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

CREATE INDEX idx_users_email ON users(email);

-- Sessions table (optional, for tracking logins)
CREATE TABLE IF NOT EXISTS sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id),
  token_hash TEXT UNIQUE,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now()
);

-- Campaigns table (future use)
CREATE TABLE IF NOT EXISTS campaigns (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id),
  campaign_name TEXT,
  meta_campaign_id TEXT,
  spend DECIMAL(10,2),
  cpm DECIMAL(8,2),
  conversion_rate DECIMAL(5,2),
  roi DECIMAL(8,2),
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_campaigns_user_id ON campaigns(user_id);
```

### 4. Update .env

Add to Netlify environment variables:
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJh...
SUPABASE_SERVICE_KEY=eyJh...
JWT_SECRET=your-random-secret-key
```

### 5. Update Auth Functions

Modify `netlify/functions/auth-register.js` and `auth-login.js` to use Supabase instead of in-memory storage.

**Example for register:**

```javascript
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export const handler = async (event, context) => {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { email, password, company_name } = JSON.parse(event.body);

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 10);

  // Insert user
  const { data, error } = await supabase
    .from('users')
    .insert([
      {
        email,
        password_hash: hashedPassword,
        company_name,
        subscription_tier: 'starter'
      }
    ])
    .select();

  if (error) {
    return {
      statusCode: 409,
      body: JSON.stringify({ error: error.message })
    };
  }

  // Generate JWT
  const token = jwt.sign(
    { id: data[0].id, email: data[0].email },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  return {
    statusCode: 201,
    body: JSON.stringify({ token, user: data[0] })
  };
};
```

### 6. Install Supabase Client

```bash
npm install @supabase/supabase-js
```

### 7. Deploy

Push changes to GitHub → Netlify auto-deploys

## Testing

1. Register new user → Check Supabase dashboard for new row in `users` table
2. Login → Should work with hashed password
3. Dashboard → Should show correct user data

## Cost

- **Free tier:** $0/month (500MB, perfect for MVP)
- **Pro:** $25/month (unlimited users, 8GB storage)

When Admiral scales, upgrade to Pro.

---

**Timeline:** ~30 minutes to complete all steps
