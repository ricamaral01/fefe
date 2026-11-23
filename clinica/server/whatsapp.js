// Integração WhatsApp: envio de confirmação/lembrete e leitura de respostas.
// Provedores suportados (variável WHATSAPP_PROVIDER):
//   meta      -> WhatsApp Cloud API oficial (Meta)
//   evolution -> Evolution API (self-hosted, muito usada no Brasil)
//   manual    -> nada é enviado automaticamente; a recepção recebe um link wa.me pronto
const { one, q } = require('./db');

const PROVIDER = (process.env.WHATSAPP_PROVIDER || 'manual').toLowerCase();
const PUBLIC_URL = (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');

function normalizarTelefone(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return d;
}

const fmtData = (iso) => iso.split('-').reverse().join('/');
const fmtHora = (t) => String(t).slice(0, 5);
const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const diaSemana = (iso) => DIAS[new Date(iso + 'T12:00:00').getDay()];

async function dadosAgendamento(id) {
  return one(
    `SELECT a.*, p.nome AS paciente_nome, p.telefone, u.nome AS medico_nome, c.nome AS clinica_nome,
            c.endereco AS clinica_endereco
       FROM agendamentos a
       JOIN pacientes p ON p.id = a.paciente_id
       JOIN usuarios u ON u.id = a.medico_id
       CROSS JOIN clinica c
      WHERE a.id = $1`,
    [id]
  );
}

function montarTexto(a, lembrete = false) {
  const primeiroNome = a.paciente_nome.split(' ')[0];
  const link = `${PUBLIC_URL}/c/${a.token_confirmacao}`;
  const abertura = lembrete
    ? `Olá, ${primeiroNome}! Lembrete: amanhã você tem consulta`
    : `Olá, ${primeiroNome}! Sua consulta foi agendada`;
  return (
    `${abertura} com ${a.medico_nome} na ${a.clinica_nome}.\n\n` +
    `📅 ${diaSemana(a.data)}, ${fmtData(a.data)} às ${fmtHora(a.hora)}\n` +
    (a.clinica_endereco ? `📍 ${a.clinica_endereco}\n` : '') +
    `\nResponda *1* para CONFIRMAR ou *2* para CANCELAR.\n` +
    `Ou acesse: ${link}`
  );
}

async function enviarMeta(to, texto, a) {
  const url = `https://graph.facebook.com/${process.env.META_API_VERSION || 'v21.0'}/${process.env.META_PHONE_NUMBER_ID}/messages`;
  // Mensagens iniciadas pela empresa exigem template aprovado. Se META_TEMPLATE estiver definido,
  // usa o template com parâmetros: {{1}} nome, {{2}} médico, {{3}} data, {{4}} hora, {{5}} link.
  const body = process.env.META_TEMPLATE
    ? {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: process.env.META_TEMPLATE,
          language: { code: process.env.META_TEMPLATE_LANG || 'pt_BR' },
          components: [
            {
              type: 'body',
              parameters: [
                a.paciente_nome.split(' ')[0], a.medico_nome, fmtData(a.data), fmtHora(a.hora),
                `${PUBLIC_URL}/c/${a.token_confirmacao}`,
              ].map((text) => ({ type: 'text', text })),
            },
          ],
        },
      }
    : { messaging_product: 'whatsapp', to, type: 'text', text: { body: texto } };
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.META_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, json };
}

async function enviarEvolution(to, texto) {
  const base = (process.env.EVOLUTION_URL || '').replace(/\/$/, '');
  const r = await fetch(`${base}/message/sendText/${process.env.EVOLUTION_INSTANCE}`, {
    method: 'POST',
    headers: { apikey: process.env.EVOLUTION_APIKEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ number: to, text: texto }),
  });
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, json };
}

