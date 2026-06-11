import { Router, type IRouter } from "express";

const router: IRouter = Router();
const startedAt = new Date();

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

router.get("/", (_req, res) => {
  const uptime = formatUptime(Date.now() - startedAt.getTime());

  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>B4 Music Bot</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0d1117;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #e6edf3;
    }
    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 16px;
      padding: 48px 56px;
      text-align: center;
      max-width: 420px;
      width: 90%;
    }
    .icon { font-size: 64px; margin-bottom: 16px; }
    h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
    .subtitle { color: #8b949e; font-size: 15px; margin-bottom: 32px; }
    .status-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-bottom: 24px;
    }
    .dot {
      width: 10px; height: 10px;
      border-radius: 50%;
      background: #3fb950;
      box-shadow: 0 0 8px #3fb950;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .status-label { font-size: 15px; color: #3fb950; font-weight: 600; }
    .stats {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-top: 24px;
    }
    .stat {
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 10px;
      padding: 14px;
    }
    .stat-value { font-size: 20px; font-weight: 700; color: #58a6ff; }
    .stat-label { font-size: 12px; color: #8b949e; margin-top: 4px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🎵</div>
    <h1>B4 Music Bot</h1>
    <p class="subtitle">Discord Music Bot</p>
    <div class="status-row">
      <div class="dot"></div>
      <span class="status-label">Online</span>
    </div>
    <div class="stats">
      <div class="stat">
        <div class="stat-value">${uptime}</div>
        <div class="stat-label">Uptime</div>
      </div>
      <div class="stat">
        <div class="stat-value">${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC</div>
        <div class="stat-label">Server Time</div>
      </div>
    </div>
  </div>
</body>
</html>`);
});

export default router;
