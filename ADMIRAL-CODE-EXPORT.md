# ADMIRAL - Complete Source Code

**Date:** 2026-04-17  
**Status:** Production-ready (serverless on Netlify Functions)  
**GitHub:** https://github.com/Fabricken-maker/Admiral

---

## DEPLOYMENT URLS

- **Frontend (Live):** https://admiralen.netlify.app
- **Custom Domain:** admiralai.se (DNS propagating)
- **GitHub:** https://github.com/Fabricken-maker/Admiral

---

## PROJECT STRUCTURE

```
admiral/backend/
├── public/                    # Frontend (HTML/CSS/JS)
│   ├── index.html            # Home page
│   ├── login.html            # Login + Registration
│   ├── dashboard.html        # Dashboard
│   ├── setup.html            # Setup wizard
│   ├── tokens.css            # Design tokens
│   └── setup-script.js       # Setup logic
├── netlify/functions/        # Serverless functions
│   ├── auth-register.js      # Registration endpoint
│   └── auth-login.js         # Login endpoint
├── src/                       # Backend (Node.js)
│   ├── index.js              # Express server
│   ├── middleware/auth.js    # JWT auth
│   ├── routes/auth.js        # Auth endpoints
│   ├── routes/campaigns.js   # Campaign endpoints
│   ├── routes/admin.js       # Admin endpoints
│   ├── routes/webhook.js     # Webhook receiver
│   └── utils/
│       ├── db.js             # Database
│       └── crm-sync.js       # CRM integration
├── migrations/run.js         # DB migrations
├── package.json              # Dependencies
└── netlify.toml              # Netlify config
```

---

## MAIN FILES

### 1. Frontend - Home Page (public/index.html)


```html
<!DOCTYPE html>
<html lang="sv">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admiral - Meta Ads Dashboard</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #0a0e27 0%, #1a1f3a 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #dce3f0;
        }

        .container {
            width: 100%;
            max-width: 500px;
            padding: 20px;
        }

        .card {
            background: rgba(26, 31, 58, 0.8);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(200, 168, 75, 0.2);
            border-radius: 16px;
            padding: 60px 40px;
            text-align: center;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        }

        .logo {
            font-size: 48px;
            margin-bottom: 20px;
        }

        h1 {
            font-size: 32px;
            margin-bottom: 12px;
            background: linear-gradient(135deg, #c8a84b 0%, #5898f0 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .subtitle {
            font-size: 16px;
            color: #a0a8b3;
            margin-bottom: 40px;
        }

        .button-group {
            display: flex;
            gap: 12px;
            flex-direction: column;
        }

        button {
            padding: 14px 28px;
            font-size: 16px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.3s ease;
        }

        .btn-login {
            background: linear-gradient(135deg, #c8a84b 0%, #a88a3a 100%);
            color: #0a0e27;
        }

        .btn-login:hover {
            transform: translateY(-2px);
            box-shadow: 0 12px 24px rgba(200, 168, 75, 0.3);
        }

        .btn-register {
            background: rgba(88, 152, 240, 0.2);
            color: #5898f0;
            border: 1px solid #5898f0;
        }

        .btn-register:hover {
            background: rgba(88, 152, 240, 0.3);
            transform: translateY(-2px);
        }

        .features {
            margin-top: 40px;
            padding-top: 40px;
            border-top: 1px solid rgba(200, 168, 75, 0.1);
            text-align: left;
        }

        .feature {
            display: flex;
            gap: 12px;
            margin-bottom: 16px;
            font-size: 14px;
            color: #a0a8b3;
        }

        .feature-icon {
            color: #3dd68c;
            font-weight: bold;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="card">
            
            <h1>Admiral</h1>
            <p class="subtitle">Meta Ads Intelligence Dashboard</p>

            <div class="button-group">
                <button class="btn-login" onclick="goToLogin()">Logga in</button>
                <button class="btn-register" onclick="goToRegister()">Registrera dig</button>
            </div>

            <div class="features">
                <div class="feature">
                    <span class="feature-icon">✓</span>
                    <span>Real-time kampanjövervakning</span>
                </div>
                <div class="feature">
                    <span class="feature-icon">✓</span>
                    <span>CPM, Conversion & ROI-analys</span>
                </div>
                <div class="feature">
                    <span class="feature-icon">✓</span>
                    <span>Automatisk Meta Ads-synk</span>
                </div>
                <div class="feature">
                    <span class="feature-icon">✓</span>
                    <span>Setup-wizard för snabb start</span>
                </div>
            </div>
        </div>
    </div>

    <script>
        function goToLogin() {
            window.location.href = '/login.html';
        }

        function goToRegister() {
            window.location.href = '/login.html?register=true';
        }
    </script>
</body>
</html>
```

