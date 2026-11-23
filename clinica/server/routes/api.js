const express = require('express');
const crypto = require('crypto');
const { q, one, all, tx } = require('../db');
const { hash, check, sign, requireAuth, soAdmin, soMedico, audit, PUBLIC_USER_FIELDS } = require('../auth');
const wa = require('../whatsapp');

const r = express.Router();

const erro = (res, status, msg) => res.status(status).json({ erro: msg });
const isData = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const isHora = (s) => /^\d{2}:\d{2}(:\d{2})?$/.test(s || '');
const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: process.env.TZ_CLINICA || 'America/Sao_Paulo' });
const vazio = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());

// ---------------------------------------------------------------- autenticação
const tentativas = new Map(); // limite simples contra força bruta
r.post('/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const senha = String(req.body?.senha || '');
  const chave = `${req.ip}|${email}`;
  const t = tentativas.get(chave) || { n: 0, ate: 0 };
  if (t.ate > Date.now()) return erro(res, 429, 'Muitas tentativas. Aguarde alguns minutos.');
  const u = await one('SELECT * FROM usuarios WHERE lower(email)=$1 AND ativo', [email]);
  if (!u || !(await check(senha, u.senha_hash))) {
    t.n += 1;
    if (t.n >= 5) Object.assign(t, { n: 0, ate: Date.now() + 5 * 60_000 });
    tentativas.set(chave, t);
    return erro(res, 401, 'E-mail ou senha inválidos');
  }
  tentativas.delete(chave);
  const user = await one(`SELECT ${PUBLIC_USER_FIELDS} FROM usuarios WHERE id=$1`, [u.id]);
  res.json({ token: sign(u), user });
});

r.use(requireAuth);

r.get('/me', (req, res) => res.json(req.user));

// O médico pode ajustar os dados do próprio cabeçalho e trocar a senha
r.put('/me', async (req, res) => {
  const b = req.body || {};
  if (b.nova_senha) {
    const u = await one('SELECT senha_hash FROM usuarios WHERE id=$1', [req.user.id]);
    if (!(await check(String(b.senha_atual || ''), u.senha_hash))) return erro(res, 400, 'Senha atual incorreta');
    if (String(b.nova_senha).length < 8) return erro(res, 400, 'A nova senha deve ter ao menos 8 caracteres');
    await q('UPDATE usuarios SET senha_hash=$2 WHERE id=$1', [req.user.id, await hash(b.nova_senha)]);
  }
  const campos = ['nome', 'crm', 'crm_uf', 'rqe', 'especialidade', 'cabecalho_endereco', 'cabecalho_telefone', 'cor'];
  const sets = campos.filter((c) => c in b);
  if (sets.length)
    await q(`UPDATE usuarios SET ${sets.map((c, i) => `${c}=$${i + 2}`).join(',')} WHERE id=$1`, [
      req.user.id, ...sets.map((c) => vazio(b[c])),
    ]);
  res.json(await one(`SELECT ${PUBLIC_USER_FIELDS} FROM usuarios WHERE id=$1`, [req.user.id]));
});

// ---------------------------------------------------------------- clínica
r.get('/clinica', async (req, res) => res.json(await one('SELECT * FROM clinica WHERE id=1')));
r.put('/clinica', soAdmin, async (req, res) => {
  const b = req.body || {};
  const campos = ['nome', 'cnpj', 'endereco', 'cidade', 'telefone', 'whatsapp', 'email'];
  await q(`UPDATE clinica SET ${campos.map((c, i) => `${c}=$${i + 1}`).join(',')} WHERE id=1`, campos.map((c) => vazio(b[c])));
  res.json(await one('SELECT * FROM clinica WHERE id=1'));
});

// ---------------------------------------------------------------- usuários / médicos
r.get('/medicos', async (req, res) =>
  res.json(await all(`SELECT ${PUBLIC_USER_FIELDS} FROM usuarios WHERE perfil='medico' AND ativo ORDER BY nome`)));

r.get('/usuarios', soAdmin, async (req, res) =>
  res.json(await all(`SELECT ${PUBLIC_USER_FIELDS} FROM usuarios ORDER BY perfil, nome`)));

const CAMPOS_USUARIO = ['nome', 'email', 'perfil', 'admin', 'ativo', 'crm', 'crm_uf', 'rqe', 'especialidade',
  'cabecalho_endereco', 'cabecalho_telefone', 'cor'];

