// ══════════════════════════════════════════════════════════════════════════════
// ADMIRAL SETUP — JAVASCRIPT FRAGMENTS (from Erik, 2026-04-10)
// ══════════════════════════════════════════════════════════════════════════════
// These fragments need to be integrated into setup.html <script> section
// See comments for integration points

// ══════════════════════════════
// STATE & CONSTANTS
// ══════════════════════════════
const CIRC = 2 * Math.PI * 22;
const ms = t => new Promise(r => setTimeout(r, t));
const LS_KEY = 'admiral_onboarding_v1';

const groups = {
  konto: { keys:['bm','aa','page'], total:3 },
  api: { keys:['app','token'], total:2 },
  pixel: { keys:['pixel','capi'], total:2 },
};

const items = {
  bm: { group:'konto', required:true, checked:false, auto:false },
  aa: { group:'konto', required:true, checked:false, auto:false },
  page: { group:'konto', required:false, checked:false, auto:false },
  app: { group:'api', required:true, checked:false, auto:false },
  token: { group:'api', required:true, checked:false, auto:false },
  pixel: { group:'pixel', required:false, checked:false, auto:false },
  capi: { group:'pixel', required:false, checked:false, auto:false },
};

const ICONS = { konto:'👤', api:'🔑', pixel:'📡' };

let tokenTimerInterval = null;
let tokenExpiresAt = null;
let extractedAccountId = null;

// ══════════════════════════════
// FEATURE 5: LOCALSTORAGE
// ══════════════════════════════
function saveProgress() {
  const state = {
    items: Object.fromEntries(Object.entries(items).map(([k,v])=>[k,{checked:v.checked,auto:v.auto}])),
    urlInput: document.getElementById('urlInput')?.value || '',
    manualAA: document.getElementById('hc-aa')?.value || '',
    inpToken: document.getElementById('inp-token')?.value || '',
    inpAA1: document.getElementById('inp-aa1')?.value || '',
    inpAA2: document.getElementById('inp-aa2')?.value || '',
    inpAA3: document.getElementById('inp-aa3')?.value || '',
    extractedId: extractedAccountId,
    ts: Date.now(),
  };
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch(e){}
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    // Only restore if less than 24h old
    if (Date.now() - s.ts > 86400000) { localStorage.removeItem(LS_KEY); return false; }
    const anyChecked = Object.values(s.items).some(i=>i.checked);
    if (!anyChecked) return false;
    return s;
  } catch(e) { return false; }
}

// ══════════════════════════════
// FEATURE 4: URL EXTRACTOR
// ══════════════════════════════
function onUrlInput(el) {
  const v = el.value.trim();
  const chips = document.getElementById('extractedChips');
  const hint = document.getElementById('urlHint');
  const illus = document.getElementById('urlIllus');
  chips.innerHTML = '';

  if (!v) {
    hint.textContent = 'Öppna Meta Ads Manager → kopiera URL:en från adressfältet och klistra in här';
    hint.style.color = 'var(--color-text-secondary)';
    illus?.classList.remove('show');
    return;
  }

  illus?.classList.add('show');

  // Try to extract act_ and business_id
  const actMatch = v.match(/[?&]act=(\d+)/);
  const bmMatch = v.match(/[?&]business_id=(\d+)/);
  let found = false;

  if (actMatch) {
    const actId = 'act_' + actMatch[1];
    extractedAccountId = actId;
    chips.innerHTML += `<div class="e-chip"><span class="e-label">Ad Account</span>${actId}</div>`;
    // Pre-fill manual field and step2
    const hcAa = document.getElementById('hc-aa');
    if (hcAa) hcAa.value = actId;
    const aa1 = document.getElementById('inp-aa1');
    if (aa1 && !aa1.value) { aa1.value = actId; vAA(aa1); }
    el.classList.add('ok'); el.classList.remove('bad');
    found = true;
    // Auto-run pre-check after short delay
    setTimeout(() => runPreCheck(), 400);
  }

  if (bmMatch) {
    chips.innerHTML += `<div class="e-chip" style="background:var(--bdim);border-color:var(--bborder);color:var(--blue)"><span class="e-label" style="color:var(--color-text-secondary)">BM ID</span>${bmMatch[1]}</div>`;
  }

  if (found) {
    hint.textContent = '✓ ID:n extraherade — kollen startar automatiskt';
    hint.style.color = 'var(--color-success)';
  } else if (v.length > 10) {
    el.classList.add('bad'); el.classList.remove('ok');
    hint.textContent = 'Hittade inget act= i URL:en — kolla att du kopierat hela adressen';
    hint.style.color = 'var(--color-error)';
  }

  saveProgress();
}

// Manual fallback
let manualShown = false;
function toggleManual() {
  manualShown = !manualShown;
  const row = document.getElementById('manualRow');
  const toggle = document.getElementById('manualToggle');
  if (row) row.classList.toggle('show', manualShown);
  if (toggle) toggle.textContent = manualShown
    ? '← Dölj manuell inmatning'
    : 'Har du inte URL:en? Fyll i ID manuellt →';
}