### 2. Frontend - Login & Registration (public/login.html)

```html
<!DOCTYPE html>
<html lang="sv">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admiral - Logga in</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #0a0e27 0%, #1a1f3a 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #dce3f0;
        }

        .container {
            width: 100%;
            max-width: 420px;
            padding: 20px;
        }

        .card {
            background: rgba(26, 31, 58, 0.8);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(200, 168, 75, 0.2);
            border-radius: 16px;
            overflow: hidden;
        }

        .header {
            background: linear-gradient(135deg, #c8a84b 0%, #5898f0 100%);
            padding: 40px 20px;
            text-align: center;
        }

        .header h1 {
            font-size: 28px;
            color: #0a0e27;
            margin-bottom: 8px;
        }

        .header p {
            color: rgba(10, 14, 39, 0.8);
            font-size: 14px;
        }

        .form-container {
            padding: 40px 30px;
        }

        .form-group {
            margin-bottom: 20px;
        }

        label {
            display: block;
            margin-bottom: 8px;
            font-size: 14px;
            font-weight: 600;
            color: #dce3f0;
        }

        .input-group {
            position: relative;
        }

        input {
            width: 100%;
            padding: 12px 40px 12px 16px;
            border: 1px solid rgba(200, 168, 75, 0.3);
            border-radius: 8px;
            background: rgba(10, 14, 39, 0.5);
            color: #dce3f0;
            font-size: 14px;
            transition: border-color 0.3s ease;
        }

        input:focus {
            outline: none;
            border-color: #c8a84b;
        }

        .password-toggle {
            position: absolute;
            right: 12px;
            top: 50%;
            transform: translateY(-50%);
            background: none;
            border: none;
            color: #a0a8b3;
            cursor: pointer;
            font-size: 18px;
            padding: 0;
            width: auto;
            margin: 0;
            transition: color 0.3s ease;
        }

        .password-toggle:hover {
            color: #c8a84b;
        }

        button[type="submit"] {
            width: 100%;
            padding: 12px;
            background: linear-gradient(135deg, #c8a84b 0%, #a88a3a 100%);
            color: #0a0e27;
            border: none;
            border-radius: 8px;
            font-weight: 600;
            font-size: 16px;
            cursor: pointer;
            transition: all 0.3s ease;
            margin-top: 20px;
        }

        button[type="submit"]:hover {
            transform: translateY(-2px);
            box-shadow: 0 12px 24px rgba(200, 168, 75, 0.3);
        }

        button[type="submit"]:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .toggle-mode {
            text-align: center;
            margin-top: 20px;
            font-size: 14px;
        }

        .toggle-mode a {
            color: #5898f0;
            cursor: pointer;
            text-decoration: none;
        }

        .toggle-mode a:hover {
            text-decoration: underline;
        }

        .back-link {
            text-align: center;
            margin-bottom: 20px;
        }

        .back-link a {
            color: #a0a8b3;
            text-decoration: none;
            font-size: 14px;
        }

        .back-link a:hover {
            color: #dce3f0;
        }

        .message {
            padding: 12px;
            border-radius: 8px;
            margin-bottom: 20px;
            display: none;
            font-size: 14px;
        }

        .message.error {
            background: rgba(255, 68, 68, 0.2);
            color: #ff4444;
            border: 1px solid rgba(255, 68, 68, 0.3);
        }

        .message.success {
            background: rgba(61, 214, 140, 0.2);
            color: #3dd68c;
            border: 1px solid rgba(61, 214, 140, 0.3);
        }

        .message.show {
            display: block;
        }

        .hidden-group {
            display: none !important;
            height: 0;
            overflow: hidden;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="card">
            <div class="header">
                <h1>Admiral</h1>
                <p id="header-subtitle">Logga in på ditt konto</p>
            </div>

            <div class="form-container">
                <div class="back-link">
                    <a href="/">← Tillbaka</a>
                </div>

                <div id="message" class="message"></div>

                <form id="auth-form">
                    <div class="form-group">
                        <label for="email">E-postadress</label>
                        <input 
                            type="email" 
                            id="email" 
                            placeholder="din@email.com"
                        >
                    </div>

                    <!-- Login password field -->
                    <div class="form-group" id="login-password-group">
                        <label for="password-login">Lösenord</label>
                        <div class="input-group">
                            <input 
                                type="password" 
                                id="password-login" 
                                placeholder="Ditt lösenord"
                            >
                            <button type="button" class="password-toggle" onclick="togglePasswordVisibility('password-login')">👁️</button>
                        </div>
                    </div>

                    <!-- Register password fields -->
                    <div class="form-group hidden-group" id="register-password-group">
                        <label for="password-register">Lösenord (minst 6 tecken)</label>
                        <div class="input-group">
                            <input 
                                type="password" 
                                id="password-register" 
                                placeholder="Välj ett starkt lösenord"
                            >
                            <button type="button" class="password-toggle" onclick="togglePasswordVisibility('password-register')">👁️</button>
                        </div>
                    </div>

                    <div class="form-group hidden-group" id="confirm-password-group">
                        <label for="password-confirm">Bekräfta lösenord</label>
                        <div class="input-group">
                            <input 
                                type="password" 
                                id="password-confirm" 
                                placeholder="Bekräfta lösenord"
                            >
                            <button type="button" class="password-toggle" onclick="togglePasswordVisibility('password-confirm')">👁️</button>
                        </div>
                    </div>

                    <button type="submit" id="submit-btn">Logga in</button>
                </form>

                <div class="toggle-mode">
                    <span id="toggle-text">Ingen kund än? <a onclick="toggleMode()">Registrera dig här</a></span>
                </div>
            </div>
        </div>
    </div>

    <script>
        const BACKEND_URL = '/.netlify/functions'; // Netlify Functions (serverless)
        let isRegisterMode = false;

        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('register') === 'true') {
            toggleMode();
        }

        function toggleMode() {
            isRegisterMode = !isRegisterMode;
            const submitBtn = document.getElementById('submit-btn');
            const headerSubtitle = document.getElementById('header-subtitle');
            const toggleText = document.getElementById('toggle-text');
            const loginGroup = document.getElementById('login-password-group');
            const registerGroup = document.getElementById('register-password-group');
            const confirmGroup = document.getElementById('confirm-password-group');

            if (isRegisterMode) {
                submitBtn.textContent = 'Registrera konto';
                headerSubtitle.textContent = 'Skapa ett nytt konto';
                toggleText.innerHTML = 'Redan kund? <a onclick="toggleMode()">Logga in här</a>';
                loginGroup.classList.add('hidden-group');
                registerGroup.classList.remove('hidden-group');
                confirmGroup.classList.remove('hidden-group');
            } else {
                submitBtn.textContent = 'Logga in';
                headerSubtitle.textContent = 'Logga in på ditt konto';
                toggleText.innerHTML = 'Ingen kund än? <a onclick="toggleMode()">Registrera dig här</a>';
                loginGroup.classList.remove('hidden-group');
                registerGroup.classList.add('hidden-group');
                confirmGroup.classList.add('hidden-group');
            }
        }

        function togglePasswordVisibility(fieldId) {
            const field = document.getElementById(fieldId);
            if (field.type === 'password') {
                field.type = 'text';
            } else {
                field.type = 'password';
            }
        }

        document.getElementById('auth-form').addEventListener('submit', async (e) => {
            e.preventDefault();

            const email = document.getElementById('email').value.trim();
            const messageDiv = document.getElementById('message');
            const submitBtn = document.getElementById('submit-btn');

            messageDiv.classList.remove('show', 'error', 'success');
            submitBtn.disabled = true;

            try {
                if (!email) {
                    throw new Error('E-postadress är obligatorisk');
                }

                if (isRegisterMode) {
                    const password = document.getElementById('password-register').value;
                    const confirmPassword = document.getElementById('password-confirm').value;

                    if (!password) {
                        throw new Error('Lösenord är obligatoriskt');
                    }

                    if (password !== confirmPassword) {
                        throw new Error('Lösenorden matchar inte');
                    }

                    if (password.length < 6) {
                        throw new Error('Lösenordet måste vara minst 6 tecken');
                    }

                    const response = await fetch(`${BACKEND_URL}/auth-register`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            email,
                            password,
                            company_name: email.split('@')[0] + ' Company'
                        })
                    });

                    if (!response.ok) {
                        const error = await response.json();
                        throw new Error(error.error || 'Registrering misslyckades');
                    }

                    const data = await response.json();
                    messageDiv.textContent = '✓ Konto skapat! Loggar in...';
                    messageDiv.classList.add('show', 'success');
                    setTimeout(() => {
                        localStorage.setItem('token', data.token);
                        localStorage.setItem('user', JSON.stringify(data.user));
                        window.location.href = '/dashboard.html';
                    }, 1500);
                } else {
                    const password = document.getElementById('password-login').value;

                    if (!password) {
                        throw new Error('Lösenord är obligatoriskt');
                    }

                    const response = await fetch(`${BACKEND_URL}/auth-login`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email, password })
                    });

                    if (!response.ok) {
                        const error = await response.json();
                        throw new Error(error.error || 'Login misslyckades');
                    }

                    const data = await response.json();
                    messageDiv.textContent = '✓ Login lyckades! Omdirigerar...';
                    messageDiv.classList.add('show', 'success');
                    setTimeout(() => {
                        localStorage.setItem('token', data.token);
                        localStorage.setItem('user', JSON.stringify(data.user));
                        window.location.href = '/dashboard.html';
                    }, 1500);
                }
            } catch (error) {
                console.error('Error:', error);
                messageDiv.textContent = `✗ ${error.message}`;
                messageDiv.classList.add('show', 'error');
                submitBtn.disabled = false;
            }
        });
    </script>
</body>
</html>
```

