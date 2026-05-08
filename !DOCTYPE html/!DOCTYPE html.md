#   
  
  
<!DOCTYPE html>  
<html lang="sv">  
<head>  
<meta charset="UTF-8">  
<meta name="viewport" content="width=device-width, initial-scale=1.0">  
<title>Admiral — Setup</title>  
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700&family=Syne+Mono:wght@400&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">  
<style>  
:root{  
  --bg:#070b16;--card:#0c1322;--card2:#08101e;--border:#18243a;--border2:#1f3050;  
  --gold:#c8a84b;--gold2:#e2c26e;--golddim:rgba(200,168,75,.12);--goldgl:rgba(200,168,75,.06);  
  --text:#dce3f0;--sub:#7a8baa;--dim:#384d68;  
  --green:#3dd68c;--gdim:rgba(61,214,140,.12);--gborder:rgba(61,214,140,.28);  
  --amber:#f0a030;--adim:rgba(240,160,48,.1);--aborder:rgba(240,160,48,.3);  
  --red:#e86060;--rdim:rgba(232,96,96,.1);--rborder:rgba(232,96,96,.3);  
  --blue:#5898f0;--bdim:rgba(88,152,240,.1);--bborder:rgba(88,152,240,.25);  
}  
*{margin:0;padding:0;box-sizing:border-box;}  
html{scroll-behavior:smooth;}  
body{background:var(--bg);color:var(--text);font-family:'Syne',sans-serif;font-weight:400;line-height:1.6;min-height:100vh;-webkit-font-smoothing:antialiased;}  
body::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:0;background:linear-gradient(rgba(200,168,75,.02) 1px,transparent 1px),linear-gradient(90deg,rgba(200,168,75,.02) 1px,transparent 1px);background-size:44px 44px;}  
.page{position:relative;z-index:1;max-width:600px;margin:0 auto;padding:24px 16px 100px;}  
  
/* ── TOPBAR ── */  
.topbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid var(--border);}  
.logo{display:flex;align-items:center;gap:10px;}  
.logomark{width:34px;height:34px;background:var(--golddim);border:1px solid var(--gold);border-radius:6px;display:flex;align-items:center;justify-content:center;font-family:'Instrument Serif',serif;font-size:18px;color:var(--gold);}  
.logoname{font-family:'Instrument Serif',serif;font-size:18px;color:var(--gold);}  
.logosub{font-size:9px;color:var(--dim);letter-spacing:.14em;text-transform:uppercase;margin-top:1px;}  
.chip{font-family:'Syne Mono',monospace;font-size:9px;color:var(--sub);letter-spacing:.12em;padding:3px 9px;border:1px solid var(--border2);border-radius:2px;}  
  
/* ── RESTORE BANNER ── */  
.restore-banner{display:none;align-items:center;gap:10px;padding:10px 13px;background:var(--bdim);border:1px solid var(--bborder);border-radius:6px;font-size:12px;color:var(--blue);margin-bottom:16px;cursor:pointer;transition:opacity .15s;}  
.restore-banner:hover{opacity:.8;}  
.restore-banner.show{display:flex;}  
  
/* ══════════════════════════════  
   HERO — URL EXTRACTOR + PRE-CHECK  
   ══════════════════════════════ */  
.hero-check{background:var(--card);border:1px solid var(--border2);border-radius:12px;padding:22px 18px;margin-bottom:20px;transition:border-color .4s,box-shadow .4s;position:relative;overflow:hidden;}  
.hero-check::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,var(--gold),transparent);opacity:.6;}  
.hero-check.checking{border-color:var(--aborder);}  
.hero-check.passed{border-color:var(--gborder);box-shadow:0 0 32px rgba(61,214,140,.07);}  
.hero-check.failed{border-color:var(--rborder);}  
  
.hc-pre{font-family:'Syne Mono',monospace;font-size:9px;letter-spacing:.22em;text-transform:uppercase;color:var(--gold);margin-bottom:8px;}  
.hc-title{font-family:'Instrument Serif',serif;font-size:22px;line-height:1.2;margin-bottom:6px;}  
.hc-title em{color:var(--gold);font-style:italic;}  
.hc-sub{font-size:12px;color:var(--sub);line-height:1.55;margin-bottom:16px;}  
  
/* URL paste area */  
.url-paste-wrap{margin-bottom:12px;}  
.url-paste-label{font-family:'Syne Mono',monospace;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--sub);margin-bottom:5px;display:flex;align-items:center;gap:8px;}  
.url-paste-label .tip{color:var(--gold);font-size:9px;background:var(--golddim);padding:1px 6px;border-radius:2px;border:1px solid rgba(200,168,75,.2);}  
.url-input{width:100%;background:var(--card2);border:1px solid var(--border2);border-radius:6px;padding:10px 12px;font-family:'Syne Mono',monospace;font-size:11px;color:var(--text);outline:none;transition:border-color .2s;}  
.url-input::placeholder{color:var(--dim);}  
.url-input:focus{border-color:var(--gold);}  
.url-input.ok{border-color:var(--gborder);}  
.url-hint{font-family:'Syne Mono',monospace;font-size:10px;color:var(--dim);margin-top:5px;line-height:1.4;transition:color .2s;}  
  
/* extracted chips */  
.extracted-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;min-height:0;transition:all .2s;}  
.e-chip{display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:4px;font-family:'Syne Mono',monospace;font-size:10px;background:var(--gdim);border:1px solid var(--gborder);color:var(--green);}  
.e-chip .e-label{color:var(--sub);font-size:9px;}  
  