function onManualInput(el) {
  const v = el.value.trim();
  el.classList.remove('ok','bad');
  const btn = document.getElementById('hcBtn');
  if (/^act_\d{8,}$/.test(v)) {
    el.classList.add('ok');
    if (btn) btn.disabled = false;
    extractedAccountId = v;
  } else if (v.length > 4) {
    el.classList.add('bad');
    if (btn) btn.disabled = true;
  } else {
    if (btn) btn.disabled = true;
  }
}

// ══════════════════════════════
// PRE-CHECK (ASYNC)
// ══════════════════════════════
async function runPreCheck() {
  const rawId = extractedAccountId || document.getElementById('hc-aa')?.value.trim() || '';
  if (!rawId) return;
  
  const numId = rawId.replace('act_','');
  const hero = document.getElementById('heroCheck');
  const results = document.getElementById('hcResults');
  const summary = document.getElementById('hcSummary');
  const nudge = document.getElementById('hcNudge');
  const btn = document.getElementById('hcBtn');

  if (btn) { btn.textContent = '…'; btn.disabled = true; }
  hero?.classList.remove('passed','failed');
  hero?.classList.add('checking');
  results?.classList.add('open');
  if (summary) { summary.textContent = ''; summary.className = 'hc-summary'; }
  if (nudge) nudge.classList.remove('show');

  // Mock check: simulate 5 pre-checks
  await ms(250);
  let data = null, err = null;

  try {
    if (!/^\d{10,18}$/.test(numId)) throw new Error('BAD_FORMAT');
    const seed = parseInt(numId.slice(-2));
    data = {
      name: 'Annonskonto …'+numId.slice(-4),
      status: seed < 88 ? 1 : seed < 94 ? 9 : 2,
      has_bm: seed < 92,
      has_payment: seed < 90,
      has_pixel: seed < 75,
      currency:'SEK',
      timezone: seed < 85 ? 'Europe/Stockholm' : 'UTC',
    };
  } catch(e) {
    err = e.message;
  }

  if (err || !data) {
    if (summary) {
      summary.textContent = err==='BAD_FORMAT'
        ? 'ID-formatet stämmer inte — kontrollera att du kopierat rätt'
        : 'Kunde inte nå Meta — försök igen';
      summary.className = 'hc-summary warn';
    }
    hero?.classList.remove('checking');
    hero?.classList.add('failed');
    if (btn) { btn.textContent = 'Kolla igen'; btn.disabled = false; }
    return;
  }

  // Mock success path
  hero?.classList.remove('checking');
  hero?.classList.add('passed');
  if (summary) {
    summary.textContent = 'Kontot är aktivt med BM och betalning på plats. Redo för Admiral!';
    summary.className = 'hc-summary ok';
  }
  if (nudge) nudge.classList.add('show');
  if (btn) { btn.textContent = 'Kolla igen'; btn.disabled = false; }
  
  unlockStep2(extractedAccountId);
  saveProgress();
}

function unlockStep2(accountId) {
  const step2 = document.getElementById('step2');
  if (step2) {
    step2.classList.remove('locked');
    step2.classList.add('unlocked');
  }
  const status = document.getElementById('step2Status');
  if (status) {
    status.textContent = 'Redo';
    status.className = 'step-status pass';
  }
  if (accountId) {
    const aa1 = document.getElementById('inp-aa1');
    if (aa1 && !aa1.value) { aa1.value = accountId; vAA(aa1); }
  }
  startTokenTimer();
  updateCopyPreview();
}

// ══════════════════════════════
// FEATURE 2: TOKEN COUNTDOWN
// ══════════════════════════════
function startTokenTimer() {
  if (tokenTimerInterval) return;
  tokenExpiresAt = Date.now() + (115 * 60 * 1000); // 1h55m
  const timer = document.getElementById('tokenTimer');
  if (timer) timer.classList.add('show');
  tokenTimerInterval = setInterval(tickTimer, 1000);
  tickTimer();
}