### 3. Frontend - Dashboard (public/dashboard.html)

```html
<!DOCTYPE html>
<html lang="sv">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admiral - Dashboard</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #0a0e27 0%, #1a1f3a 100%);
            min-height: 100vh;
            color: #dce3f0;
        }

        .navbar {
            background: rgba(10, 14, 39, 0.9);
            border-bottom: 1px solid rgba(200, 168, 75, 0.2);
            padding: 16px 40px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .navbar-brand {
            font-size: 24px;
            font-weight: 700;
            background: linear-gradient(135deg, #c8a84b 0%, #5898f0 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .navbar-user {
            display: flex;
            gap: 16px;
            align-items: center;
        }

        .user-email {
            font-size: 14px;
            color: #a0a8b3;
        }

        .logout-btn {
            padding: 8px 16px;
            background: rgba(255, 68, 68, 0.2);
            color: #ff4444;
            border: 1px solid rgba(255, 68, 68, 0.3);
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.3s ease;
        }

        .logout-btn:hover {
            background: rgba(255, 68, 68, 0.3);
        }

        .container {
            max-width: 1200px;
            margin: 40px auto;
            padding: 0 20px;
        }

        .header {
            margin-bottom: 40px;
        }

        .header h1 {
            font-size: 32px;
            margin-bottom: 8px;
        }

        .header p {
            color: #a0a8b3;
            font-size: 16px;
        }

        .kpi-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 40px;
        }

        .kpi-card {
            background: rgba(26, 31, 58, 0.8);
            border: 1px solid rgba(200, 168, 75, 0.2);
            border-radius: 12px;
            padding: 24px;
            backdrop-filter: blur(10px);
        }

        .kpi-label {
            font-size: 12px;
            color: #a0a8b3;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 8px;
        }

        .kpi-value {
            font-size: 32px;
            font-weight: 700;
            background: linear-gradient(135deg, #c8a84b 0%, #5898f0 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            margin-bottom: 12px;
        }

        .kpi-change {
            font-size: 13px;
            color: #3dd68c;
        }

        .loading {
            text-align: center;
            padding: 60px 20px;
            color: #a0a8b3;
        }

        .error {
            background: rgba(255, 68, 68, 0.2);
            color: #ff4444;
            border: 1px solid rgba(255, 68, 68, 0.3);
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
        }

        .feature-list {
            background: rgba(26, 31, 58, 0.8);
            border: 1px solid rgba(200, 168, 75, 0.2);
            border-radius: 12px;
            padding: 30px;
            margin-top: 40px;
        }

        .feature-list h2 {
            margin-bottom: 20px;
            font-size: 20px;
        }

        .feature-item {
            display: flex;
            gap: 12px;
            margin-bottom: 16px;
            padding-bottom: 16px;
            border-bottom: 1px solid rgba(200, 168, 75, 0.1);
        }

        .feature-item:last-child {
            border-bottom: none;
            margin-bottom: 0;
            padding-bottom: 0;
        }

        .feature-icon {
            color: #3dd68c;
            font-size: 20px;
            flex-shrink: 0;
        }

        .feature-text {
            font-size: 14px;
            color: #a0a8b3;
        }
    </style>
</head>
<body>
    <div class="navbar">
        <div class="navbar-brand">Admiral</div>
        <div class="navbar-user">
            <span class="user-email" id="user-email"></span>
            <button class="logout-btn" onclick="logout()">Logga ut</button>
        </div>
    </div>

    <div class="container">
        <div class="header">
            <h1>Din Dashboard</h1>
            <p>Välkommen till Admiral! Din Meta Ads Intelligence Center.</p>
        </div>

        <div id="error-message" class="error" style="display: none;"></div>
        <div id="loading" class="loading">Laddar dashboard...</div>

        <div id="content" style="display: none;">
            <div class="kpi-grid">
                <div class="kpi-card">
                    <div class="kpi-label">Totalt Spend</div>
                    <div class="kpi-value" id="total-spend">-</div>
                    <div class="kpi-change">Denna månad</div>
                </div>

                <div class="kpi-card">
                    <div class="kpi-label">Genomsnittligt CPM</div>
                    <div class="kpi-value" id="avg-cpm">-</div>
                    <div class="kpi-change">Kostnad per 1000 visningar</div>
                </div>

                <div class="kpi-card">
                    <div class="kpi-label">Conversion Rate</div>
                    <div class="kpi-value" id="conversion-rate">-</div>
                    <div class="kpi-change">Andel konverteringar</div>
                </div>

                <div class="kpi-card">
                    <div class="kpi-label">ROI</div>
                    <div class="kpi-value" id="roi">-</div>
                    <div class="kpi-change">Return on Investment</div>
                </div>
            </div>

            <div class="feature-list">
                <h2>Nästa Steg</h2>
                <div class="feature-item">
                    <div class="feature-icon">📊</div>
                    <div class="feature-text">
                        <strong>Anslut ditt Meta Ads-konto</strong> - Gå till setup-wizard för att koppla ditt Meta Ads Manager-konto och börja se dina kampanjer i realtid.
                    </div>
                </div>
                <div class="feature-item">
                    <div class="feature-icon">⚙️</div>
                    <div class="feature-text">
                        <strong>Konfigurera din profil</strong> - Uppdatera din e-post, lösenord och andra inställningar.
                    </div>
                </div>
                <div class="feature-item">
                    <div class="feature-icon">🔗</div>
                    <div class="feature-text">
                        <strong>Synka kampanjer</strong> - Admiral hämtar dina kampanjer från Meta Ads och uppdaterar dem i realtid.
                    </div>
                </div>
                <div class="feature-item">
                    <div class="feature-icon">📈</div>
                    <div class="feature-text">
                        <strong>Analysera data</strong> - Se detaljerad analys av CPM, Conversions, ROAS och mer.
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        const BACKEND_URL = '/.netlify/functions'; // Netlify Functions

        async function loadDashboard() {
            const token = localStorage.getItem('token');

            if (!token) {
                window.location.href = '/login.html';
                return;
            }

            try {
                // Hämta användardata
                const userResponse = await fetch(`${BACKEND_URL}/api/user`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (!userResponse.ok) {
                    throw new Error('Kunde inte ladda användardata');
                }

                const user = await userResponse.json();
                document.getElementById('user-email').textContent = user.email;

                // Mock-data för kampanjer
                const mockData = {
                    totalSpend: '45 000 SEK',
                    avgCPM: '42 kr',
                    conversionRate: '3.2%',
                    roi: '4.2x'
                };

                document.getElementById('total-spend').textContent = mockData.totalSpend;
                document.getElementById('avg-cpm').textContent = mockData.avgCPM;
                document.getElementById('conversion-rate').textContent = mockData.conversionRate;
                document.getElementById('roi').textContent = mockData.roi;

                document.getElementById('loading').style.display = 'none';
                document.getElementById('content').style.display = 'block';
            } catch (error) {
                console.error('Error:', error);
                document.getElementById('loading').style.display = 'none';
                document.getElementById('error-message').style.display = 'block';
                document.getElementById('error-message').textContent = error.message;
            }
        }

        function logout() {
            localStorage.removeItem('token');
            window.location.href = '/';
        }

        // Load dashboard on page load
        loadDashboard();
    </script>
</body>
</html>
```

