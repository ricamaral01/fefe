// Cria o administrador inicial e, opcionalmente (SEED_DEMO=true), dados de demonstração.
const crypto = require('crypto');
const { one, q, migrate, pool } = require('./db');
const { hash } = require('./auth');

const tok = () => crypto.randomBytes(16).toString('base64url');
const hojeISO = (delta = 0) => {
  const d = new Date(Date.now() + delta * 86400_000);
  return d.toLocaleDateString('sv-SE', { timeZone: process.env.TZ_CLINICA || 'America/Sao_Paulo' });
};

async function seed({ demo = false } = {}) {
  const existe = await one('SELECT count(*)::int AS n FROM usuarios');
  if (existe.n === 0) {
    const email = process.env.ADMIN_EMAIL || 'admin@clinica.local';
    const senha = process.env.ADMIN_SENHA || 'trocar123';
    await q(`INSERT INTO usuarios (nome,email,senha_hash,perfil,admin) VALUES ('Administrador',$1,$2,'recepcao',true)`, [email, await hash(senha)]);
    console.log(`Administrador criado: ${email} (troque a senha no primeiro acesso)`);
  }
  if (!demo) return;
  if ((await one(`SELECT count(*)::int AS n FROM usuarios WHERE perfil='medico'`)).n > 0) return;

  console.log('Criando dados de demonstração…');
  await q(`UPDATE clinica SET nome='Clínica Vida & Saúde', cnpj='12.345.678/0001-90', endereco='Av. Paulista, 1000 — sala 1204 — Bela Vista',
           cidade='São Paulo/SP', telefone='(11) 3333-4444', whatsapp='(11) 99999-0000', email='contato@vidaesaude.com.br' WHERE id=1`);
  const senha = await hash('medico123');
  const med = async (nome, email, crm, esp, cor) => (await one(
    `INSERT INTO usuarios (nome,email,senha_hash,perfil,crm,crm_uf,rqe,especialidade,cabecalho_endereco,cabecalho_telefone,cor)
     VALUES ($1,$2,$3,'medico',$4,'SP',$5,$6,'Av. Paulista, 1000 — sala 1204 — São Paulo/SP','(11) 3333-4444',$7) RETURNING id`,
    [nome, email, senha, crm, String(10000 + Number(crm.slice(-3))), esp, cor])).id;
  const m1 = await med('Dra. Maria Luísa Andrade', 'marialuisa@clinica.local', '123456', 'Clínica Médica', '#0f766e');
  const m2 = await med('Dr. João Ricardo Ferraz', 'joaoricardo@clinica.local', '654321', 'Cardiologia', '#1d4ed8');
  await q(`INSERT INTO usuarios (nome,email,senha_hash,perfil) VALUES ('Juliana (Recepção)','recepcao@clinica.local',$1,'recepcao')`, [await hash('recepcao123')]);
  for (const m of [m1, m2])
    for (let d = 1; d <= 5; d++)
      await q('INSERT INTO horarios_medico (medico_id,dia_semana,inicio,fim,duracao_min) VALUES ($1,$2,$3,$4,30),($1,$2,$5,$6,30)', [m, d, '07:00', '12:00', '13:00', '18:00']);
  // sábado de manhã para a demonstração funcionar em qualquer dia
  for (const m of [m1, m2])
    for (const d of [0, 6]) await q('INSERT INTO horarios_medico (medico_id,dia_semana,inicio,fim,duracao_min) VALUES ($1,$2,$3,$4,30)', [m, d, '07:00', '12:00']);

  const pac = async (nome, cpf, nasc, sexo, tel, conv, cart, alerg) => (await one(
    `INSERT INTO pacientes (nome,cpf,data_nascimento,sexo,telefone,convenio,carteirinha,alergias) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [nome, cpf, nasc, sexo, tel, conv, cart, alerg])).id;
  const p = [
    await pac('Maria Aparecida Santos', '123.456.789-09', '1958-03-14', 'F', '(11) 98765-4321', 'Unimed', '0 123 456789012', 'Dipirona'),
    await pac('João Pedro Oliveira', '987.654.321-00', '1985-07-22', 'M', '(11) 91234-5678', null, null, null),
    await pac('Carla Mendes Ribeiro', '456.789.123-45', '1992-11-02', 'F', '(11) 99876-1234', 'Bradesco Saúde', '889 0012 3344', null),
    await pac('Antônio Carlos Lima', '321.654.987-11', '1949-01-30', 'M', '(11) 97777-8888', 'SulAmérica', '5566 7788 99', 'Penicilina'),
    await pac('Beatriz Souza Almeida', '741.852.963-22', '2001-05-18', 'F', '(11) 96666-5555', null, null, null),
    await pac('Fernando Gomes Costa', '159.753.486-33', '1977-09-09', 'M', '(11) 95555-4444', 'Unimed', '0 987 654321098', null),
  ];

  const ag = async (medico, paciente, data, hora, pagamento, convenio, tipo, status) => (await one(
    `INSERT INTO agendamentos (medico_id,paciente_id,data,hora,pagamento,convenio,tipo,status,token_confirmacao,whatsapp_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [medico, paciente, data, hora, pagamento, convenio, tipo, status, tok(), status === 'confirmado' ? 'respondido' : 'enviado'])).id;

  // Histórico: consulta anterior da Maria e do Antônio
  const passado = hojeISO(-45);
  const a1 = await ag(m1, p[0], passado, '09:00', 'convenio', 'Unimed', 'primeira', 'finalizado');
  const at1 = (await one(
    `INSERT INTO atendimentos (agendamento_id,paciente_id,medico_id,iniciado_em,encerrado_em,queixa,anamnese,exame_fisico,diagnostico,conduta)
     VALUES ($1,$2,$3,$4::date + time '09:05',$4::date + time '09:32',$5,$6,$7,$8,$9) RETURNING id`,
    [a1, p[0], m1, passado, 'Cefaleia frequente e tontura há 2 semanas.',
      'Paciente hipertensa, refere uso irregular de losartana. Nega náuseas. Dor em região occipital, pior pela manhã.',
      'PA 158/96 mmHg, FC 82 bpm, afebril. Sem déficits neurológicos.', 'Hipertensão arterial sistêmica não controlada (I10)',
      'Reforçada adesão ao tratamento. Ajuste de losartana para 50 mg 12/12h. Solicitado perfil lipídico, creatinina e potássio. Retorno em 45 dias.'])).id;
  await q(`INSERT INTO receitas (atendimento_id,paciente_id,medico_id,itens,criado_em) VALUES ($1,$2,$3,$4,$5::date + time '09:30')`,
    [at1, p[0], m1, JSON.stringify([
      { medicamento: 'Losartana potássica 50 mg', quantidade: '60 comprimidos', posologia: 'Tomar 1 comprimido de 12 em 12 horas.', via: 'Oral' },
      { medicamento: 'Paracetamol 750 mg', quantidade: '10 comprimidos', posologia: 'Tomar 1 comprimido até de 6 em 6 horas se dor.', via: 'Oral' },
    ]), passado]);

  const passado2 = hojeISO(-120);
  const a2 = await ag(m1, p[3], passado2, '10:00', 'convenio', 'SulAmérica', 'primeira', 'finalizado');
  await q(`INSERT INTO atendimentos (agendamento_id,paciente_id,medico_id,iniciado_em,encerrado_em,queixa,diagnostico,conduta)
           VALUES ($1,$2,$3,$4::date + time '10:02',$4::date + time '10:25',$5,$6,$7)`,
    [a2, p[3], m1, passado2, 'Check-up anual. Refere cansaço aos esforços.', 'DM2 em acompanhamento (E11)', 'Mantida metformina 850 mg. Solicitada HbA1c.']);

  // Agenda de hoje
  const hoje = hojeISO();
  await ag(m1, p[0], hoje, '08:00', 'convenio', 'Unimed', 'retorno', 'confirmado');
  await ag(m1, p[1], hoje, '08:30', 'particular', null, 'primeira', 'aguardando');
  await ag(m1, p[2], hoje, '09:30', 'convenio', 'Bradesco Saúde', 'primeira', 'agendado');
  await ag(m1, p[3], hoje, '10:00', 'convenio', 'SulAmérica', 'retorno', 'confirmado');
  await ag(m1, p[4], hoje, '11:00', 'particular', null, 'primeira', 'agendado');
  await ag(m1, p[5], hoje, '14:30', 'convenio', 'Unimed', 'retorno', 'agendado');
  await ag(m1, p[2], hoje, '07:00', 'particular', null, 'retorno', 'finalizado');
  await ag(m2, p[5], hoje, '09:00', 'convenio', 'Unimed', 'primeira', 'confirmado');
  await ag(m2, p[1], hoje, '15:00', 'particular', null, 'retorno', 'agendado');
  await ag(m2, p[3], hoje, '07:30', 'convenio', 'SulAmérica', 'retorno', 'confirmado');
  await ag(m2, p[4], hoje, '10:30', 'particular', null, 'primeira', 'agendado');
  await ag(m2, p[0], hoje, '13:30', 'convenio', 'Unimed', 'primeira', 'aguardando');
  await ag(m2, p[2], hoje, '16:00', 'convenio', 'Bradesco Saúde', 'primeira', 'agendado');
  console.log('Demo: marialuisa@clinica.local / joaoricardo@clinica.local (senha medico123), recepcao@clinica.local (recepcao123)');
}

module.exports = { seed };

if (require.main === module) {
  migrate().then(() => seed({ demo: true })).then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