r.post('/usuarios', soAdmin, async (req, res) => {
  const b = req.body || {};
  if (!vazio(b.nome) || !vazio(b.email) || !['medico', 'recepcao'].includes(b.perfil))
    return erro(res, 400, 'Informe nome, e-mail e perfil');
  if (String(b.senha || '').length < 8) return erro(res, 400, 'A senha deve ter ao menos 8 caracteres');
  try {
    const u = await one(
      `INSERT INTO usuarios (nome,email,senha_hash,perfil,admin,crm,crm_uf,rqe,especialidade,cabecalho_endereco,cabecalho_telefone,cor)
       VALUES ($1,lower($2),$3,$4,$5,$6,$7,$8,$9,$10,$11,coalesce($12,'#0f766e')) RETURNING id`,
      [b.nome.trim(), b.email.trim(), await hash(b.senha), b.perfil, !!b.admin, vazio(b.crm), vazio(b.crm_uf),
        vazio(b.rqe), vazio(b.especialidade), vazio(b.cabecalho_endereco), vazio(b.cabecalho_telefone), vazio(b.cor)]
    );
    if (b.perfil === 'medico') await gradePadrao(u.id);
    res.status(201).json(await one(`SELECT ${PUBLIC_USER_FIELDS} FROM usuarios WHERE id=$1`, [u.id]));
  } catch (e) {
    if (e.code === '23505') return erro(res, 409, 'E-mail já cadastrado');
    throw e;
  }
});

r.put('/usuarios/:id', soAdmin, async (req, res) => {
  const b = req.body || {};
  const id = Number(req.params.id);
  if (id === req.user.id && (b.admin === false || b.ativo === false))
    return erro(res, 400, 'Você não pode remover seu próprio acesso de administrador');
  const sets = CAMPOS_USUARIO.filter((c) => c in b);
  const vals = sets.map((c) => (c === 'admin' || c === 'ativo' ? !!b[c] : c === 'email' ? String(b[c]).trim().toLowerCase() : vazio(b[c])));
  if (b.senha) {
    if (String(b.senha).length < 8) return erro(res, 400, 'A senha deve ter ao menos 8 caracteres');
    sets.push('senha_hash');
    vals.push(await hash(b.senha));
  }
  if (sets.length) await q(`UPDATE usuarios SET ${sets.map((c, i) => `${c}=$${i + 2}`).join(',')} WHERE id=$1`, [id, ...vals]);
  res.json(await one(`SELECT ${PUBLIC_USER_FIELDS} FROM usuarios WHERE id=$1`, [id]));
});

async function gradePadrao(medicoId) {
  // Segunda a sexta, 08:00–12:00 e 14:00–18:00, blocos de 30 min (pode ser alterado na tela de configurações)
  for (let d = 1; d <= 5; d++) {
    await q('INSERT INTO horarios_medico (medico_id,dia_semana,inicio,fim,duracao_min) VALUES ($1,$2,$3,$4,30),($1,$2,$5,$6,30)',
      [medicoId, d, '08:00', '12:00', '14:00', '18:00']);
  }
}

r.get('/medicos/:id/horarios', async (req, res) =>
  res.json(await all('SELECT * FROM horarios_medico WHERE medico_id=$1 ORDER BY dia_semana, inicio', [req.params.id])));

r.put('/medicos/:id/horarios', soAdmin, async (req, res) => {
  const lista = Array.isArray(req.body) ? req.body : [];
  for (const h of lista)
    if (!(h.dia_semana >= 0 && h.dia_semana <= 6) || !isHora(h.inicio) || !isHora(h.fim) || h.inicio >= h.fim)
      return erro(res, 400, 'Horário inválido');
  await tx(async (c) => {
    await c.query('DELETE FROM horarios_medico WHERE medico_id=$1', [req.params.id]);
    for (const h of lista)
      await c.query('INSERT INTO horarios_medico (medico_id,dia_semana,inicio,fim,duracao_min) VALUES ($1,$2,$3,$4,$5)',
        [req.params.id, h.dia_semana, h.inicio, h.fim, Number(h.duracao_min) || 30]);
  });
  res.json(await all('SELECT * FROM horarios_medico WHERE medico_id=$1 ORDER BY dia_semana, inicio', [req.params.id]));
});

// ---------------------------------------------------------------- pacientes
const CAMPOS_PACIENTE = ['nome', 'cpf', 'data_nascimento', 'sexo', 'telefone', 'email', 'endereco', 'convenio',
  'carteirinha', 'alergias', 'observacoes'];