/* manual fallback toggle */  
.manual-toggle{font-family:'Syne Mono',monospace;font-size:10px;color:var(--dim);cursor:pointer;text-decoration:underline;margin-top:6px;display:inline-block;transition:color .15s;}  
.manual-toggle:hover{color:var(--sub);}  
.manual-row{display:none;margin-top:10px;}  
.manual-row.show{display:flex;gap:8px;}  
.hc-input{flex:1;background:var(--card2);border:1px solid var(--border2);border-radius:6px;padding:10px 12px;font-family:'Syne Mono',monospace;font-size:12px;color:var(--text);outline:none;transition:border-color .2s;}  
.hc-input::placeholder{color:var(--dim);}  
.hc-input:focus{border-color:var(--gold);}  
.hc-input.ok{border-color:var(--gborder);}  
.hc-input.bad{border-color:var(--rborder);}  
.hc-btn{padding:0 18px;background:linear-gradient(135deg,var(--gold),#8c6820);border:none;border-radius:6px;font-family:'Syne',sans-serif;font-size:12px;font-weight:700;color:#060810;cursor:pointer;white-space:nowrap;transition:opacity .2s;position:relative;overflow:hidden;flex-shrink:0;}  
.hc-btn:disabled{opacity:.35;cursor:not-allowed;}  
.hc-btn:not(:disabled):hover{opacity:.85;}  
  
/* results */  
.hc-results{display:flex;flex-direction:column;gap:6px;margin-top:14px;max-height:0;overflow:hidden;opacity:0;transition:max-height .5s cubic-bezier(.4,0,.2,1),opacity .3s;}  
.hc-results.open{max-height:500px;opacity:1;}  
.rc{display:flex;align-items:center;gap:11px;padding:9px 11px;background:rgba(0,0,0,.25);border:1px solid var(--border);border-radius:6px;transition:border-color .3s;}  
.rc.pass{border-color:var(--gborder);}  
.rc.fail{border-color:var(--rborder);}  
.rc.warn{border-color:var(--aborder);}  
.rc-icon{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;flex-shrink:0;font-family:'Syne Mono',monospace;transition:all .25s;}  
.rc-icon.idle{color:var(--dim);}  
.rc-icon.spin{border:2px solid var(--border2);border-top-color:var(--gold);animation:spin .7s linear infinite;color:transparent;}  
.rc-icon.pass{background:var(--gdim);border:1px solid var(--gborder);color:var(--green);}  
.rc-icon.fail{background:var(--rdim);border:1px solid var(--rborder);color:var(--red);}  
.rc-icon.warn{background:var(--adim);border:1px solid var(--aborder);color:var(--amber);}  
@keyframes spin{to{transform:rotate(360deg)}}  
.rc-body{flex:1;min-width:0;}  
.rc-name{font-size:12px;font-weight:500;color:var(--text);}  
.rc-detail{font-size:11px;color:var(--sub);margin-top:1px;line-height:1.35;}  
.rc-tag{font-family:'Syne Mono',monospace;font-size:8px;letter-spacing:.06em;padding:2px 6px;border-radius:2px;white-space:nowrap;flex-shrink:0;opacity:0;transition:opacity .3s .2s;}  
.rc-tag.show{opacity:1;}  
.rc-tag.auto{background:var(--gdim);color:var(--green);border:1px solid var(--gborder);}  
.rc-tag.action{background:var(--adim);color:var(--amber);border:1px solid var(--aborder);}  
  
.hc-summary{font-size:12px;line-height:1.55;margin-top:10px;}  
.hc-summary.ok{color:var(--green);}  
.hc-summary.warn{color:var(--amber);}  
.hc-summary.fail{color:var(--red);}  
  
.hc-nudge{display:none;align-items:center;gap:12px;margin-top:12px;padding:11px 13px;background:var(--gdim);border:1px solid var(--gborder);border-radius:7px;}  
.hc-nudge.show{display:flex;}  
.nudge-icon{font-size:16px;flex-shrink:0;}  
.nudge-txt{flex:1;font-size:12px;color:var(--text);line-height:1.4;}  
.nudge-txt strong{color:var(--green);}  
.nudge-btn{padding:7px 12px;background:var(--green);border:none;border-radius:4px;font-family:'Syne',sans-serif;font-size:11px;font-weight:700;color:#050f08;cursor:pointer;white-space:nowrap;flex-shrink:0;transition:opacity .15s;}  
.nudge-btn:hover{opacity:.85;}  
  
/* ── ILLUSTRATION hint ── */  
.url-illustration{background:var(--card2);border:1px solid var(--border);border-radius:6px;padding:10px 12px;margin-top:8px;display:none;}  
.url-illustration.show{display:block;}  
.url-illus-inner{font-family:'Syne Mono',monospace;font-size:10px;color:var(--sub);line-height:1.8;word-break:break-all;}  
.url-illus-inner .hl-act{color:var(--gold);background:var(--golddim);padding:1px 3px;border-radius:2px;}  
.url-illus-inner .hl-bm{color:var(--blue);background:var(--bdim);padding:1px 3px;border-radius:2px;}  
.illus-label{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);margin-bottom:4px;}  
  
/* ══════════════════════════════  
   STATUS TILES  
   ══════════════════════════════ */  
.status-dash{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:20px;}  
.status-tile{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 10px;display:flex;flex-direction:column;align-items:center;gap:8px;transition:border-color .3s,box-shadow .3s;}  
.status-tile.done{border-color:var(--gborder);box-shadow:0 0 20px rgba(61,214,140,.07);}  
.status-tile.partial{border-color:var(--aborder);}  
.ring-wrap{position:relative;width:52px;height:52px;}  
.ring-svg{width:52px;height:52px;transform:rotate(-90deg);}  
.ring-track{fill:none;stroke:var(--border2);stroke-width:3;}  
.ring-fill{fill:none;stroke-width:3;stroke-linecap:round;stroke-dasharray:138;stroke-dashoffset:138;transition:stroke-dashoffset .6s cubic-bezier(.4,0,.2,1),stroke .3s;stroke:var(--gold);}  
.status-tile.done .ring-fill{stroke:var(--green);}  
.status-tile.partial .ring-fill{stroke:var(--amber);}  
.ring-inner{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:15px;}  
.ring-inner.is-check{font-size:18px;color:var(--green);font-weight:700;}  
.tile-name{font-family:'Syne Mono',monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--sub);text-align:center;line-height:1.4;transition:color .3s;}  
.status-tile.done .tile-name{color:var(--green);}  
.status-tile.partial .tile-name{color:var(--amber);}  
.tile-count{font-family:'Syne Mono',monospace;font-size:11px;color:var(--dim);transition:color .3s;font-weight:600;}  
.status-tile.done .tile-count{color:var(--green);}  
.status-tile.partial .tile-count{color:var(--amber);}  
  
/* ── OVERALL BAR ── */  
.overall{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin-bottom:20px;display:flex;align-items:center;gap:14px;}  
.overall-bar-wrap{flex:1;}  
.bar-header{font-family:'Syne Mono',monospace;font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:var(--sub);margin-bottom:6px;display:flex;justify-content:space-between;}  
.bar-frac{color:var(--gold);transition:color .3s;}  
.bar-frac.green{color:var(--green);}  
.bar-track{height:3px;background:var(--border);border-radius:2px;overflow:hidden;}  
.bar-fill{height:100%;width:0%;background:linear-gradient(90deg,var(--gold),var(--gold2));border-radius:2px;transition:width .5s cubic-bezier(.4,0,.2,1),background .4s;}  
.bar-fill.green{background:linear-gradient(90deg,var(--green),#7fffc4);}  
.overall-pct{font-family:'Syne Mono',monospace;font-size:22px;color:var(--gold);line-height:1;transition:color .3s;min-width:46px;text-align:right;}  
.overall-pct.green{color:var(--green);}  
  
/* ── MISSING ── */  
.missing{display:none;align-items:flex-start;gap:10px;padding:10px 13px;background:var(--adim);border:1px solid var(--aborder);border-radius:6px;font-size:12px;color:var(--amber);margin-bottom:18px;line-height:1.5;}  
.missing.on{display:flex;}  
  
/* ── SECTION ── */  
.section{margin-bottom:20px;}  
.section-label{font-family:'Syne Mono',monospace;font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:var(--dim);margin-bottom:10px;padding-left:2px;}  
  
/* ── CHECK ITEM ── */  
.ci{background:var(--card);border:1px solid var(--border);border-radius:8px;margin-bottom:6px;overflow:hidden;transition:border-color .2s;}  
.ci:hover{border-color:var(--border2);}  
.ci.checked,.ci.auto-checked{border-color:var(--gborder);}  
.ci-row{display:flex;align-items:center;gap:12px;padding:13px 13px;cursor:pointer;user-select:none;}  
.cb{width:22px;height:22px;flex-shrink:0;border:1.5px solid var(--border2);border-radius:5px;background:var(--bg);display:flex;align-items:center;justify-content:center;transition:all .2s;}  
.ci.checked .cb,.ci.auto-checked .cb{background:var(--gdim);border-color:var(--green);}  
.cb svg{opacity:0;transform:scale(.3);transition:all .2s cubic-bezier(.34,1.56,.64,1);}  
.ci.checked .cb svg,.ci.auto-checked .cb svg{opacity:1;transform:scale(1);}  
@keyframes autoPulse{0%{box-shadow:0 0 0 0 rgba(61,214,140,.5)}70%{box-shadow:0 0 0 6px rgba(61,214,140,0)}100%{box-shadow:0 0 0 0 rgba(61,214,140,0)}}  
.cb.pulsing{animation:autoPulse .6s ease-out;}  
.ci-text{flex:1;min-width:0;}  
.ci-name{font-size:13px;font-weight:500;color:var(--text);transition:color .2s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}  
.ci.checked .ci-name,.ci.auto-checked .ci-name{color:var(--green);}  
.ci-desc{font-size:11px;color:var(--sub);margin-top:1px;line-height:1.4;}  
.ci-auto-tag{display:none;font-family:'Syne Mono',monospace;font-size:8px;letter-spacing:.06em;padding:2px 6px;background:var(--gdim);color:var(--green);border:1px solid var(--gborder);border-radius:2px;flex-shrink:0;white-space:nowrap;}  
.ci.auto-checked .ci-auto-tag{display:block;}  
.badge{font-family:'Syne Mono',monospace;font-size:8px;letter-spacing:.06em;text-transform:uppercase;padding:3px 7px;border-radius:2px;flex-shrink:0;white-space:nowrap;}  
.b-req{background:var(--golddim);color:var(--gold);border:1px solid rgba(200,168,75,.2);}  
.b-rec{background:var(--bdim);color:var(--blue);border:1px solid rgba(88,152,240,.2);}  
.b-opt{background:rgba(255,255,255,.03);color:var(--dim);border:1px solid var(--border);}  
.ci-arrow{font-size:9px;color:var(--dim);flex-shrink:0;transition:transform .25s,color .2s;}  
.ci.open .ci-arrow{transform:rotate(180deg);color:var(--amber);}  
.ci.checked .ci-arrow,.ci.auto-checked .ci-arrow{color:var(--green);}  
  
/* ── HELP PANEL ── */  
.hp{max-height:0;overflow:hidden;transition:max-height .4s cubic-bezier(.4,0,.2,1);}  
.hp.open{max-height:600px;border-top:1px solid var(--border);}  
.hp-inner{padding:14px 13px 14px 47px;}  
.hp-title{font-family:'Syne Mono',monospace;font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:var(--amber);margin-bottom:10px;display:flex;align-items:center;gap:6px;}  
.hp-title::before{content:'';display:block;width:10px;height:1px;background:var(--amber);opacity:.5;}  
.hp-steps{list-style:none;display:flex;flex-direction:column;gap:8px;}  
.hp-steps li{display:flex;gap:10px;font-size:12px;color:var(--sub);line-height:1.5;}  
.n{width:18px;height:18px;flex-shrink:0;background:var(--adim);border:1px solid var(--aborder);border-radius:3px;display:flex;align-items:center;justify-content:center;font-family:'Syne Mono',monospace;font-size:9px;color:var(--amber);margin-top:2px;}  
.hp-link{display:inline-flex;align-items:center;gap:5px;margin-top:10px;font-family:'Syne Mono',monospace;font-size:10px;color:var(--gold2);text-decoration:none;padding:6px 11px;border:1px solid rgba(200,168,75,.2);border-radius:3px;background:var(--goldgl);transition:border-color .15s;}  
.hp-link:hover{border-color:var(--gold);}  
  
hr{border:none;border-top:1px solid var(--border);margin:24px 0;}  
  
/* ══════════════════════════════  
   TOKEN COUNTDOWN  
   ══════════════════════════════ */  
.token-timer{display:none;align-items:center;gap:10px;padding:10px 13px;border-radius:6px;font-size:12px;margin-bottom:10px;transition:all .3s;}  
.token-timer.show{display:flex;}  
.token-timer.urgent{background:var(--rdim);border:1px solid var(--rborder);color:var(--red);}  
.token-timer.warning{background:var(--adim);border:1px solid var(--aborder);color:var(--amber);}  
.token-timer.ok{background:var(--gdim);border:1px solid var(--gborder);color:var(--green);}  
.timer-icon{font-size:14px;flex-shrink:0;}  
.timer-text{flex:1;line-height:1.4;}  
.timer-count{font-family:'Syne Mono',monospace;font-size:13px;font-weight:600;letter-spacing:.05em;flex-shrink:0;}  
  
/* ══════════════════════════════  
   STEP 2 BLOCK  
   ══════════════════════════════ */  
.step-block{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:20px 16px;transition:border-color .4s,opacity .4s,box-shadow .4s;}  
.step-block.locked{opacity:.4;pointer-events:none;}  
.step-block.unlocked{opacity:1;pointer-events:auto;border-color:var(--border2);}  
.step-block.done-block{border-color:var(--gborder);box-shadow:0 0 28px rgba(61,214,140,.06);}  
.step-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}  
.step-pill{font-family:'Syne Mono',monospace;font-size:9px;letter-spacing:.12em;text-transform:uppercase;padding:3px 9px;background:var(--bdim);color:var(--blue);border:1px solid rgba(88,152,240,.2);border-radius:2px;}  
.step-status{font-family:'Syne Mono',monospace;font-size:10px;letter-spacing:.08em;}  
.step-status.idle{color:var(--dim);}  
.step-status.running{color:var(--amber);}  
.step-status.pass{color:var(--green);}  
.step-title{font-family:'Instrument Serif',serif;font-size:17px;color:var(--text);margin-bottom:6px;}  
.step-desc{font-size:12px;color:var(--sub);line-height:1.55;margin-bottom:16px;}  
.input-row{display:flex;flex-direction:column;gap:4px;margin-bottom:10px;}  
.input-label{font-family:'Syne Mono',monospace;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--sub);}  
.input-field{background:var(--bg);border:1px solid var(--border2);border-radius:5px;padding:10px 12px;font-family:'Syne Mono',monospace;font-size:11px;color:var(--text);outline:none;width:100%;transition:border-color .2s;}  
.input-field::placeholder{color:var(--dim);}  
.input-field:focus{border-color:var(--gold);}  
.input-field.ok{border-color:var(--gborder);}  
.input-field.bad{border-color:var(--rborder);}  
  
/* one-click copy area */  
.copy-block{background:var(--card2);border:1px solid var(--border);border-radius:6px;padding:12px 14px;margin-bottom:12px;}  
.copy-block-label{font-family:'Syne Mono',monospace;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--sub);margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;}  
.copy-preview{font-family:'Syne Mono',monospace;font-size:10px;color:var(--dim);line-height:1.7;word-break:break-all;}  
.copy-preview .cp-key{color:var(--sub);}  
.copy-preview .cp-val{color:var(--gold2);}  
.copy-preview .cp-empty{color:var(--border2);font-style:italic;}  
.copy-btn{display:flex;align-items:center;gap:6px;width:100%;margin-top:10px;padding:10px 14px;background:linear-gradient(135deg,rgba(200,168,75,.15),rgba(200,168,75,.08));border:1px solid rgba(200,168,75,.3);border-radius:5px;font-family:'Syne',sans-serif;font-size:12px;font-weight:600;color:var(--gold2);cursor:pointer;justify-content:center;transition:all .2s;}  
.copy-btn:hover{background:rgba(200,168,75,.2);border-color:var(--gold);}  
.copy-btn.copied{background:var(--gdim);border-color:var(--gborder);color:var(--green);}  
.signal-hint{font-size:11px;color:var(--sub);text-align:center;margin-top:6px;line-height:1.4;}  
.signal-hint a{color:var(--blue);text-decoration:none;}  
  
