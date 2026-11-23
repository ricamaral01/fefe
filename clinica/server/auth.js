const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { one, q } = require('./db');

const SECRET = process.env.JWT_SECRET || 'dev-secret-troque-em-producao';
const TTL = process.env.JWT_TTL || '12h';

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('ERRO: defina JWT_SECRET em produção.');
  process.exit(1);
}

const hash = (senha) => bcrypt.hash(senha, 10);
const check = (senha, h) => bcrypt.compare(senha, h);
const sign = (u) => jwt.sign({ id: u.id, perfil: u.perfil }, SECRET, { expiresIn: TTL });

const PUBLIC_USER_FIELDS = `id, nome, email, perfil, admin, ativo, crm, crm_uf, rqe, especialidade,
  cabecalho_endereco, cabecalho_telefone, cor`;

async function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ erro: 'Não autenticado' });
  try {
    const p = jwt.verify(token, SECRET);
    const u = await one(`SELECT ${PUBLIC_USER_FIELDS} FROM usuarios WHERE id=$1`, [p.id]);
    if (!u || !u.ativo) return res.status(401).json({ erro: 'Usuário inativo' });
    req.user = u;
    next();
  } catch {
    return res.status(401).json({ erro: 'Sessão expirada' });
  }
}

// Configurações (usuários, grade, clínica)
const soAdmin = (req, res, next) =>
  req.user.admin ? next() : res.status(403).json({ erro: 'Apenas administradores' });

// Dados clínicos (prontuário, receitas) são exclusivos de médicos — nem administradores
// não-médicos nem a recepção têm acesso (sigilo médico / LGPD).
const soMedico = (req, res, next) =>
  req.user.perfil === 'medico' ? next() : res.status(403).json({ erro: 'Acesso restrito ao médico' });

const audit = (req, acao, entidade, id) =>
  q('INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id) VALUES ($1,$2,$3,$4)', [
    req.user?.id || null, acao, entidade, id || null,
  ]).catch(() => {});

module.exports = { hash, check, sign, requireAuth, soAdmin, soMedico, audit, PUBLIC_USER_FIELDS };