// Envia confirmação (ou lembrete). Sempre devolve o link wa.me como alternativa manual.
async function enviarConfirmacao(agendamentoId, { lembrete = false } = {}) {
  const a = await dadosAgendamento(agendamentoId);
  if (!a) return { ok: false, erro: 'Agendamento não encontrado' };
  const to = normalizarTelefone(a.telefone);
  const texto = montarTexto(a, lembrete);
  const linkManual = to ? `https://wa.me/${to}?text=${encodeURIComponent(texto)}` : null;

  if (!to) {
    await q(`UPDATE agendamentos SET whatsapp_status='falhou' WHERE id=$1`, [a.id]);
    return { ok: false, erro: 'Paciente sem telefone', provider: PROVIDER };
  }

  let resultado = { ok: false, json: null };
  let status = 'manual';
  if (PROVIDER === 'meta' || PROVIDER === 'evolution') {
    try {
      resultado = PROVIDER === 'meta' ? await enviarMeta(to, texto, a) : await enviarEvolution(to, texto);
      status = resultado.ok ? 'enviado' : 'falhou';
    } catch (e) {
      resultado = { ok: false, json: { erro: e.message } };
      status = 'falhou';
    }
  }

  await q(
    `INSERT INTO whatsapp_mensagens (agendamento_id, direcao, telefone, conteudo, status, resposta_api)
     VALUES ($1,'saida',$2,$3,$4,$5)`,
    [a.id, to, texto, status, resultado.json]
  );
  await q(
    `UPDATE agendamentos SET whatsapp_status = CASE WHEN whatsapp_status='respondido' THEN whatsapp_status ELSE $2 END
       ${lembrete ? ', lembrete_enviado = TRUE' : ''} WHERE id=$1`,
    [a.id, status]
  );
  return { ok: status === 'enviado', status, provider: PROVIDER, linkManual };
}

// Interpreta a resposta do paciente ("1"/"sim" confirma, "2"/"não" cancela)
async function processarResposta(telefone, texto) {
  const tel = normalizarTelefone(telefone);
  if (!tel) return null;
  const t = String(texto || '').trim().toLowerCase();
  let acao = null;
  if (/^(1|sim|confirm|confirmo|confirmar|ok)\b/.test(t)) acao = 'confirmar';
  else if (/^(2|n[aã]o|cancel|cancelar|desmarcar)\b/.test(t)) acao = 'cancelar';

  // Agendamento futuro mais próximo deste telefone ainda em aberto.
  // Compara os últimos 8 dígitos para tolerar o "9" extra de celulares.
  const a = await one(
    `SELECT a.id FROM agendamentos a JOIN pacientes p ON p.id=a.paciente_id
      WHERE right(regexp_replace(coalesce(p.telefone,''), '\\D', '', 'g'), 8) = right($1, 8)
        AND a.data >= current_date AND a.status IN ('agendado','confirmado')
      ORDER BY a.data, a.hora LIMIT 1`,
    [tel]
  );
  await q(
    `INSERT INTO whatsapp_mensagens (agendamento_id, direcao, telefone, conteudo, status) VALUES ($1,'entrada',$2,$3,$4)`,
    [a?.id || null, tel, texto, acao || 'nao_reconhecida']
  );
  if (!a || !acao) return null;
  await aplicarAcao(a.id, acao);
  return { agendamentoId: a.id, acao };
}

async function aplicarAcao(id, acao) {
  if (acao === 'confirmar') {
    await q(
      `UPDATE agendamentos SET status='confirmado', confirmado_em=now(), whatsapp_status='respondido'
        WHERE id=$1 AND status IN ('agendado','confirmado')`, [id]);
  } else if (acao === 'cancelar') {
    await q(
      `UPDATE agendamentos SET status='cancelado', whatsapp_status='respondido'
        WHERE id=$1 AND status IN ('agendado','confirmado')`, [id]);
  }
}

// Lembretes automáticos: um dia antes, para quem ainda não recebeu
async function enviarLembretes() {
  if (PROVIDER === 'manual') return;
  const { rows } = await q(
    `SELECT id FROM agendamentos WHERE data = current_date + 1 AND status = 'agendado' AND NOT lembrete_enviado`
  );
  for (const r of rows) await enviarConfirmacao(r.id, { lembrete: true }).catch(() => {});
}

module.exports = { enviarConfirmacao, processarResposta, aplicarAcao, enviarLembretes, normalizarTelefone, PROVIDER };