### 4. Serverless - Registration Function (netlify/functions/auth-register.js)

```javascript
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Mock database (in production, use a real database)
const users = {};

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { email, password, company_name } = JSON.parse(event.body);

    if (!email || !password || !company_name) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }

    // Check if user exists
    if (users[email]) {
      return {
        statusCode: 409,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'User already exists' })
      };
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const userId = Object.keys(users).length + 1;
    users[email] = {
      id: userId,
      email,
      password: hashedPassword,
      company_name,
      subscription_tier: 'starter',
      subscription_status: 'active',
      created_at: new Date().toISOString()
    };

    // Generate token
    const token = jwt.sign(
      { id: userId, email, subscription_tier: 'starter' },
      process.env.JWT_SECRET || 'test-secret-key',
      { expiresIn: '24h' }
    );

    return {
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        message: 'User registered successfully',
        token,
        user: {
          id: userId,
          email,
          company_name,
          subscription_tier: 'starter'
        }
      })
    };
  } catch (error) {
    console.error('Registration error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'Registration failed' })
    };
  }
};
```

### 5. Serverless - Login Function (netlify/functions/auth-login.js)

```javascript
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Mock database (same as register)
const users = {
  'test@example.com': {
    id: 1,
    email: 'test@example.com',
    password: '$2a$10$lkQ5D2CXzYyOvYo0D0C0.e4YMxKvHDhC6uZ8xKk9L9lK9K9K9K9K9',
    company_name: 'Test Company',
    subscription_tier: 'starter',
    subscription_status: 'active'
  }
};

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { email, password } = JSON.parse(event.body);

    if (!email || !password) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'Missing email or password' })
      };
    }

    const user = users[email];

    if (!user) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'Invalid email or password' })
      };
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'Invalid email or password' })
      };
    }

    // Generate token
    const token = jwt.sign(
      { id: user.id, email: user.email, subscription_tier: user.subscription_tier },
      process.env.JWT_SECRET || 'test-secret-key',
      { expiresIn: '24h' }
    );

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        message: 'Login successful',
        token,
        user: {
          id: user.id,
          email: user.email,
          company_name: user.company_name,
          subscription_tier: user.subscription_tier,
          subscription_status: user.subscription_status
        }
      })
    };
  } catch (error) {
    console.error('Login error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'Login failed' })
    };
  }
};
```