r.get('/pacientes', async (req, res) => {
  const busca = String(req.query.busca || '').trim();
  const digitos = busca.replace(/\D/g, '');
  const rows = await all(
    `SELECT p.*, (SELECT max(data) FROM agendamentos a WHERE a.paciente_id=p.id AND a.status='finalizado') AS ultima_consulta
       FROM pacientes p
      WHERE $1 = '' OR unaccent_lower(p.nome) LIKE '%' || unaccent_lower($1) || '%'
         OR ($2 <> '' AND (regexp_replace(coalesce(p.cpf,''),'\\D','','g') LIKE $2 || '%'
                       OR regexp_replace(coalesce(p.telefone,''),'\\D','','g') LIKE '%' || $2 || '%'))
      ORDER BY p.nome LIMIT 30`,
    [busca, digitos.length >= 3 ? digitos : '']
  );
  res.json(rows);
});

r.get('/pacientes/:id', async (req, res) => {
  const p = await one('SELECT * FROM pacientes WHERE id=$1', [req.params.id]);
  if (!p) return erro(res, 404, 'Paciente não encontrado');
  res.json(p);
});

async function salvarPaciente(dados, id = null, client = { query: q }) {
  const d = {};
  for (const c of CAMPOS_PACIENTE) if (c in dados) d[c] = vazio(dados[c]);
  if (!id && !d.nome) throw Object.assign(new Error('Informe o nome do paciente'), { status: 400 });
  const cols = Object.keys(d);
  if (id) {
    if (cols.length)
      await client.query(`UPDATE pacientes SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(',')} WHERE id=$1`, [id, ...cols.map((c) => d[c])]);
    return id;
  }
  const { rows } = await client.query(
    `INSERT INTO pacientes (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
    cols.map((c) => d[c])
  );
  return rows[0].id;
}

r.post('/pacientes', async (req, res) => {
  const id = await salvarPaciente(req.body || {});
  res.status(201).json(await one('SELECT * FROM pacientes WHERE id=$1', [id]));
});
r.put('/pacientes/:id', async (req, res) => {
  await salvarPaciente(req.body || {}, Number(req.params.id));
  res.json(await one('SELECT * FROM pacientes WHERE id=$1', [req.params.id]));
});

// Histórico clínico completo do paciente (somente médicos)
async function historico(pacienteId, excetoAtendimento = null) {
  const atendimentos = await all(
    `SELECT at.*, u.nome AS medico_nome, a.tipo, a.pagamento, a.convenio
       FROM atendimentos at JOIN usuarios u ON u.id=at.medico_id
       LEFT JOIN agendamentos a ON a.id=at.agendamento_id
      WHERE at.paciente_id=$1 AND ($2::int IS NULL OR at.id <> $2)
      ORDER BY at.iniciado_em DESC`,
    [pacienteId, excetoAtendimento]
  );
  const receitas = await all(
    `SELECT r.*, u.nome AS medico_nome FROM receitas r JOIN usuarios u ON u.id=r.medico_id
      WHERE r.paciente_id=$1 ORDER BY r.criado_em DESC`, [pacienteId]);
  for (const at of atendimentos) at.receitas = receitas.filter((x) => x.atendimento_id === at.id);
  return { atendimentos, receitas };
}

r.get('/pacientes/:id/historico', soMedico, async (req, res) => {
  audit(req, 'ver_historico', 'paciente', Number(req.params.id));
  res.json(await historico(Number(req.params.id)));
});

// ---------------------------------------------------------------- agenda
const SELECT_AG = `
  SELECT a.*, to_char(a.hora,'HH24:MI') AS hora, p.nome AS paciente_nome, p.telefone AS paciente_telefone,
         p.data_nascimento AS paciente_nascimento, p.cpf AS paciente_cpf, u.nome AS medico_nome,
         at.id AS atendimento_id
    FROM agendamentos a
    JOIN pacientes p ON p.id=a.paciente_id
    JOIN usuarios u ON u.id=a.medico_id
    LEFT JOIN atendimentos at ON at.agendamento_id=a.id`;

const minutos = (h) => { const [a, b] = String(h).split(':').map(Number); return a * 60 + b; };
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// Blocos de horário do médico no dia + agendamentos (inclusive encaixes fora da grade)
r.get('/agenda', async (req, res) => {
  const data = isData(req.query.data) ? req.query.data : hoje();
  const medicoId = req.user.perfil === 'medico' && !req.query.medico_id ? req.user.id : Number(req.query.medico_id);
  if (!medicoId) return erro(res, 400, 'Selecione o médico');
  const dia = new Date(data + 'T12:00:00').getDay();
  const grade = await all('SELECT * FROM horarios_medico WHERE medico_id=$1 AND dia_semana=$2 ORDER BY inicio', [medicoId, dia]);
  const ags = await all(`${SELECT_AG} WHERE a.medico_id=$1 AND a.data=$2 ORDER BY a.hora, a.id`, [medicoId, data]);

  const blocos = new Map();
  for (const g of grade)
    for (let m = minutos(g.inicio); m + g.duracao_min <= minutos(g.fim); m += g.duracao_min)
      blocos.set(hhmm(m), { hora: hhmm(m), duracao_min: g.duracao_min, agendamento: null, cancelados: [], encaixe: false });
  for (const a of ags) {
    if (!blocos.has(a.hora)) blocos.set(a.hora, { hora: a.hora, duracao_min: a.duracao_min, agendamento: null, cancelados: [], encaixe: true });
    const b = blocos.get(a.hora);
    if (a.status === 'cancelado') b.cancelados.push(a);
    else b.agendamento = a;
  }
  // blocos que só têm cancelados fora da grade não precisam aparecer
  const lista = [...blocos.values()].filter((b) => !(b.encaixe && !b.agendamento)).sort((x, y) => x.hora.localeCompare(y.hora));
  res.json({ data, medico_id: medicoId, blocos: lista });
});

r.get('/agendamentos/:id', async (req, res) => {
  const a = await one(`${SELECT_AG} WHERE a.id=$1`, [req.params.id]);
  if (!a) return erro(res, 404, 'Agendamento não encontrado');
  a.mensagens = await all('SELECT direcao, status, conteudo, criado_em FROM whatsapp_mensagens WHERE agendamento_id=$1 ORDER BY criado_em', [a.id]);
  res.json(a);
});

r.get('/pacientes/:id/agendamentos', async (req, res) =>
  res.json(await all(`${SELECT_AG} WHERE a.paciente_id=$1 ORDER BY a.data DESC, a.hora DESC LIMIT 50`, [req.params.id])));

const medicoValido = async (id) => !!(await one(`SELECT 1 FROM usuarios WHERE id=$1 AND perfil='medico' AND ativo`, [Number(id) || 0]));

r.post('/agendamentos', async (req, res) => {
  const b = req.body || {};
  if (!b.medico_id || !isData(b.data) || !isHora(b.hora)) return erro(res, 400, 'Médico, data e horário são obrigatórios');
  if (!['convenio', 'particular'].includes(b.pagamento)) return erro(res, 400, 'Informe se é convênio ou particular');
  if (!['primeira', 'retorno'].includes(b.tipo)) return erro(res, 400, 'Informe se é primeira consulta ou retorno');
  if (b.pagamento === 'convenio' && !vazio(b.convenio)) return erro(res, 400, 'Informe o nome do convênio');
  if (!(await medicoValido(b.medico_id))) return erro(res, 400, 'Médico inválido');

  let id;
  try {
    id = await tx(async (c) => {
      let pacienteId = Number(b.paciente_id) || null;
      const dadosPac = { ...(b.paciente || {}) };
      if (b.pagamento === 'convenio') Object.assign(dadosPac, { convenio: b.convenio, ...(vazio(b.carteirinha) ? { carteirinha: b.carteirinha } : {}) });
      if (pacienteId) await salvarPaciente(dadosPac, pacienteId, c);
      else pacienteId = await salvarPaciente(dadosPac, null, c);

      const { rows } = await c.query(
        `INSERT INTO agendamentos (medico_id,paciente_id,data,hora,duracao_min,pagamento,convenio,carteirinha,tipo,observacoes,token_confirmacao,criado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [b.medico_id, pacienteId, b.data, b.hora, Number(b.duracao_min) || 30, b.pagamento,
          b.pagamento === 'convenio' ? vazio(b.convenio) : null, b.pagamento === 'convenio' ? vazio(b.carteirinha) : null,
          b.tipo, vazio(b.observacoes), crypto.randomBytes(16).toString('base64url'), req.user.id]
      );
      return rows[0].id;
    });
  } catch (e) {
    if (e.code === '23505') return erro(res, 409, 'Este horário já está ocupado');
    throw e;
  }
  const whatsapp = b.enviar_whatsapp === false ? null : await wa.enviarConfirmacao(id);
  res.status(201).json({ agendamento: await one(`${SELECT_AG} WHERE a.id=$1`, [id]), whatsapp });
});