function tickTimer() {
  const remaining = Math.max(0, tokenExpiresAt - Date.now());
  const h = Math.floor(remaining / 3600000);
  const m = Math.floor((remaining % 3600000) / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  const pad = n => String(n).padStart(2,'0');
  const display = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  const count = document.getElementById('timerCount');
  if (count) count.textContent = display;
  
  const timer = document.getElementById('tokenTimer');
  if (timer) {
    timer.classList.remove('ok','warning','urgent');
    if (remaining < 10 * 60 * 1000) timer.classList.add('urgent');
    else if (remaining < 30 * 60 * 1000) timer.classList.add('warning');
    else timer.classList.add('ok');
    
    if (remaining === 0) {
      clearInterval(tokenTimerInterval);
      const text = timer.querySelector('.timer-text');
      if (text) text.textContent = '⚠️ Token har löpt ut — generera en ny';
    }
  }
}

// ══════════════════════════════
// FEATURE 3: ONE-CLICK COPY
// ══════════════════════════════
function updateCopyPreview() {
  const tok = document.getElementById('inp-token')?.value.trim() || '';
  const aa1 = document.getElementById('inp-aa1')?.value.trim() || '';
  const aa2 = document.getElementById('inp-aa2')?.value.trim() || '';
  const aa3 = document.getElementById('inp-aa3')?.value.trim() || '';

  const set = (id, val, fallback) => {
    const el = document.getElementById(id);
    if (el) {
      if (val) { el.textContent = val; el.className = 'cp-val'; }
      else { el.textContent = fallback; el.className = 'cp-empty'; }
    }
  };

  set('cp-token', tok ? tok.slice(0,12)+'…'+tok.slice(-6) : '', 'väntar på token...');
  set('cp-aa1', aa1, 'väntar på account ID...');
  set('cp-aa2', aa2, '—');
  set('cp-aa3', aa3, '—');
  
  saveProgress();
}

function copyToClipboard() {
  const tok = document.getElementById('inp-token')?.value.trim() || '';
  const aa1 = document.getElementById('inp-aa1')?.value.trim() || '';
  const aa2 = document.getElementById('inp-aa2')?.value.trim() || '';
  const aa3 = document.getElementById('inp-aa3')?.value.trim() || '';

  let text = `Admiral Setup — Fabricken\n\nToken: ${tok || '(saknas)'}`;
  if (aa1) text += `\nKonto 1: ${aa1}`;
  if (aa2) text += `\nKonto 2: ${aa2}`;
  if (aa3) text += `\nKonto 3: ${aa3}`;
  text += '\n\n(Skicka till Erik på Fabricken — token expirerar snart!)';

  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copyBtn');
    if (btn) {
      btn.classList.add('copied');
      btn.textContent = '✓ Kopierat!';
      setTimeout(()=>{ 
        btn.classList.remove('copied');
        btn.textContent = '📋 Kopiera för Signal/Telegram';
      }, 3500);
    }
  }).catch(()=>{
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position='fixed';
    ta.style.opacity='0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
}

// ══════════════════════════════
// STEP 2 VALIDATION
// ══════════════════════════════
function vToken(el) {
  const v = el.value.trim();
  el.classList.remove('ok','bad');
  if (v.length>20 && v.startsWith('EAA')) el.classList.add('ok');
  else if (v.length>4) el.classList.add('bad');
  checkBtn();
  updateCopyPreview();
  if (el.classList.contains('ok') && !tokenTimerInterval) startTokenTimer();
  saveProgress();
}

function vAA(el) {
  const v=el.value.trim();
  el.classList.remove('ok','bad');
  if (!v) return checkBtn();
  (/^act_\d+$/.test(v)) ? el.classList.add('ok') : el.classList.add('bad');
  checkBtn();
  saveProgress();
}

function checkBtn() {
  const tok = document.getElementById('inp-token')?.classList.contains('ok');
  const aa1 = document.getElementById('inp-aa1')?.classList.contains('ok');
  const btn = document.getElementById('submitBtn');
  if (btn) {
    btn.disabled = !(tok&&aa1);
  }
}

// ══════════════════════════════
// STEP 2 VERIFICATION
// ══════════════════════════════
async function submitSetup() {
  const formArea = document.getElementById('formArea');
  const verifyEl = document.getElementById('verifyEl');
  const successWrap = document.getElementById('successWrap');
  const step2 = document.getElementById('step2');

  if (formArea) formArea.style.display='none';
  if (verifyEl) verifyEl.classList.add('on');

  const status = document.getElementById('step2Status');
  if (status) {
    status.textContent='Verifierar…';
    status.className='step-status running';
  }

  clearInterval(tokenTimerInterval);
  const timer = document.getElementById('tokenTimer');
  if (timer) timer.classList.remove('show');

  // Simulate 5 verification steps
  const steps=[[1,0,800],[2,800,600],[3,1400,1100],[4,2500,700],[5,3200,600]];
  for(const [n,wait,dur] of steps){
    await ms(wait);
    const vs=document.getElementById('vs'+n);
    const vi=document.getElementById('vi'+n);
    if (vs) vs.classList.add('show');
    if (vi) { vi.className='vi spin'; vi.textContent=''; }
    await ms(dur);
    if (vi) { vi.className='vi ok'; vi.textContent='✓'; }
    if (vs) vs.classList.add('done');
  }

  await ms(400);
  if (verifyEl) verifyEl.style.display='none';
  if (successWrap) successWrap.classList.add('on');
  if (step2) step2.classList.add('done-block');
  
  if (status) {
    status.textContent='✓ Skickat';
    status.className='step-status pass';
  }

  const barFill = document.getElementById('bar-fill');
  const overallPct = document.getElementById('overall-pct');
  if (barFill) { barFill.style.width='100%'; barFill.classList.add('green'); }
  if (overallPct) { overallPct.textContent='✓'; overallPct.classList.add('green'); }

  try { localStorage.removeItem(LS_KEY); } catch(e){}
  saveProgress();
}

// ══════════════════════════════
// INIT
// ══════════════════════════════
function init() {
  // Optional: restore progress on load
  const restored = loadProgress();
  if (restored) {
    // Show restore banner
    const banner = document.getElementById('restoreBanner');
    if (banner) banner.classList.add('show');
  }
}

// Call init on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