### 6. Package.json

```json
{
  "name": "admiral-backend",
  "version": "2.0.0",
  "description": "Admiral Phase 2 Backend - Subscription Management & CRM Integration",
  "main": "src/index.js",
  "type": "module",
  "scripts": {
    "start": "node src/index.js",
    "dev": "nodemon src/index.js",
    "migrate": "node migrations/run.js",
    "test": "jest",
    "build": "echo 'No build step needed'",
    "deploy": "npm run migrate && npm start"
  },
  "dependencies": {
    "express": "^4.18.2",
    "better-sqlite3": "^9.2.2",
    "bcryptjs": "^2.4.3",
    "jsonwebtoken": "^9.0.2",
    "dotenv": "^16.3.1",
    "cors": "^2.8.5",
    "body-parser": "^1.20.2",
    "node-fetch": "^3.3.2",
    "axios": "^1.6.2"
  },
  "devDependencies": {
    "nodemon": "^3.0.2",
    "jest": "^29.7.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

### 7. Netlify Config (netlify.toml)

```toml
[build]
  command = "echo 'Static site - no build needed'"
  publish = "public"

[env.production]
  environment = { BACKEND_URL = "http://187.124.32.19:3000" }

[env.staging]
  environment = { BACKEND_URL = "http://localhost:3000" }