r.put('/agendamentos/:id', async (req, res) => {
  const b = req.body || {};
  const atual = await one('SELECT * FROM agendamentos WHERE id=$1', [req.params.id]);
  if (!atual) return erro(res, 404, 'Agendamento não encontrado');
  const campos = ['data', 'hora', 'medico_id', 'pagamento', 'convenio', 'carteirinha', 'tipo', 'status', 'observacoes'];
  if (b.pagamento === 'particular') Object.assign(b, { convenio: null, carteirinha: null });
  const sets = campos.filter((c) => c in b);
  if ('medico_id' in b && !(await medicoValido(b.medico_id))) return erro(res, 400, 'Médico inválido');
  if (b.status && !['agendado', 'confirmado', 'aguardando', 'cancelado', 'faltou'].includes(b.status))
    return erro(res, 400, 'Status inválido');
  try {
    if (sets.length)
      await q(`UPDATE agendamentos SET ${sets.map((c, i) => `${c}=$${i + 2}`).join(',')} WHERE id=$1`, [atual.id, ...sets.map((c) => vazio(b[c]))]);
  } catch (e) {
    if (e.code === '23505') return erro(res, 409, 'Este horário já está ocupado');
    if (e.code === '23514') return erro(res, 400, 'Dados inválidos');
    throw e;
  }
  const remarcado = (b.data && b.data !== atual.data) || (b.hora && b.hora.slice(0, 5) !== String(atual.hora).slice(0, 5));
  let whatsapp = null;
  if (remarcado) {
    await q(`UPDATE agendamentos SET status='agendado', lembrete_enviado=false, whatsapp_status='pendente' WHERE id=$1`, [atual.id]);
    whatsapp = await wa.enviarConfirmacao(atual.id);
  }
  res.json({ agendamento: await one(`${SELECT_AG} WHERE a.id=$1`, [atual.id]), whatsapp });
});