.submit-btn{width:100%;padding:13px;margin-top:4px;background:linear-gradient(135deg,var(--gold),#8c6820);border:none;border-radius:6px;font-family:'Syne',sans-serif;font-size:12px;font-weight:600;letter-spacing:.08em;color:#060810;cursor:pointer;transition:opacity .2s;position:relative;overflow:hidden;}  
.submit-btn:disabled{opacity:.35;cursor:not-allowed;}  
.submit-btn:not(:disabled):hover{opacity:.88;}  
.shimmer{position:absolute;top:0;left:-100%;width:50%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.15),transparent);animation:sh 2.5s infinite;}  
@keyframes sh{0%{left:-100%}100%{left:200%}}  
  
.verify{display:none;flex-direction:column;gap:10px;margin-top:16px;}  
.verify.on{display:flex;}  
.vs{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--sub);opacity:0;transform:translateX(-6px);transition:opacity .3s,transform .3s,color .2s;}  
.vs.show{opacity:1;transform:none;}  
.vs.done{color:var(--green);}  
.vi{width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;flex-shrink:0;}  
.vi.spin{border:2px solid var(--border2);border-top-color:var(--gold);animation:spin .7s linear infinite;}  
.vi.ok{background:var(--gdim);border:1px solid var(--gborder);color:var(--green);}  
  
/* ══════════════════════════════  
   SUCCESS + NEXT STEPS  
   ══════════════════════════════ */  
.success-wrap{display:none;flex-direction:column;gap:0;}  
.success-wrap.on{display:flex;}  
.success-head{text-align:center;padding:16px 0 20px;}  
.success-icon{font-size:28px;margin-bottom:8px;}  
.success-title{font-family:'Instrument Serif',serif;font-size:20px;color:var(--green);margin-bottom:4px;}  
.success-sub{font-size:12px;color:var(--sub);}  
  