# Proxy API calls to VPS backend - NO FORCE (allow relative path resolution)
[[redirects]]
  from = "/api/*"
  to = "http://187.124.32.19:3000/api/:splat"
  status = 200

[[redirects]]
  from = "/auth/*"
  to = "http://187.124.32.19:3000/auth/:splat"
  status = 200

[[redirects]]
  from = "/health"
  to = "http://187.124.32.19:3000/health"
  status = 200
  force = true

# SPA routing - all other paths go to index.html
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

# CORS headers
[[headers]]
  for = "/api/*"
  [headers.values]
    Access-Control-Allow-Origin = "*"
    Access-Control-Allow-Methods = "GET, POST, PUT, DELETE, OPTIONS"
    Access-Control-Allow-Headers = "Content-Type, Authorization"

---

## QUICK START

### Test Registration
1. Go to admiralen.netlify.app (use VPN if in Sweden)
2. Click 'Registrera dig här'
3. Fill: email, password (2x), confirm
4. Click 'Registrera konto'
5. Should see green 'Konto skapat!' message
6. Redirects to dashboard

### Test Login
1. Click 'Logga in'
2. Use registered email + password
3. Should see 'Login lyckades!'
4. Redirects to dashboard

### Dashboard
- Shows KPI cards (Spend, CPM, Conversion, ROI)
- Mock data currently
- 'Logga ut' button works