r.post('/agendamentos/:id/whatsapp', async (req, res) => res.json(await wa.enviarConfirmacao(Number(req.params.id))));

// ---------------------------------------------------------------- atendimento (prontuário)
const SELECT_AT = `
  SELECT at.*, p.nome AS paciente_nome FROM atendimentos at JOIN pacientes p ON p.id=at.paciente_id`;

async function atendimentoCompleto(id) {
  const at = await one(`${SELECT_AT} WHERE at.id=$1`, [id]);
  if (!at) return null;
  at.paciente = await one('SELECT * FROM pacientes WHERE id=$1', [at.paciente_id]);
  at.agendamento = at.agendamento_id ? await one(`${SELECT_AG} WHERE a.id=$1`, [at.agendamento_id]) : null;
  at.receitas = await all('SELECT * FROM receitas WHERE atendimento_id=$1 ORDER BY criado_em', [id]);
  at.historico = await historico(at.paciente_id, id);
  return at;
}

// Médico clica no agendamento: abre (ou reabre) o atendimento e já traz o prontuário
r.post('/agendamentos/:id/atender', soMedico, async (req, res) => {
  const a = await one('SELECT * FROM agendamentos WHERE id=$1', [req.params.id]);
  if (!a) return erro(res, 404, 'Agendamento não encontrado');
  if (a.medico_id !== req.user.id) return erro(res, 403, 'Este agendamento é de outro médico');
  if (a.status === 'cancelado') return erro(res, 400, 'Agendamento cancelado');
  let at = await one('SELECT id FROM atendimentos WHERE agendamento_id=$1', [a.id]);
  if (!at) {
    at = await one('INSERT INTO atendimentos (agendamento_id, paciente_id, medico_id) VALUES ($1,$2,$3) RETURNING id',
      [a.id, a.paciente_id, req.user.id]);
  }
  if (a.status !== 'finalizado') await q(`UPDATE agendamentos SET status='em_atendimento' WHERE id=$1`, [a.id]);
  audit(req, 'abrir_atendimento', 'atendimento', at.id);
  res.json(await atendimentoCompleto(at.id));
});

async function atendimentoDoMedico(req, res) {
  const at = await one('SELECT * FROM atendimentos WHERE id=$1', [req.params.id]);
  if (!at) { erro(res, 404, 'Atendimento não encontrado'); return null; }
  if (at.medico_id !== req.user.id) { erro(res, 403, 'Atendimento de outro médico'); return null; }
  return at;
}

r.get('/atendimentos/:id', soMedico, async (req, res) => {
  if (!(await atendimentoDoMedico(req, res))) return;
  res.json(await atendimentoCompleto(Number(req.params.id)));
});

