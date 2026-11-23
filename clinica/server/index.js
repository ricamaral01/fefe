const express = require('express');
const path = require('path');
const { migrate } = require('./db');
const wa = require('./whatsapp');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  next();
});

app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use(require('./routes/publico'));
app.use('/api', express.json({ limit: '1mb' }), (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, require('./routes/api'));

const pub = path.join(__dirname, '..', 'public');
app.use(express.static(pub, {
  setHeaders: (res, file) => {
    if (file.endsWith('sw.js') || file.endsWith('.html') || file.endsWith('.webmanifest')) res.set('Cache-Control', 'no-cache');
  },
}));
// SPA: qualquer outra rota devolve o app
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(pub, 'index.html')));

const PORT = Number(process.env.PORT) || 3000;

(async () => {
  await migrate();
  if (process.env.SEED_DEMO === 'true') await require('./seed').seed({ demo: true });
  else await require('./seed').seed({ demo: false });
  app.listen(PORT, () => console.log(`Clínica rodando em http://localhost:${PORT} (WhatsApp: ${wa.PROVIDER})`));
  // Lembretes do dia seguinte: verifica a cada 30 min, entre 8h e 20h
  setInterval(() => {
    const h = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: process.env.TZ_CLINICA || 'America/Sao_Paulo' }));
    if (h >= 8 && h < 20) wa.enviarLembretes().catch((e) => console.error('lembretes', e));
  }, 30 * 60_000);
})().catch((e) => { console.error(e); process.exit(1); });