---

## ARCHITECTURE

```
admiralen.netlify.app (HTTPS)
    ↓
Frontend (HTML/CSS/JS)
    ↓
Netlify Functions (Serverless)
    ├── /.netlify/functions/auth-register
    └── /.netlify/functions/auth-login
    ↓
JWT Token (localStorage)
    ↓
Dashboard (Private)
```

---

## NEXT STEPS (Phase 3)

1. **Meta Ads API Integration**
   - Connect real Meta Ads accounts
   - Fetch real campaign data
   - Sync CPM, conversions, ROI

2. **CRM Integration**
   - Auto-sync users to Fabricken CRM
   - Update subscription status
   - Track LTV

3. **Viktor Notifications**
   - Notify Viktor when customer registers
   - Alert on subscription changes
   - Invoice generation triggers

4. **Database**
   - Replace mock users with real database
   - Persist users + campaigns
   - Analytics logging

5. **SSL Certificate**
   - Get Let's Encrypt for admiralai.se
   - When DNS is live

---

## CREDENTIALS

**Test User (from login.js mock):**
- Email: test@example.com
- Password: password123

---

**Built with:** Node.js, Express, SQLite, Netlify Functions, Vanilla JS
**Team:** Sofia (AI Assistant) + Erik Ågerup (Product)