const CAMPOS_AT = ['queixa', 'anamnese', 'exame_fisico', 'diagnostico', 'conduta'];
async function salvarAtendimento(id, b) {
  const sets = CAMPOS_AT.filter((c) => c in b);
  await q(`UPDATE atendimentos SET ${[...sets.map((c, i) => `${c}=$${i + 2}`), 'atualizado_em=now()'].join(',')} WHERE id=$1`,
    [id, ...sets.map((c) => (b[c] == null ? null : String(b[c])))]);
}

r.put('/atendimentos/:id', soMedico, async (req, res) => {
  const at = await atendimentoDoMedico(req, res);
  if (!at) return;
  await salvarAtendimento(at.id, req.body || {});
  if (req.body?.alergias !== undefined) await q('UPDATE pacientes SET alergias=$2 WHERE id=$1', [at.paciente_id, vazio(req.body.alergias)]);
  audit(req, 'salvar_atendimento', 'atendimento', at.id);
  res.json(await atendimentoCompleto(at.id));
});

r.post('/atendimentos/:id/encerrar', soMedico, async (req, res) => {
  const at = await atendimentoDoMedico(req, res);
  if (!at) return;
  await salvarAtendimento(at.id, req.body || {});
  if (req.body?.alergias !== undefined) await q('UPDATE pacientes SET alergias=$2 WHERE id=$1', [at.paciente_id, vazio(req.body.alergias)]);
  await q('UPDATE atendimentos SET encerrado_em=coalesce(encerrado_em, now()) WHERE id=$1', [at.id]);
  if (at.agendamento_id) await q(`UPDATE agendamentos SET status='finalizado' WHERE id=$1`, [at.agendamento_id]);
  audit(req, 'encerrar_atendimento', 'atendimento', at.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- receituário
r.post('/atendimentos/:id/receitas', soMedico, async (req, res) => {
  const at = await atendimentoDoMedico(req, res);
  if (!at) return;
  const b = req.body || {};
  const itens = (Array.isArray(b.itens) ? b.itens : [])
    .map((i) => ({ medicamento: vazio(i.medicamento), quantidade: vazio(i.quantidade), posologia: vazio(i.posologia), via: vazio(i.via) }))
    .filter((i) => i.medicamento);
  if (!itens.length) return erro(res, 400, 'Inclua ao menos um medicamento');
  const tipo = b.tipo === 'controle_especial' ? 'controle_especial' : 'simples';
  const rec = await one(
    'INSERT INTO receitas (atendimento_id, paciente_id, medico_id, tipo, itens, observacoes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [at.id, at.paciente_id, req.user.id, tipo, JSON.stringify(itens), vazio(b.observacoes)]
  );
  audit(req, 'emitir_receita', 'receita', rec.id);
  res.status(201).json(rec);
});

// Dados para impressão: receita + cabeçalho do médico + clínica + paciente
r.get('/receitas/:id/impressao', soMedico, async (req, res) => {
  const rec = await one('SELECT * FROM receitas WHERE id=$1', [req.params.id]);
  if (!rec) return erro(res, 404, 'Receita não encontrada');
  res.json({
    receita: rec,
    medico: await one(`SELECT ${PUBLIC_USER_FIELDS} FROM usuarios WHERE id=$1`, [rec.medico_id]),
    paciente: await one('SELECT * FROM pacientes WHERE id=$1', [rec.paciente_id]),
    clinica: await one('SELECT * FROM clinica WHERE id=1'),
  });
});

// Sugestões de medicamentos a partir das receitas já emitidas pelo médico
r.get('/medicamentos', soMedico, async (req, res) => {
  const termo = String(req.query.q || '').trim();
  res.json(await all(
    `SELECT i->>'medicamento' AS medicamento, max(i->>'posologia') AS posologia, max(i->>'quantidade') AS quantidade, count(*) AS usos
       FROM receitas r, jsonb_array_elements(r.itens) i
      WHERE r.medico_id=$1 AND ($2='' OR unaccent_lower(i->>'medicamento') LIKE '%' || unaccent_lower($2) || '%')
      GROUP BY 1 ORDER BY usos DESC LIMIT 10`, [req.user.id, termo]));
});

// Tratamento de erros
r.use((e, req, res, _next) => {
  if (e.status) return erro(res, e.status, e.message);
  console.error(e);
  erro(res, 500, 'Erro interno');
});

module.exports = r;
