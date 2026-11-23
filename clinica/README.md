# Clínica — Agenda, Recepção, Prontuário e Receituário (PWA)

Sistema web instalável (PWA) para uma clínica: funciona em **MacBook, Windows, iPad, tablets Windows/Android, iPhone e Android** pelo navegador, e pode ser instalado como aplicativo.

## O que faz

| Perfil | Tela inicial | Recursos |
|---|---|---|
| **Recepção** | Blocos de horário do médico selecionado | Clica no bloco → digita o paciente (busca ou cadastra) → **Convênio/Particular**, **1ª consulta/Retorno** → agenda e envia **confirmação por WhatsApp**. Marca chegada, falta, cancela, remarca, faz encaixe, reenvia WhatsApp. |
| **Médico** | **Agenda do dia** | Clica no agendamento → abre o **prontuário** com dados e **histórico** do paciente; descreve o problema, anamnese, exame, diagnóstico, conduta; **salva com data e hora** (salvamento automático); **receituário** (simples ou controle especial, A5/A4, autocompletar de medicamentos já usados, "repetir receita"); **atestado**; **imprimir prontuário**; **Encerrar consulta** → volta para a agenda. |
| **Administrador** | — | Usuários (médicos com CRM/RQE/especialidade/endereço do cabeçalho), grade de horários de cada médico, dados da clínica. |

Todas as impressões saem com o **cabeçalho do médico logado** (nome, especialidade, CRM/UF, RQE, endereço/telefone, cor) e assinatura no rodapé. O médico ajusta o próprio cabeçalho em **Meu cabeçalho**.

O WhatsApp envia uma mensagem com data, horário e um link. O paciente confirma respondendo **1** (ou cancela com **2**) ou pela página do link. A agenda é atualizada automaticamente, e um **lembrete** é enviado no dia anterior.

Mockups das telas: [`docs/mockups/`](docs/mockups) (exemplo de receita em PDF: `docs/mockups/receita-exemplo.pdf`).

## Tecnologia

- **Backend:** Node.js 22 + Express 5, autenticação com e-mail/senha (bcrypt + JWT), limite de tentativas de login.
- **Banco:** PostgreSQL 16 (`server/schema.sql`, criado automaticamente ao iniciar).
- **Frontend:** PWA em JavaScript puro (sem build), service worker e manifest. Dados de pacientes **nunca** ficam em cache no aparelho.
- **Sigilo:** prontuário e receitas são acessíveis **somente por médicos**. A recepção e administradores não-médicos não veem dados clínicos. Os acessos ao prontuário ficam registrados na tabela `auditoria`.

## Instalação na VPS (Ubuntu/Debian)

Pré-requisitos: uma VPS com Docker e um domínio (ex.: `clinica.seudominio.com.br`) com registro **A** apontando para o IP da VPS. HTTPS é obrigatório para PWA, e o Caddy gera o certificado automaticamente.

```bash
# 1. Docker
curl -fsSL https://get.docker.com | sh

# 2. Código
git clone <este-repositório> && cd <repo>/clinica

# 3. Configuração
cp .env.example .env
nano .env        # DOMINIO, DB_PASSWORD, JWT_SECRET (openssl rand -hex 32), ADMIN_EMAIL, ADMIN_SENHA

# 4. Subir
docker compose up -d --build
```

Acesse `https://SEU_DOMINIO` e entre com `ADMIN_EMAIL` / `ADMIN_SENHA`. Depois:

1. **Configurações → Clínica**: nome, CNPJ, endereço, cidade/UF, telefone.
2. **Configurações → Usuários**: cadastre os médicos (CRM, UF, RQE, especialidade) e a recepção.
3. **Configurações → Horários**: ajuste a grade de cada médico (o padrão é seg–sex, 8h–12h e 14h–18h, blocos de 30 min).

Os backups diários do banco ficam em `./backups` (últimos 30 dias). Recomenda-se copiá-los para fora da VPS.

Para atualizar: `git pull && docker compose up -d --build`.

## WhatsApp

Defina `WHATSAPP_PROVIDER` no `.env`:

- **`manual`** (padrão): nada é enviado automaticamente. Ao agendar, a recepção recebe um botão **Abrir WhatsApp** com a mensagem pronta (link `wa.me`).
- **`meta`** (API oficial WhatsApp Cloud): preencha `META_TOKEN` e `META_PHONE_NUMBER_ID`. Mensagens iniciadas pela clínica exigem um **template aprovado**; crie um com 5 variáveis (nome, médico, data, hora, link) e informe em `META_TEMPLATE`. No painel da Meta, configure o webhook `https://SEU_DOMINIO/webhook/whatsapp` com o mesmo `META_VERIFY_TOKEN` e assine o campo `messages`.
- **`evolution`** ([Evolution API](https://github.com/EvolutionAPI/evolution-api), self-hosted, usa um número comum via QR code): preencha `EVOLUTION_URL`, `EVOLUTION_INSTANCE` e `EVOLUTION_APIKEY`, e configure o webhook (evento `MESSAGES_UPSERT`) para `https://SEU_DOMINIO/webhook/evolution?token=EVOLUTION_WEBHOOK_TOKEN`.

## Instalar como aplicativo

- **iPhone/iPad (Safari):** Compartilhar → *Adicionar à Tela de Início*.
- **Android (Chrome):** menu ⋮ → *Instalar aplicativo*.
- **Windows/Mac (Chrome/Edge):** ícone de instalar na barra de endereço.

## Impressão

As receitas são impressas pela janela de impressão do navegador (A5 por padrão, A4 opcional). Na primeira vez, desmarque **"Cabeçalhos e rodapés"** do navegador para não sair URL/data na folha. Receitas de **controle especial** saem em A4 com 1ª via (farmácia) e 2ª via (paciente) e os campos de comprador e fornecedor.

## Desenvolvimento local

```bash
cd clinica
npm install
# PostgreSQL local com usuário/banco "clinica" (senha "clinica"), ou defina DATABASE_URL
SEED_DEMO=true npm run dev        # http://localhost:3000
```

Usuários de demonstração: `helena@clinica.local` e `rafael@clinica.local` (senha `medico123`), `recepcao@clinica.local` (`recepcao123`), `admin@clinica.local` (`trocar123`).

- `scripts/reset-db.sh` apaga **todos os dados** e recria a demonstração. Use apenas em desenvolvimento.
- `npm run mockups` percorre o fluxo completo no navegador (recepção → médico → receita → encerrar) e regenera as imagens em `docs/mockups`.

## Estrutura

```
server/
  index.js          servidor, arquivos estáticos, lembretes automáticos
  schema.sql        tabelas (clínica, usuários, horários, pacientes, agendamentos, atendimentos, receitas, WhatsApp, auditoria)
  routes/api.js     API REST
  routes/publico.js página de confirmação do paciente + webhooks do WhatsApp
  whatsapp.js       envio (Meta/Evolution/manual) e leitura das respostas
  seed.js           admin inicial e dados de demonstração
public/             PWA (index.html, manifest, service worker, css, js/views)
```
