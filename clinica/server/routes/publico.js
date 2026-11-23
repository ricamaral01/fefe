// Rotas públicas: página de confirmação enviada por WhatsApp e webhooks dos provedores
const express = require('express');
const { one } = require('../db');
const wa = require('../whatsapp');

const r = express.Router();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function buscar(token) {
  return one(
    `SELECT a.id, a.data, to_char(a.hora,'HH24:MI') AS hora, a.status, p.nome AS paciente, u.nome AS medico,
            u.especialidade, c.nome AS clinica, c.endereco, c.telefone
       FROM agendamentos a JOIN pacientes p ON p.id=a.paciente_id JOIN usuarios u ON u.id=a.medico_id CROSS JOIN clinica c
      WHERE a.token_confirmacao=$1`, [token]);
}

function pagina(a, msg) {
  const data = a ? new Date(a.data + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }) : '';
  const aberto = a && ['agendado', 'confirmado'].includes(a.status);
  const rotulo = { agendado: 'Aguardando confirmação', confirmado: 'Confirmada ✔', cancelado: 'Cancelada', finalizado: 'Realizada',
    aguardando: 'Paciente na recepção', em_atendimento: 'Em atendimento', faltou: 'Não compareceu' };
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Confirmação de consulta</title><meta name="theme-color" content="#0f766e">
<style>
:root{--bg:#f3f6f8;--card:#fff;--tx:#14212b;--mut:#5b6b77;--pri:#0f766e;--red:#b42318;--bd:#dde4ea}
@media (prefers-color-scheme:dark){:root{--bg:#0d1419;--card:#16212a;--tx:#e6edf2;--mut:#93a4b1;--bd:#263541}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:16px;padding:24px;max-width:420px;width:100%}
h1{font-size:20px;margin:0 0 4px}.mut{color:var(--mut);font-size:14px}.big{font-size:18px;font-weight:600;margin:16px 0 4px;text-transform:capitalize}
.st{display:inline-block;margin-top:12px;padding:4px 10px;border-radius:99px;background:color-mix(in srgb,var(--pri) 14%,transparent);color:var(--pri);font-weight:600;font-size:14px}
form{display:flex;gap:10px;margin-top:20px}button{flex:1;padding:14px;border-radius:12px;border:0;font:inherit;font-weight:600;cursor:pointer}
.ok{background:var(--pri);color:#fff}.no{background:transparent;color:var(--red);border:1px solid var(--red)}.msg{margin-top:16px;font-weight:600}
</style></head><body><main class="card">
${a ? `<h1>${esc(a.clinica)}</h1><div class="mut">${esc(a.endereco || '')}</div>
<p>Olá, <b>${esc(a.paciente.split(' ')[0])}</b>. Sua consulta:</p>
<div class="big">${esc(data)} às ${esc(a.hora)}</div>
<div>${esc(a.medico)}${a.especialidade ? ' — ' + esc(a.especialidade) : ''}</div>
<span class="st">${esc(rotulo[a.status] || a.status)}</span>
${msg ? `<div class="msg">${esc(msg)}</div>` : ''}
${aberto ? `<form method="post"><button class="ok" name="acao" value="confirmar">Confirmar</button>
<button class="no" name="acao" value="cancelar" onclick="return confirm('Deseja realmente cancelar a consulta?')">Cancelar</button></form>` : ''}
${a.telefone ? `<p class="mut">Dúvidas ou remarcação: ${esc(a.telefone)}</p>` : ''}`
    : '<h1>Link inválido</h1><p class="mut">Este link de confirmação não existe ou expirou.</p>'}
</main></body></html>`;
}

r.get('/c/:token', async (req, res) => res.type('html').send(pagina(await buscar(req.params.token))));

r.post('/c/:token', express.urlencoded({ extended: false }), async (req, res) => {
  const a = await buscar(req.params.token);
  if (!a) return res.status(404).type('html').send(pagina(null));
  const acao = req.body?.acao;
  if (['confirmar', 'cancelar'].includes(acao) && ['agendado', 'confirmado'].includes(a.status)) await wa.aplicarAcao(a.id, acao);
  const msg = acao === 'confirmar' ? 'Obrigado! Sua presença foi confirmada.' : acao === 'cancelar' ? 'Consulta cancelada. Se quiser remarcar, fale com a clínica.' : '';
  res.type('html').send(pagina(await buscar(req.params.token), msg));
});

// ---- Webhook WhatsApp Cloud API (Meta)
r.get('/webhook/whatsapp', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.META_VERIFY_TOKEN)
    return res.send(req.query['hub.challenge']);
  res.sendStatus(403);
});

r.post('/webhook/whatsapp', express.json(), async (req, res) => {
  res.sendStatus(200); // responde logo; processa em seguida
  try {
    for (const entry of req.body?.entry || [])
      for (const ch of entry.changes || [])
        for (const m of ch.value?.messages || []) {
          const texto = m.text?.body || m.button?.text || m.interactive?.button_reply?.title || m.interactive?.button_reply?.id || '';
          await wa.processarResposta(m.from, texto);
        }
  } catch (e) { console.error('webhook meta', e); }
});

// ---- Webhook Evolution API (evento messages.upsert)
r.post('/webhook/evolution', express.json(), async (req, res) => {
  if (process.env.EVOLUTION_WEBHOOK_TOKEN && req.query.token !== process.env.EVOLUTION_WEBHOOK_TOKEN) return res.sendStatus(403);
  res.sendStatus(200);
  try {
    const d = req.body?.data;
    const lista = Array.isArray(d) ? d : d ? [d] : [];
    for (const m of lista) {
      if (m.key?.fromMe) continue;
      const tel = String(m.key?.remoteJid || '').split('@')[0];
      const texto = m.message?.conversation || m.message?.extendedTextMessage?.text || m.message?.buttonsResponseMessage?.selectedDisplayText || '';
      await wa.processarResposta(tel, texto);
    }
  } catch (e) { console.error('webhook evolution', e); }
});

module.exports = r;