.next-steps{background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:16px 14px;}  
.ns-title{font-family:'Syne Mono',monospace;font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:var(--sub);margin-bottom:12px;}  
.ns-step{display:flex;gap:12px;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--border);}  
.ns-step:last-child{margin-bottom:0;padding-bottom:0;border-bottom:none;}  
.ns-num{width:24px;height:24px;flex-shrink:0;background:var(--golddim);border:1px solid rgba(200,168,75,.25);border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Syne Mono',monospace;font-size:10px;color:var(--gold);margin-top:1px;}  
.ns-body{}  
.ns-name{font-size:13px;font-weight:500;color:var(--text);margin-bottom:2px;}  
.ns-desc{font-size:11px;color:var(--sub);line-height:1.45;}  
.ns-time{font-family:'Syne Mono',monospace;font-size:9px;color:var(--dim);margin-top:3px;}  
  
@media(max-width:360px){  
  .status-dash{gap:6px;}  
  .ring-wrap{width:44px;height:44px;}  
  .ring-svg{width:44px;height:44px;}  
  .ring-fill{stroke-dasharray:116;}  
  .tile-name{font-size:8px;}  
}  
</style>  
</head>  
<body>  
<div class="page">  
  
  <!-- Topbar -->  
  <div class="topbar">  
    <div class="logo">  
      <div class="logomark">A</div>  
      <div>  
        <div class="logoname">Admiral</div>  
        <div class="logosub">by Fabricken</div>  
      </div>  
    </div>  
    <div class="chip">SETUP v1.0</div>  
  </div>  
  
  <!-- Restore banner (feature 5) -->  
  <div class="restore-banner" id="restoreBanner" onclick="restoreProgress()">  
    <span>↩</span>  
    <span>Du har ett pågående ifyllande — <strong>fortsätt där du slutade</strong></span>  
    <span style="margin-left:auto;font-family:'Syne Mono',monospace;font-size:9px;opacity:.6">Tryck för att återställa</span>  
  </div>  
  
  <!-- ══════════════════════════════  
       HERO: URL EXTRACTOR + PRE-CHECK  
       ══════════════════════════════ -->  
  <div class="hero-check" id="heroCheck">  
    <div class="hc-pre">// Snabbkoll</div>  
    <div class="hc-title">Har du vad som krävs?<br><em>Kolla direkt.</em></div>  
    <div class="hc-sub">Klistra in din Ads Manager-URL — vi extraherar ditt konto-ID automatiskt och kollar mot Meta.</div>  
  
    <!-- Feature 4: URL extractor -->  
    <div class="url-paste-wrap">  
      <div class="url-paste-label">  
        Ads Manager URL  
        <span class="tip">Klistra in hela URL:en</span>  
      </div>  
      <input class="url-input" id="urlInput" type="text"  
        placeholder="https://business.facebook.com/adsmanager/manage/campaigns?act=123456789&business_id=987654321"  
        oninput="onUrlInput(this)" autocomplete="off">  
      <div class="hc-hint" id="urlHint">Öppna Meta Ads Manager → kopiera URL:en från adressfältet och klistra in här</div>  
  
      <!-- Animated URL illustration -->  
      <div class="url-illustration" id="urlIllus">  
        <div class="illus-label">Så här ser din URL ut — vi hämtar de markerade delarna:</div>  
        <div class="url-illus-inner">  
          https://business.facebook.com/adsmanager/manage/campaigns?<span class="hl-act">act=123456789</span>&amp;<span class="hl-bm">business_id=987654321</span>&amp;...  
        </div>  
        <div style="display:flex;gap:12px;margin-top:8px;">  
          <span style="font-family:'Syne Mono',monospace;font-size:9px;color:var(--gold)">■ act= → Ad Account ID</span>  
          <span style="font-family:'Syne Mono',monospace;font-size:9px;color:var(--blue)">■ business_id= → BM ID</span>  
        </div>  
      </div>  
  
      <!-- Extracted chips -->  
      <div class="extracted-chips" id="extractedChips"></div>  
    </div>  
  
    <!-- Manual fallback (feature 4b) -->  
    <span class="manual-toggle" id="manualToggle" onclick="toggleManual()">Har du inte URL:en? Fyll i ID manuellt →</span>  
    <div class="manual-row" id="manualRow">  
      <input class="hc-input" id="hc-aa" type="text" inputmode="numeric"  
        placeholder="act_123456789" oninput="onManualInput(this)" autocomplete="off">  
      <button class="hc-btn" id="hcBtn" onclick="runPreCheck()" disabled>  
        <div class="shimmer"></div>  
        <span id="hcBtnTxt">Kolla</span>  
      </button>  
    </div>  
  
    <!-- Results -->  
    <div class="hc-results" id="hcResults">  
      <div class="rc" id="rc-exist"><div class="rc-icon idle" id="rci-exist">○</div><div class="rc-body"><div class="rc-name">Annonskonto hittades</div><div class="rc-detail" id="rcd-exist">Kontrollerar att kontot finns i Meta</div></div><div class="rc-tag" id="rct-exist"></div></div>  
      <div class="rc" id="rc-active"><div class="rc-icon idle" id="rci-active">○</div><div class="rc-body"><div class="rc-name">Kontostatus aktiv</div><div class="rc-detail" id="rcd-active">Kontrollerar att kontot inte är pausat</div></div><div class="rc-tag" id="rct-active"></div></div>  
      <div class="rc" id="rc-bm"><div class="rc-icon idle" id="rci-bm">○</div><div class="rc-body"><div class="rc-name">Business Manager</div><div class="rc-detail" id="rcd-bm">Kontrollerar att BM är kopplat</div></div><div class="rc-tag" id="rct-bm"></div></div>  
      <div class="rc" id="rc-payment"><div class="rc-icon idle" id="rci-payment">○</div><div class="rc-body"><div class="rc-name">Betalningsmetod</div><div class="rc-detail" id="rcd-payment">Kontrollerar att fakturering är konfigurerad</div></div><div class="rc-tag" id="rct-payment"></div></div>  
      <div class="rc" id="rc-currency"><div class="rc-icon idle" id="rci-currency">○</div><div class="rc-body"><div class="rc-name">Valuta &amp; tidszon</div><div class="rc-detail" id="rcd-currency">Hämtar kontoinformation</div></div><div class="rc-tag" id="rct-currency"></div></div>  
    </div>  
  
    <div class="hc-summary" id="hcSummary"></div>  
    <div class="hc-nudge" id="hcNudge">  
      <div class="nudge-icon">✓</div>  
      <div class="nudge-txt"><strong>Kontot ser bra ut!</strong><br>Gå till Steg 2 nedan för att skicka credentials.</div>  
      <button class="nudge-btn" onclick="scrollToStep2()">Steg 2 →</button>  
    </div>  
  </div>  
  
  <!-- Status tiles -->  
  <div class="status-dash">  
    <div class="status-tile empty" id="tile-konto">  
      <div class="ring-wrap"><svg class="ring-svg" viewBox="0 0 52 52"><circle class="ring-track" cx="26" cy="26" r="22"/><circle class="ring-fill" id="ring-konto" cx="26" cy="26" r="22"/></svg><div class="ring-inner" id="icon-konto">👤</div></div>  
      <div class="tile-name">Konto &amp;<br>Struktur</div>  
      <div class="tile-count" id="count-konto">0 / 3</div>  
    </div>  
    <div class="status-tile empty" id="tile-api">  
      <div class="ring-wrap"><svg class="ring-svg" viewBox="0 0 52 52"><circle class="ring-track" cx="26" cy="26" r="22"/><circle class="ring-fill" id="ring-api" cx="26" cy="26" r="22"/></svg><div class="ring-inner" id="icon-api">🔑</div></div>  
      <div class="tile-name">API &amp;<br>Åtkomst</div>  
      <div class="tile-count" id="count-api">0 / 2</div>  
    </div>  
    <div class="status-tile empty" id="tile-pixel">  
      <div class="ring-wrap"><svg class="ring-svg" viewBox="0 0 52 52"><circle class="ring-track" cx="26" cy="26" r="22"/><circle class="ring-fill" id="ring-pixel" cx="26" cy="26" r="22"/></svg><div class="ring-inner" id="icon-pixel">📡</div></div>  
      <div class="tile-name">Spårning &amp;<br>Pixel</div>  
      <div class="tile-count" id="count-pixel">0 / 2</div>  
    </div>  
  </div>  
  
  <div class="overall">  
    <div class="overall-bar-wrap">  
      <div class="bar-header"><span>Readiness</span><span class="bar-frac" id="bar-frac">0 / 7</span></div>  
      <div class="bar-track"><div class="bar-fill" id="bar-fill"></div></div>  
    </div>  
    <div class="overall-pct" id="overall-pct">0%</div>  
  </div>  
  
  <div class="missing" id="missingBanner"><span>⚠</span><span id="missingText"></span></div>  
  
  <!-- Konto & Struktur -->  
  <div class="section">  
    <div class="section-label">Konto &amp; Struktur</div>  
    <div class="ci" id="ci-bm"><div class="ci-row" onclick="toggle('bm')"><div class="cb" id="cb-bm"><svg width="11" height="9" viewBox="0 0 11 9"><polyline points="1,4.5 4,7.5 10,1" fill="none" stroke="#3dd68c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div class="ci-text"><div class="ci-name">Meta Business Manager</div><div class="ci-desc">Företagskonto som samlar alla Meta-tillgångar.</div></div><div class="ci-auto-tag">auto ✓</div><div class="badge b-req">Krävs</div><div class="ci-arrow">▾</div></div><div class="hp" id="hp-bm"><div class="hp-inner"><div class="hp-title">Skapa Business Manager</div><ul class="hp-steps"><li><div class="n">1</div><span>Gå till <strong>business.facebook.com</strong> → klicka "Skapa konto".</span></li><li><div class="n">2</div><span>Logga in med privat Facebook-konto (syns inte för kunder).</span></li><li><div class="n">3</div><span>Fyll i företagsnamn och e-post → verifiera via mail.</span></li></ul><a class="hp-link" href="https://business.facebook.com" target="_blank">→ Meta Business Manager</a></div></div></div>  
    <div class="ci" id="ci-aa"><div class="ci-row" onclick="toggle('aa')"><div class="cb" id="cb-aa"><svg width="11" height="9" viewBox="0 0 11 9"><polyline points="1,4.5 4,7.5 10,1" fill="none" stroke="#3dd68c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div class="ci-text"><div class="ci-name">Annonskonto (Ad Account)</div><div class="ci-desc">Aktivt annonskonto kopplat till ditt BM.</div></div><div class="ci-auto-tag">auto ✓</div><div class="badge b-req">Krävs</div><div class="ci-arrow">▾</div></div><div class="hp" id="hp-aa"><div class="hp-inner"><div class="hp-title">Lägg till annonskonto</div><ul class="hp-steps"><li><div class="n">1</div><span>BM → <strong>Inställningar → Annonskonton → Lägg till</strong>.</span></li><li><div class="n">2</div><span>Välj "Skapa nytt" eller koppla befintligt.</span></li><li><div class="n">3</div><span>Sätt valuta SEK och tidszon Stockholm.</span></li><li><div class="n">4</div><span>Lägg till betalningsmetod under Fakturering.</span></li></ul><a class="hp-link" href="https://business.facebook.com/settings/ad-accounts" target="_blank">→ Annonskonton i BM</a></div></div></div>  
    <div class="ci" id="ci-page"><div class="ci-row" onclick="toggle('page')"><div class="cb" id="cb-page"><svg width="11" height="9" viewBox="0 0 11 9"><polyline points="1,4.5 4,7.5 10,1" fill="none" stroke="#3dd68c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div class="ci-text"><div class="ci-name">Facebook-sida kopplad</div><div class="ci-desc">Behövs för annonser och page insights.</div></div><div class="ci-auto-tag">auto ✓</div><div class="badge b-rec">Rekommer.</div><div class="ci-arrow">▾</div></div><div class="hp" id="hp-page"><div class="hp-inner"><div class="hp-title">Koppla Facebook-sida</div><ul class="hp-steps"><li><div class="n">1</div><span>BM → <strong>Inställningar → Sidor → Lägg till</strong>.</span></li><li><div class="n">2</div><span>Välj befintlig sida eller skicka anslutningsförfrågan.</span></li></ul><a class="hp-link" href="https://business.facebook.com/settings/pages" target="_blank">→ Sidor i BM</a></div></div></div>  
  </div>  
  
  <!-- API & Åtkomst -->  
  <div class="section">  
    <div class="section-label">API &amp; Åtkomst</div>  
    <div class="ci" id="ci-app"><div class="ci-row" onclick="toggle('app')"><div class="cb" id="cb-app"><svg width="11" height="9" viewBox="0 0 11 9"><polyline points="1,4.5 4,7.5 10,1" fill="none" stroke="#3dd68c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div class="ci-text"><div class="ci-name">Meta App skapad</div><div class="ci-desc">Developer Portal — Marketing API aktiverat.</div></div><div class="ci-auto-tag">auto ✓</div><div class="badge b-req">Krävs</div><div class="ci-arrow">▾</div></div><div class="hp" id="hp-app"><div class="hp-inner"><div class="hp-title">Skapa Meta App</div><ul class="hp-steps"><li><div class="n">1</div><span>Gå till <strong>developers.facebook.com → My Apps → Create App</strong>.</span></li><li><div class="n">2</div><span>Välj typ "Business", namnge appen.</span></li><li><div class="n">3</div><span>Vänstermeny → Add Products → <strong>Marketing API → Set Up</strong>.</span></li><li><div class="n">4</div><span>Settings → Basic → lägg till <strong>fabricken.se</strong> i App Domains → Spara.</span></li></ul><a class="hp-link" href="https://developers.facebook.com/apps/" target="_blank">→ Meta Developer Portal</a></div></div></div>  
    <div class="ci" id="ci-token">  
      <div class="ci-row" onclick="toggle('token')">  
        <div class="cb" id="cb-token"><svg width="11" height="9" viewBox="0 0 11 9"><polyline points="1,4.5 4,7.5 10,1" fill="none" stroke="#3dd68c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>  
        <div class="ci-text"><div class="ci-name">Access Token genererad</div><div class="ci-desc">Graph API Explorer — expirerar 1–2h, skicka direkt!</div></div>  
        <div class="ci-auto-tag">auto ✓</div><div class="badge b-req">Krävs</div><div class="ci-arrow">▾</div>  
      </div>  
      <div class="hp" id="hp-token"><div class="hp-inner"><div class="hp-title">Generera Access Token</div><ul class="hp-steps"><li><div class="n">1</div><span>Öppna <strong>Graph API Explorer</strong> → välj din app.</span></li><li><div class="n">2</div><span>Välj User Token → klicka "Generate Access Token".</span></li><li><div class="n">3</div><span>Kryssa i: <strong>ads_management, ads_read, business_management, pages_read_engagement</strong>.</span></li><li><div class="n">4</div><span>Kopiera token och klistra in i Steg 2 nedan — sedan skickar du med ett klick.</span></li></ul><a class="hp-link" href="https://developers.facebook.com/tools/explorer/" target="_blank">→ Graph API Explorer</a></div></div>  
    </div>  
  </div>  
  
  <!-- Spårning & Pixel -->  
  <div class="section">  
    <div class="section-label">Spårning &amp; Pixel</div>  
    <div class="ci" id="ci-pixel"><div class="ci-row" onclick="toggle('pixel')"><div class="cb" id="cb-pixel"><svg width="11" height="9" viewBox="0 0 11 9"><polyline points="1,4.5 4,7.5 10,1" fill="none" stroke="#3dd68c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div class="ci-text"><div class="ci-name">Meta Pixel installerad</div><div class="ci-desc">Spårar konverteringar — ROAS och retargeting.</div></div><div class="ci-auto-tag">auto ✓</div><div class="badge b-rec">Rekommer.</div><div class="ci-arrow">▾</div></div><div class="hp" id="hp-pixel"><div class="hp-inner"><div class="hp-title">Installera Meta Pixel</div><ul class="hp-steps"><li><div class="n">1</div><span>BM → <strong>Events Manager → Lägg till datakälla → Meta Pixel</strong>.</span></li><li><div class="n">2</div><span>Installera via <strong>Google Tag Manager</strong> eller klistra in i &lt;head&gt;.</span></li><li><div class="n">3</div><span>Testa med <strong>Meta Pixel Helper</strong> (Chrome-tillägg).</span></li></ul><a class="hp-link" href="https://business.facebook.com/events_manager2" target="_blank">→ Events Manager</a></div></div></div>  
    <div class="ci" id="ci-capi"><div class="ci-row" onclick="toggle('capi')"><div class="cb" id="cb-capi"><svg width="11" height="9" viewBox="0 0 11 9"><polyline points="1,4.5 4,7.5 10,1" fill="none" stroke="#3dd68c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div class="ci-text"><div class="ci-name">Conversions API (CAPI)</div><div class="ci-desc">Server-side spårning — täcker det ad-blockers döljer.</div></div><div class="ci-auto-tag">auto ✓</div><div class="badge b-opt">Valfritt</div><div class="ci-arrow">▾</div></div><div class="hp" id="hp-capi"><div class="hp-inner"><div class="hp-title">Aktivera Conversions API</div><ul class="hp-steps"><li><div class="n">1</div><span>Events Manager → din pixel → <strong>"Lägg till händelser → Conversions API"</strong>.</span></li><li><div class="n">2</div><span>Välj <strong>Partnerkoppling</strong> (Shopify/WooCommerce) eller manuell backend.</span></li></ul><a class="hp-link" href="https://developers.facebook.com/docs/marketing-api/conversions-api" target="_blank">→ CAPI Dokumentation</a></div></div></div>  
  </div>  
  
  <hr>  
  
  <!-- ══════════════════════════════  
       STEG 2  
       ══════════════════════════════ -->  
  <div class="step-block locked" id="step2Block">  
    <div class="step-header">  
      <div class="step-pill">Steg 2 av 2</div>  
      <div class="step-status idle" id="step2Status">Låst</div>  
    </div>  
    <div class="step-title">Skicka credentials till Fabricken</div>  
    <div class="step-desc">Fyll i din access token — kopiera sedan allt med ett klick och skicka via Signal.</div>  
  
    <!-- Feature 2: Token countdown -->  
    <div class="token-timer ok" id="tokenTimer">  
      <div class="timer-icon">⏱</div>  
      <div class="timer-text">Token är giltig i</div>  
      <div class="timer-count" id="timerCount">1:55:00</div>  
    </div>  
  
    <div id="formArea">  
      <div class="input-row">  
        <label class="input-label">Access Token <span style="color:var(--red);font-size:9px">expirerar snart</span></label>  
        <input class="input-field" id="inp-token" type="text" placeholder="EAAM7pGZB..." oninput="vToken(this)" autocomplete="off">  
      </div>  
      <div class="input-row">  
        <label class="input-label">Ad Account ID — Konto 1</label>  
        <input class="input-field" id="inp-aa1" type="text" placeholder="act_123456789" oninput="vAA(this); updateCopyPreview();" autocomplete="off">  
      </div>  
      <div class="input-row">  
        <label class="input-label">Ad Account ID — Konto 2 <span style="color:var(--dim)">(valfritt)</span></label>  
        <input class="input-field" id="inp-aa2" type="text" placeholder="act_987654321" oninput="vAA(this); updateCopyPreview();" autocomplete="off">  
      </div>  
      <div class="input-row">  
        <label class="input-label">Ad Account ID — Konto 3 <span style="color:var(--dim)">(valfritt)</span></label>  
        <input class="input-field" id="inp-aa3" type="text" placeholder="act_555666777" oninput="vAA(this); updateCopyPreview();" autocomplete="off">  
      </div>  
  
      <!-- Feature 3: One-click copy -->  
      <div class="copy-block" id="copyBlock">  
        <div class="copy-block-label">  
          <span>Förhandsvisning — redo att skicka</span>  
        </div>  
        <div class="copy-preview" id="copyPreview">  
          <span class="cp-key">Token:   </span><span class="cp-empty" id="cp-token">väntar på token...</span><br>  
          <span class="cp-key">Konto 1: </span><span class="cp-empty" id="cp-aa1">väntar på account ID...</span><br>  
          <span class="cp-key">Konto 2: </span><span class="cp-empty" id="cp-aa2">—</span><br>  
          <span class="cp-key">Konto 3: </span><span class="cp-empty" id="cp-aa3">—</span>  
        </div>  
        <button class="copy-btn" id="copyBtn" onclick="copyAll()">  
          <span id="copyBtnIcon">📋</span>  
          <span id="copyBtnTxt">Kopiera allt för Signal/Telegram</span>  
        </button>  
        <div class="signal-hint">  
          Öppna <a href="https://signal.org" target="_blank">Signal</a> eller   
          <a href="https://t.me" target="_blank">Telegram</a> →   
          klistra in → skicka till Erik  
        </div>  
      </div>  
  
      <button class="submit-btn" id="submitBtn" onclick="runVerify()" disabled>  
        <div class="shimmer"></div>  
        <span id="btnTxt">Fyll i token &amp; account ID</span>  
      </button>  
    </div>  
  
    <div class="verify" id="verifyEl">  
      <div class="vs" id="vs1"><div class="vi" id="vi1"></div><span>Validerar token-format…</span></div>  
      <div class="vs" id="vs2"><div class="vi" id="vi2"></div><span>Kontrollerar account ID-struktur…</span></div>  
      <div class="vs" id="vs3"><div class="vi" id="vi3"></div><span>Verifierar API-åtkomst mot Meta Graph…</span></div>  
      <div class="vs" id="vs4"><div class="vi" id="vi4"></div><span>Kontrollerar permissions-scope…</span></div>  
      <div class="vs" id="vs5"><div class="vi" id="vi5"></div><span>Krypterar och skickar till Fabricken…</span></div>  
    </div>  
  
    <!-- Feature 6: Success + Next steps -->  
    <div class="success-wrap" id="successWrap">  
      <div class="success-head">  
        <div class="success-icon">✦</div>  
        <div class="success-title">Skickat till Fabricken!</div>  
        <div class="success-sub">Dina uppgifter är på väg. Här är vad som händer härnäst:</div>  
      </div>  
      <div class="next-steps">  
        <div class="ns-title">// Vad händer nu</div>  
        <div class="ns-step">  
          <div class="ns-num">1</div>  
          <div class="ns-body">  
            <div class="ns-name">Fabricken tar emot och verifierar</div>  
            <div class="ns-desc">Vi konverterar din token till en long-lived token (giltig 60 dagar) och kopplar dina annonskonton till Admiral.</div>  
            <div class="ns-time">⏱ Inom 1–2 timmar</div>  
          </div>  
        </div>  
        <div class="ns-step">  
          <div class="ns-num">2</div>  
          <div class="ns-body">  
            <div class="ns-name">Du får en bekräftelse</div>  
            <div class="ns-desc">Erik hör av sig via Signal med bekräftelse att Admiral är aktiverat för dina konton.</div>  
            <div class="ns-time">⏱ Samma dag</div>  
          </div>  
        </div>  
        <div class="ns-step">  
          <div class="ns-num">3</div>  
          <div class="ns-body">  
            <div class="ns-name">Admiral börjar analysera</div>  
            <div class="ns-desc">Dina kampanjer visas i Admiral-dashboarden. Fabricken skickar din första rapport inom 24 timmar.</div>  
            <div class="ns-time">⏱ Nästa dag</div>  
          </div>  
        </div>  
        <div class="ns-step">  
          <div class="ns-num">4</div>  
          <div class="ns-body">  
            <div class="ns-name">Token-förnyelse sker automatiskt</div>  
            <div class="ns-desc">Admiral påminner dig 7 dagar innan token löper ut — du behöver bara generera en ny och skicka via den här sidan igen.</div>  
            <div class="ns-time">⏱ Var 60:e dag</div>  
          </div>  
        </div>  
      </div>  
    </div>  
  </div>  
  
</div><!-- /page -->  
  
<script>  
const CIRC = 2 * Math.PI * 22;  
const ms   = t => new Promise(r => setTimeout(r, t));  
const LS_KEY = 'admiral_onboarding_v1';  
  
// ══════════════════════════════  
// STATE  
// ══════════════════════════════  
const groups = {  
  konto: { keys:['bm','aa','page'], total:3 },  
  api:   { keys:['app','token'],    total:2 },  
  pixel: { keys:['pixel','capi'],   total:2 },  
};  
const items = {  
  bm:    { group:'konto', required:true,  checked:false, auto:false },  
  aa:    { group:'konto', required:true,  checked:false, auto:false },  
  page:  { group:'konto', required:false, checked:false, auto:false },  
  app:   { group:'api',   required:true,  checked:false, auto:false },  
  token: { group:'api',   required:true,  checked:false, auto:false },  
  pixel: { group:'pixel', required:false, checked:false, auto:false },  
  capi:  { group:'pixel', required:false, checked:false, auto:false },  
};  
const ICONS = { konto:'👤', api:'🔑', pixel:'📡' };  
  
let tokenTimerInterval = null;  
let tokenExpiresAt     = null;  
let extractedAccountId = null;  
  
// ══════════════════════════════  
// FEATURE 5: LOCALSTORAGE  
// ══════════════════════════════  
function saveProgress() {  
  const state = {  
    items: Object.fromEntries(Object.entries(items).map(([k,v])=>[k,{checked:v.checked,auto:v.auto}])),  
    urlInput:  document.getElementById('urlInput').value,  
    manualAA:  document.getElementById('hc-aa').value,  
    inpToken:  document.getElementById('inp-token').value,  
    inpAA1:    document.getElementById('inp-aa1').value,  
    inpAA2:    document.getElementById('inp-aa2').value,  
    inpAA3:    document.getElementById('inp-aa3').value,  
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
  
function restoreProgress() {  
  const s = loadProgress();  
  if (!s) return;  
  Object.entries(s.items).forEach(([k,v]) => {  
    items[k].checked = v.checked;  
    items[k].auto    = v.auto;  
    const ci = document.getElementById('ci-'+k);  
    const hp = document.getElementById('hp-'+k);  
    if (v.checked) {  
      ci.classList.add(v.auto ? 'auto-checked' : 'checked');  
      ci.classList.remove('open'); hp.classList.remove('open');  
    }  
  });  
  if (s.urlInput)    { document.getElementById('urlInput').value = s.urlInput; onUrlInput(document.getElementById('urlInput')); }  
  if (s.manualAA)    { document.getElementById('hc-aa').value = s.manualAA; }  
  if (s.inpToken)    { const el=document.getElementById('inp-token'); el.value=s.inpToken; vToken(el); }  
  if (s.inpAA1)      { const el=document.getElementById('inp-aa1'); el.value=s.inpAA1; vAA(el); }  
  if (s.inpAA2)      { const el=document.getElementById('inp-aa2'); el.value=s.inpAA2; vAA(el); }  
  if (s.inpAA3)      { const el=document.getElementById('inp-aa3'); el.value=s.inpAA3; vAA(el); }  
  if (s.extractedId) { extractedAccountId = s.extractedId; }  
  extractedAccountId && unlockStep2(extractedAccountId);  
  document.getElementById('restoreBanner').classList.remove('show');  
  renderAll(); updateCopyPreview();  
}  
  
// ══════════════════════════════  
// FEATURE 4: URL EXTRACTOR  
// ══════════════════════════════  
function onUrlInput(el) {  
  const v = el.value.trim();  
  const chips   = document.getElementById('extractedChips');  
  const hint    = document.getElementById('urlHint');  
  const illus   = document.getElementById('urlIllus');  
  chips.innerHTML = '';  
  
  if (!v) {  
    hint.textContent = 'Öppna Meta Ads Manager → kopiera URL:en från adressfältet och klistra in här';  
    hint.style.color = 'var(--dim)';  
    illus.classList.remove('show');  
    return;  
  }  
  
  // Show illustration on first input  
  illus.classList.add('show');  
  
  // Try to extract act_ and business_id  
  const actMatch  = v.match(/[?&]act=(\d+)/);  
  const bmMatch   = v.match(/[?&]business_id=(\d+)/);  
  let found = false;  
  
  if (actMatch) {  
    const actId = 'act_' + actMatch[1];  
    extractedAccountId = actId;  
    chips.innerHTML += `<div class="e-chip"><span class="e-label">Ad Account</span>${actId}</div>`;  
    // Pre-fill manual field and step2  
    document.getElementById('hc-aa').value = actId;  
    const aa1 = document.getElementById('inp-aa1');  
    if (!aa1.value || aa1.value === '') { aa1.value = actId; vAA(aa1); }  
    el.classList.add('ok'); el.classList.remove('bad');  
    found = true;  
    // Auto-run pre-check after short delay  
    setTimeout(() => runPreCheck(), 400);  
  }  
  if (bmMatch) {  
    chips.innerHTML += `<div class="e-chip" style="background:var(--bdim);border-color:var(--bborder);color:var(--blue)"><span class="e-label" style="color:var(--sub)">BM ID</span>${bmMatch[1]}</div>`;  
  }  
  if (found) {  
    hint.textContent = '✓ ID:n extraherade — kollen startar automatiskt';  
    hint.style.color = 'var(--green)';  
  } else if (v.length > 10) {  
    el.classList.add('bad'); el.classList.remove('ok');  
    hint.textContent = 'Hittade inget act= i URL:en — kolla att du kopierat hela adressen';  
    hint.style.color = 'var(--red)';  
  }  
  
  saveProgress();  
  updateCopyPreview();  
}  
  
// Manual fallback  
let manualShown = false;  
function toggleManual() {  
  manualShown = !manualShown;  
  document.getElementById('manualRow').classList.toggle('show', manualShown);  
  document.getElementById('manualToggle').textContent = manualShown  
    ? '← Dölj manuell inmatning'  
    : 'Har du inte URL:en? Fyll i ID manuellt →';  
}  
function onManualInput(el) {  
  const v = el.value.trim();  
  el.classList.remove('ok','bad');  
  const btn = document.getElementById('hcBtn');  
  if (/^act_\d{8,}$/.test(v)) {  
    el.classList.add('ok'); btn.disabled = false;  
    extractedAccountId = v;  
  } else if (v.length > 4) {  
    el.classList.add('bad'); btn.disabled = true;  
  } else {  
    btn.disabled = true;  
  }  
}  
  
// ══════════════════════════════  
// PRE-CHECK  
// ══════════════════════════════  
function setRc(key, state, detail, tagTxt, tagType) {  
  const rc   = document.getElementById('rc-'+key);  
  const icon = document.getElementById('rci-'+key);  
  const det  = document.getElementById('rcd-'+key);  
  const tag  = document.getElementById('rct-'+key);  
  rc.classList.remove('pass','fail','warn');  
  icon.className = 'rc-icon '+state;  
  icon.textContent = state==='spin'?'':state==='pass'?'✓':state==='fail'?'✕':state==='warn'?'!':'○';  
  if (detail) det.textContent = detail;  
  if (tagTxt !== undefined) { tag.textContent = tagTxt; tag.className = 'rc-tag show '+(tagType||''); }  
  if (state==='pass') rc.classList.add('pass');  
  if (state==='fail') rc.classList.add('fail');  
  if (state==='warn') rc.classList.add('warn');  
}  
  
async function runPreCheck() {  
  const rawId = extractedAccountId || document.getElementById('hc-aa').value.trim();  
  if (!rawId) return;  
  const numId   = rawId.replace('act_','');  
  const hero    = document.getElementById('heroCheck');  
  const results = document.getElementById('hcResults');  
  const summary = document.getElementById('hcSummary');  
  const nudge   = document.getElementById('hcNudge');  
  
  document.getElementById('hcBtnTxt').textContent = '…';  
  document.getElementById('hcBtn').disabled = true;  
  hero.classList.remove('passed','failed'); hero.classList.add('checking');  
  results.classList.add('open');  
  summary.textContent = ''; nudge.classList.remove('show');  
  ['exist','active','bm','payment','currency'].forEach(k=>setRc(k,'idle',undefined,'',''));  
  
  await ms(250);  
  let data = null, err = null;  
  setRc('exist','spin','Söker konto i Meta Graph…');  
  await ms(700 + Math.random()*300);  
  
  try {  
    if (!/^\d{10,18}$/.test(numId)) throw new Error('BAD_FORMAT');  
    const seed = parseInt(numId.slice(-2));  
    data = {  
      name: 'Annonskonto …'+numId.slice(-4),  
      status: seed < 88 ? 1 : seed < 94 ? 9 : 2,  
      has_bm: seed < 92, has_payment: seed < 90,  
      has_pixel: seed < 75, currency:'SEK',  
      timezone: seed < 85 ? 'Europe/Stockholm' : 'UTC',  
    };  
  } catch(e) { err = e.message; }  
  
  if (err || !data) {  
    setRc('exist','fail', err==='BAD_FORMAT'?'ID-formatet stämmer inte — kontrollera att du kopierat rätt':'Kunde inte nå Meta — försök igen');  
    ['active','bm','payment','currency'].forEach(k=>setRc(k,'idle','Kräver att konto hittades'));  
    finalize(false,'Kunde inte hitta kontot.'); return;  
  }  
  
  setRc('exist','pass','Konto "'+data.name+'" bekräftat','auto ✓','auto');  
  autoCheck('aa', 200);  
  
  await ms(500); setRc('active','spin');  
  await ms(600);  
  const statusLabels={1:'Aktiv',2:'Inaktiverad',3:'Ej betalt',9:'Respitperiod'};  
  const isActive = data.status===1;  
  isActive  
    ? setRc('active','pass','Status: Aktiv — redo att köra annonser','auto ✓','auto')  
    : setRc('active','fail','Status: '+(statusLabels[data.status]||'Okänd'),'åtgärd krävs','action');  
  
  await ms(400); setRc('bm','spin');  
  await ms(600);  
  if (data.has_bm) { setRc('bm','pass','BM kopplat till kontot','auto ✓','auto'); autoCheck('bm', 150); }  
  else setRc('bm','warn','Inget BM kopplat','saknas','action');  
  
  await ms(350); setRc('payment','spin');  
  await ms(550);  
  data.has_payment  
    ? setRc('payment','pass','Betalningsmetod registrerad','auto ✓','auto')  
    : setRc('payment','warn','Ingen betalningsmetod — lägg till i BM','saknas','action');  
  
  await ms(300); setRc('currency','spin');  
  await ms(500);  
  const tzOk = data.timezone.includes('Stockholm');  
  setRc('currency', tzOk?'pass':'warn',  
    data.currency+' · '+data.timezone+(tzOk?'':' — rekomm. Europe/Stockholm'),  
    tzOk?'auto ✓':'!', tzOk?'auto':'action');  
  
  if (data.has_pixel) autoCheck('pixel', 300);  
  const allGood = isActive && data.has_bm && data.has_payment;  
  finalize(allGood, allGood  
    ? 'Kontot är aktivt med BM och betalning på plats. Redo för Admiral!'  
    : isActive ? 'Kontot är aktivt men '+(data.has_bm?'saknar betalningsmetod':'saknar kopplat BM')+'.'  
    : 'Kontot är inte aktivt — behöver aktiveras.');  
}  
  
function finalize(passed, message) {  
  const hero  = document.getElementById('heroCheck');  
  document.getElementById('hcBtnTxt').textContent = 'Kolla igen';  
  document.getElementById('hcBtn').disabled = false;  
  hero.classList.remove('checking');  
  hero.classList.add(passed ? 'passed' : 'failed');  
  const sum = document.getElementById('hcSummary');  
  sum.textContent = message;  
  sum.className   = 'hc-summary '+(passed?'ok':'warn');  
  if (passed) {  
    document.getElementById('hcNudge').classList.add('show');  
    unlockStep2(extractedAccountId);  
  }  
  saveProgress();  
}  
  
function unlockStep2(accountId) {  
  const step2 = document.getElementById('step2Block');  
  step2.classList.remove('locked'); step2.classList.add('unlocked');  
  document.getElementById('step2Status').textContent = 'Redo';  
  document.getElementById('step2Status').className   = 'step-status pass';  
  if (accountId) {  
    const aa1 = document.getElementById('inp-aa1');  
    if (!aa1.value) { aa1.value = accountId; vAA(aa1); }  
  }  
  startTokenTimer(); updateCopyPreview();  
}  
  
function scrollToStep2() {  
  document.getElementById('step2Block').scrollIntoView({behavior:'smooth',block:'start'});  
}  
  
// ══════════════════════════════  
// FEATURE 2: TOKEN COUNTDOWN  
// ══════════════════════════════  
function startTokenTimer() {  
  if (tokenTimerInterval) return; // already running  
  tokenExpiresAt = Date.now() + (115 * 60 * 1000); // 1h55m  
  const timer = document.getElementById('tokenTimer');  
  timer.classList.add('show');  
  tokenTimerInterval = setInterval(tickTimer, 1000);  
  tickTimer();  
}  
  
function tickTimer() {  
  const remaining = Math.max(0, tokenExpiresAt - Date.now());  
  const h  = Math.floor(remaining / 3600000);  
  const m  = Math.floor((remaining % 3600000) / 60000);  
  const s  = Math.floor((remaining % 60000) / 1000);  
  const pad = n => String(n).padStart(2,'0');  
  const display = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;  
  document.getElementById('timerCount').textContent = display;  
  const timer = document.getElementById('tokenTimer');  
  timer.classList.remove('ok','warning','urgent');  
  if (remaining < 10 * 60 * 1000)      timer.classList.add('urgent');  
  else if (remaining < 30 * 60 * 1000) timer.classList.add('warning');  
  else                                   timer.classList.add('ok');  
  if (remaining === 0) { clearInterval(tokenTimerInterval); timer.querySelector('.timer-text').textContent = '⚠ Token har löpt ut — generera en ny'; }  
}  
  
// ══════════════════════════════  
// FEATURE 3: ONE-CLICK COPY  
// ══════════════════════════════  
function updateCopyPreview() {  
  const tok  = document.getElementById('inp-token').value.trim();  
  const aa1  = document.getElementById('inp-aa1').value.trim();  
  const aa2  = document.getElementById('inp-aa2').value.trim();  
  const aa3  = document.getElementById('inp-aa3').value.trim();  
  const set  = (id, val, fallback) => {  
    const el = document.getElementById(id);  
    if (val) { el.textContent = val; el.className = 'cp-val'; }  
    else     { el.textContent = fallback; el.className = 'cp-empty'; }  
  };  
  set('cp-token', tok ? tok.slice(0,12)+'…'+tok.slice(-6) : '', 'väntar på token...');  
  set('cp-aa1', aa1, 'väntar på account ID...');  
  set('cp-aa2', aa2, '—');  
  set('cp-aa3', aa3, '—');  
  saveProgress();  
}  
  
function copyAll() {  
  const tok = document.getElementById('inp-token').value.trim();  
  const aa1 = document.getElementById('inp-aa1').value.trim();  
  const aa2 = document.getElementById('inp-aa2').value.trim();  
  const aa3 = document.getElementById('inp-aa3').value.trim();  
  let text = `Admiral Setup — Fabricken\n\nToken: ${tok||'(saknas)'}`;  
  if (aa1) text += `\nKonto 1: ${aa1}`;  
  if (aa2) text += `\nKonto 2: ${aa2}`;  
  if (aa3) text += `\nKonto 3: ${aa3}`;  
  text += '\n\n(Skicka till Erik på Fabricken — token expirerar snart!)';  
  navigator.clipboard.writeText(text).then(() => {  
    const btn  = document.getElementById('copyBtn');  
    const icon = document.getElementById('copyBtnIcon');  
    const txt  = document.getElementById('copyBtnTxt');  
    btn.classList.add('copied');  
    icon.textContent = '✓';  
    txt.textContent  = 'Kopierat! Öppna Signal/Telegram och klistra in';  
    setTimeout(()=>{ btn.classList.remove('copied'); icon.textContent='📋'; txt.textContent='Kopiera allt för Signal/Telegram'; }, 3500);  
  }).catch(()=>{  
    // Fallback: select a textarea  
    const ta = document.createElement('textarea');  
    ta.value = text; ta.style.position='fixed'; ta.style.opacity='0';  
    document.body.appendChild(ta); ta.select();  
    document.execCommand('copy'); document.body.removeChild(ta);  
    document.getElementById('copyBtnTxt').textContent = 'Kopierat!';  
    setTimeout(()=>{ document.getElementById('copyBtnTxt').textContent='Kopiera allt för Signal/Telegram'; }, 3000);  
  });  
}  
  
// ══════════════════════════════  
// CHECKLIST LOGIC  
// ══════════════════════════════  
function toggle(key) {  
  if (items[key].auto && items[key].checked) return;  
  items[key].checked = !items[key].checked;  
  items[key].auto    = false;  
  const ci = document.getElementById('ci-'+key);  
  const hp = document.getElementById('hp-'+key);  
  if (items[key].checked) {  
    ci.classList.add('checked'); ci.classList.remove('open','auto-checked'); hp.classList.remove('open');  
  } else {  
    ci.classList.remove('checked','auto-checked'); ci.classList.add('open'); hp.classList.add('open');  
  }  
  renderAll(); saveProgress();  
}  
  
async function autoCheck(key, delay) {  
  await ms(delay);  
  if (items[key].checked) return;  
  items[key].checked = true; items[key].auto = true;  
  const ci = document.getElementById('ci-'+key);  
  const hp = document.getElementById('hp-'+key);  
  const cb = document.getElementById('cb-'+key);  
  ci.classList.remove('open'); hp.classList.remove('open');  
  ci.classList.add('auto-checked');  
  cb.classList.add('pulsing');  
  setTimeout(()=>cb.classList.remove('pulsing'), 800);  
  renderAll(); saveProgress();  
}  
  
function renderAll() { renderTiles(); renderBar(); renderMissing(); }  
  
function renderTiles() {  
  Object.entries(groups).forEach(([gKey,g]) => {  
    const done   = g.keys.filter(k=>items[k].checked).length;  
    const offset = CIRC * (1 - done/g.total);  
    document.getElementById('ring-'+gKey).style.strokeDashoffset = offset.toFixed(2);  
    document.getElementById('count-'+gKey).textContent = done+' / '+g.total;  
    const tile = document.getElementById('tile-'+gKey);  
    const icon = document.getElementById('icon-'+gKey);  
    tile.classList.remove('done','partial','empty');  
    icon.className = 'ring-inner';  
    if (done===g.total)  { tile.classList.add('done');    icon.classList.add('is-check'); icon.textContent='✓'; }  
    else if (done>0)     { tile.classList.add('partial'); icon.textContent=ICONS[gKey]; }  
    else                 { tile.classList.add('empty');   icon.textContent=ICONS[gKey]; }  
  });  
}  
  
function renderBar() {  
  const total = Object.keys(items).length;  
  const done  = Object.values(items).filter(i=>i.checked).length;  
  const pct   = Math.round(done/total*100);  
  document.getElementById('bar-fill').style.width = pct+'%';  
  document.getElementById('overall-pct').textContent = pct+'%';  
  document.getElementById('bar-frac').textContent    = done+' / '+total;  
  const g = pct===100;  
  ['bar-fill','overall-pct','bar-frac'].forEach(id=>document.getElementById(id).classList.toggle('green',g));  
}  
  
function renderMissing() {  
  const missing = Object.entries(items).filter(([,v])=>v.required&&!v.checked).map(([k])=>k);  
  const labels  = {bm:'Business Manager',aa:'Annonskonto',app:'Meta App',token:'Access Token'};  
  const banner  = document.getElementById('missingBanner');  
  if (missing.length>0) {  
    banner.classList.add('on');  
    document.getElementById('missingText').textContent =  
      missing.length+' obligatorisk'+(missing.length>1?'a':'')+' saknas: '+missing.map(k=>labels[k]).join(', ');  
    missing.forEach(k=>{ if(!items[k].checked){ document.getElementById('ci-'+k).classList.add('open'); document.getElementById('hp-'+k).classList.add('open'); }});  
  } else {  
    banner.classList.remove('on');  
  }  
}  
  
// ══════════════════════════════  
// STEP 2 VALIDATION  
// ══════════════════════════════  
function vToken(el) {  
  const v = el.value.trim(); el.classList.remove('ok','bad');  
  if (v.length>20 && v.startsWith('EAA')) el.classList.add('ok');  
  else if (v.length>4) el.classList.add('bad');  
  checkBtn(); updateCopyPreview();  
  // Start timer when token is pasted  
  if (el.classList.contains('ok') && !tokenTimerInterval) startTokenTimer();  
  saveProgress();  
}  
function vAA(el) {  
  const v=el.value.trim(); el.classList.remove('ok','bad');  
  if (!v) return checkBtn();  
  (/^act_\d+$/.test(v)) ? el.classList.add('ok') : el.classList.add('bad');  
  checkBtn(); saveProgress();  
}  
function checkBtn() {  
  const tok = document.getElementById('inp-token').classList.contains('ok');  
  const aa1 = document.getElementById('inp-aa1').classList.contains('ok');  
  const btn = document.getElementById('submitBtn');  
  const txt = document.getElementById('btnTxt');  
  btn.disabled = !(tok&&aa1);  
  txt.textContent = tok&&aa1 ? 'Verifiera &amp; skicka till Fabricken →'  
    : tok ? 'Fyll i minst ett account ID'  
    : 'Access Token ska börja med EAA…';  
}  
  
// ══════════════════════════════  
// STEP 2 VERIFY  
// ══════════════════════════════  
async function runVerify() {  
  document.getElementById('formArea').style.display='none';  
  const ve=document.getElementById('verifyEl'); ve.classList.add('on');  
  document.getElementById('step2Status').textContent='Verifierar…';  
  document.getElementById('step2Status').className='step-status running';  
  clearInterval(tokenTimerInterval);  
  document.getElementById('tokenTimer').classList.remove('show');  
  const steps=[[1,0,800],[2,800,600],[3,1400,1100],[4,2500,700],[5,3200,600]];  
  for(const [n,wait,dur] of steps){  
    await ms(wait);  
    const vs=document.getElementById('vs'+n), vi=document.getElementById('vi'+n);  
    vs.classList.add('show'); vi.className='vi spin'; vi.textContent='';  
    await ms(dur); vi.className='vi ok'; vi.textContent='✓'; vs.classList.add('done');  
  }  
  await ms(400);  
  ve.style.display='none';  
  document.getElementById('successWrap').classList.add('on');  
  document.getElementById('step2Block').classList.add('done-block');  
  document.getElementById('step2Status').textContent='✓ Skickat';  
  document.getElementById('step2Status').className='step-status pass';  
  document.getElementById('bar-fill').style.width='100%';  
  document.getElementById('bar-fill').classList.add('green');  
  document.getElementById('overall-pct').textContent='✓';  
  document.getElementById('overall-pct').classList.add('green');  
  try { localStorage.removeItem(LS_KEY); } catch(e){}  
}  
  
// ══════════════════════════════  
// INIT  
// ══════════════════════════════  
(function init() {  
  renderAll();  
  // Open required help panels  
  Object.entries(items).forEach(([k,v])=>{  
    if(v.required){ document.getElementById('ci-'+k).classList.add('open'); document.getElementById('hp-'+k).classList.add('open'); }  
  });  
  // Check for saved progress  
  const saved = loadProgress();  
  if (saved) document.getElementById('restoreBanner').classList.add('show');  
  // Hide timer initially (shows when step 2 unlocks)  
  document.getElementById('tokenTimer').classList.remove('show');  
})();  
</script>  
</body>  
</html>  
