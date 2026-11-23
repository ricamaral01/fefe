-- Esquema do banco da clínica (PostgreSQL). Idempotente: roda a cada inicialização.

CREATE TABLE IF NOT EXISTS clinica (
  id           INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  nome         TEXT NOT NULL DEFAULT 'Clínica',
  cnpj         TEXT,
  endereco     TEXT,
  cidade       TEXT,
  telefone     TEXT,
  whatsapp     TEXT,
  email        TEXT
);
INSERT INTO clinica (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS usuarios (
  id            SERIAL PRIMARY KEY,
  nome          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  senha_hash    TEXT NOT NULL,
  perfil        TEXT NOT NULL CHECK (perfil IN ('medico','recepcao')),
  admin         BOOLEAN NOT NULL DEFAULT FALSE, -- pode gerenciar usuários, grade e dados da clínica
  ativo         BOOLEAN NOT NULL DEFAULT TRUE,
  -- Dados do médico (cabeçalho de receitas e prontuários)
  crm           TEXT,
  crm_uf        TEXT,
  rqe           TEXT,
  especialidade TEXT,
  cabecalho_endereco TEXT,
  cabecalho_telefone TEXT,
  cor           TEXT DEFAULT '#0f766e',
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Grade de atendimento de cada médico (gera os blocos de horário da recepção)
CREATE TABLE IF NOT EXISTS horarios_medico (
  id          SERIAL PRIMARY KEY,
  medico_id   INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  dia_semana  SMALLINT NOT NULL CHECK (dia_semana BETWEEN 0 AND 6), -- 0 = domingo
  inicio      TIME NOT NULL,
  fim         TIME NOT NULL,
  duracao_min SMALLINT NOT NULL DEFAULT 30 CHECK (duracao_min BETWEEN 5 AND 240)
);
CREATE INDEX IF NOT EXISTS idx_horarios_medico ON horarios_medico(medico_id, dia_semana);

CREATE TABLE IF NOT EXISTS pacientes (
  id             SERIAL PRIMARY KEY,
  nome           TEXT NOT NULL,
  cpf            TEXT,
  data_nascimento DATE,
  sexo           TEXT,
  telefone       TEXT,
  email          TEXT,
  endereco       TEXT,
  convenio       TEXT,
  carteirinha    TEXT,
  alergias       TEXT,
  observacoes    TEXT,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pacientes_nome ON pacientes (lower(nome));
CREATE UNIQUE INDEX IF NOT EXISTS idx_pacientes_cpf ON pacientes (cpf) WHERE cpf IS NOT NULL AND cpf <> '';

CREATE TABLE IF NOT EXISTS agendamentos (
  id              SERIAL PRIMARY KEY,
  medico_id       INT NOT NULL REFERENCES usuarios(id),
  paciente_id     INT NOT NULL REFERENCES pacientes(id),
  data            DATE NOT NULL,
  hora            TIME NOT NULL,
  duracao_min     SMALLINT NOT NULL DEFAULT 30,
  pagamento       TEXT NOT NULL CHECK (pagamento IN ('convenio','particular')),
  convenio        TEXT,
  carteirinha     TEXT,
  tipo            TEXT NOT NULL CHECK (tipo IN ('primeira','retorno')),
  status          TEXT NOT NULL DEFAULT 'agendado'
                  CHECK (status IN ('agendado','confirmado','aguardando','em_atendimento','finalizado','cancelado','faltou')),
  observacoes     TEXT,
  token_confirmacao TEXT NOT NULL UNIQUE,
  whatsapp_status TEXT NOT NULL DEFAULT 'pendente', -- pendente | enviado | falhou | manual | respondido
  lembrete_enviado BOOLEAN NOT NULL DEFAULT FALSE,
  confirmado_em   TIMESTAMPTZ,
  criado_por      INT REFERENCES usuarios(id),
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agendamentos_dia ON agendamentos (medico_id, data);
CREATE INDEX IF NOT EXISTS idx_agendamentos_paciente ON agendamentos (paciente_id);
-- Impede dois agendamentos ativos no mesmo bloco do mesmo médico
CREATE UNIQUE INDEX IF NOT EXISTS idx_agendamentos_slot ON agendamentos (medico_id, data, hora)
  WHERE status NOT IN ('cancelado');

-- Prontuário: um registro por atendimento
CREATE TABLE IF NOT EXISTS atendimentos (
  id              SERIAL PRIMARY KEY,
  agendamento_id  INT UNIQUE REFERENCES agendamentos(id),
  paciente_id     INT NOT NULL REFERENCES pacientes(id),
  medico_id       INT NOT NULL REFERENCES usuarios(id),
  iniciado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  encerrado_em    TIMESTAMPTZ,
  queixa          TEXT,   -- queixa principal / descrição do problema
  anamnese        TEXT,   -- história da doença atual
  exame_fisico    TEXT,
  diagnostico     TEXT,   -- hipótese diagnóstica / CID
  conduta         TEXT,   -- conduta / o que foi receitado / orientações
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_atendimentos_paciente ON atendimentos (paciente_id, iniciado_em DESC);

CREATE TABLE IF NOT EXISTS receitas (
  id             SERIAL PRIMARY KEY,
  atendimento_id INT REFERENCES atendimentos(id) ON DELETE SET NULL,
  paciente_id    INT NOT NULL REFERENCES pacientes(id),
  medico_id      INT NOT NULL REFERENCES usuarios(id),
  tipo           TEXT NOT NULL DEFAULT 'simples' CHECK (tipo IN ('simples','controle_especial')),
  itens          JSONB NOT NULL, -- [{medicamento, posologia, quantidade, via}]
  observacoes    TEXT,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_receitas_paciente ON receitas (paciente_id, criado_em DESC);

CREATE TABLE IF NOT EXISTS whatsapp_mensagens (
  id             SERIAL PRIMARY KEY,
  agendamento_id INT REFERENCES agendamentos(id) ON DELETE CASCADE,
  direcao        TEXT NOT NULL CHECK (direcao IN ('saida','entrada')),
  telefone       TEXT,
  conteudo       TEXT,
  status         TEXT,
  resposta_api   JSONB,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trilha de auditoria (LGPD): quem acessou/alterou prontuários
CREATE TABLE IF NOT EXISTS auditoria (
  id          BIGSERIAL PRIMARY KEY,
  usuario_id  INT REFERENCES usuarios(id),
  acao        TEXT NOT NULL,
  entidade    TEXT,
  entidade_id INT,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Busca sem acento e sem diferenciar maiúsculas (sem depender da extensão unaccent)
CREATE OR REPLACE FUNCTION unaccent_lower(t TEXT) RETURNS TEXT IMMUTABLE LANGUAGE sql AS $$
  SELECT translate(lower(coalesce(t,'')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn')
$$;
