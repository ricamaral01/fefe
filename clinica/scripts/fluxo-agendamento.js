// Sequência completa de telas do agendamento: recepção -> WhatsApp do paciente -> confirmação -> chegada -> médico.
// Usa o sistema real (servidor com dados de demonstração). Gera PNGs numerados e um PDF passo a passo.
// Uso: node scripts/fluxo-agendamento.js
const { chromium, devices } = require('playwright');
const { Client } = require('pg');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = path.join(__dirname, '..', 'docs', 'fluxo-agendamento');
fs.mkdirSync(OUT, { recursive: true });
const MAC = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', colorScheme: 'light' };
const IPHONE = { ...devices['iPhone 15 Pro'], locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', colorScheme: 'light' };

const passos = [];
let n = 0;
const db = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://clinica:clinica@localhost:5432/clinica' });

async function login(email, senha) {
  const r = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, senha }) });
  return r.json();
}
async function contexto(browser, opts, email, senha) {
  const ctx = await browser.newContext(opts);
  if (email) {
    const { token, user } = await login(email, senha);
    await ctx.addInitScript(([t, u]) => { localStorage.setItem('token', t); localStorage.setItem('user', u); }, [token, JSON.stringify(user)]);
  }
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw e; });
  return { ctx, page };
}

// Destaca o elemento onde o usuário clica/digita
async function marca(page, sel, texto) {
  await page.$eval(sel, (el, texto) => {
    const r = el.getBoundingClientRect();
    const d = document.createElement('div');
    d.className = '__marca';
    Object.assign(d.style, { position: 'fixed', left: r.left - 6 + 'px', top: r.top - 6 + 'px', width: r.width + 12 + 'px', height: r.height + 12 + 'px',
      border: '3px solid #e11d48', borderRadius: '12px', zIndex: 9999, pointerEvents: 'none', boxShadow: '0 0 0 6px rgba(225,29,72,.18)' });
    if (texto) {
      const b = document.createElement('div');
      b.textContent = texto;
      Object.assign(b.style, { position: 'absolute', right: '-3px', top: '-34px', background: '#e11d48', color: '#fff', font: '600 14px system-ui', padding: '5px 10px', borderRadius: '8px', whiteSpace: 'nowrap' });
      d.appendChild(b);
    }
    document.body.appendChild(d);
  }, texto);
}
const limpa = (page) => page.evaluate(() => document.querySelectorAll('.__marca').forEach((e) => e.remove()));

async function foto(page, titulo, texto, quem = 'Recepção') {
  n++;
  const arq = path.join(OUT, `${String(n).padStart(2, '0')}-${titulo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}.png`);
  await page.waitForTimeout(250);
  await page.screenshot({ path: arq });
  await limpa(page);
  if (quem === 'Paciente') await molduraIphone(page, arq);
  passos.push({ n, titulo, texto, quem, arq });
}

// Coloca a captura do celular dentro de uma moldura de iPhone
async function molduraIphone(page, arq) {
  const vp = page.viewportSize();
  const src = 'data:image/png;base64,' + fs.readFileSync(arq).toString('base64');
  const p = await page.context().browser().newPage({ deviceScaleFactor: 2, viewport: { width: 900, height: 1200 } });
  await p.setContent(`<style>body{margin:0;background:transparent;font-family:-apple-system,system-ui,sans-serif}</style><div id="d" style="display:inline-block;padding:30px">
    <div style="background:#111;border-radius:64px;padding:16px;border:3px solid #5d5f66;position:relative">
    <div style="position:absolute;left:50%;top:30px;width:120px;height:34px;margin-left:-60px;background:#000;border-radius:20px;z-index:2"></div>
    <div style="border-radius:50px;overflow:hidden;background:#f6f6f6">
    <div style="height:54px;display:flex;align-items:center;justify-content:space-between;padding:6px 34px 0 44px;font-weight:600;font-size:16px;color:#111"><span>9:41</span><span style="font-size:13px;letter-spacing:2px">●●●● 5G ▮</span></div>
    <img src="${src}" style="display:block;width:${vp.width}px;height:${vp.height}px"></div></div></div>`);
  await (await p.$('#d')).screenshot({ path: arq, omitBackground: true });
  await p.close();
}

// Conversa do WhatsApp no celular do paciente (desenho ilustrativo com o texto REAL enviado pelo sistema)
function htmlConversa(msgs, contato) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const fmt = (s) => esc(s).replace(/\*(.+?)\*/g, '<b>$1</b>').replace(/(https?:\/\/\S+)/g, '<span style="color:#027eb5;text-decoration:underline;word-break:break-all">$1</span>').replace(/\n/g, '<br>');
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    body{margin:0;font:15px/1.4 -apple-system,system-ui,sans-serif;background:#efeae2;height:100vh;display:flex;flex-direction:column}
    .top{background:#f6f6f6;padding:10px 12px 10px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #ddd}
    .av{width:38px;height:38px;border-radius:50%;background:#0f766e;color:#fff;display:grid;place-items:center;font-weight:700}
    .chat{flex:1;padding:12px 10px;display:flex;flex-direction:column;gap:8px;background:#efeae2 radial-gradient(#e2dbd0 1px,transparent 1px) 0 0/18px 18px}
    .dia{align-self:center;background:#fff;border-radius:8px;padding:3px 10px;font-size:12px;color:#555}
    .m{max-width:82%;min-width:76px;padding:7px 10px 18px;border-radius:10px;position:relative;box-shadow:0 1px 1px rgba(0,0,0,.08)}
    .in{background:#fff;align-self:flex-start;border-top-left-radius:2px}.out{background:#d9fdd3;align-self:flex-end;border-top-right-radius:2px}
    .h{position:absolute;right:8px;bottom:3px;font-size:11px;color:#777}
    .bar{background:#f6f6f6;padding:8px 10px 30px;display:flex;gap:8px}.bar div{flex:1;background:#fff;border-radius:20px;padding:9px 14px;color:#999}
  </style><div class="top"><span style="color:#027eb5;font-size:26px">‹</span><div class="av">CV</div><div><b>${esc(contato)}</b><div style="font-size:12px;color:#666">conta comercial</div></div></div>
  <div class="chat"><div class="dia">Hoje</div>${msgs.map((m) => `<div class="m ${m.de === 'clinica' ? 'in' : 'out'}">${fmt(m.texto)}<span class="h">${m.hora}${m.de === 'paciente' ? ' ✓✓' : ''}</span></div>`).join('')}</div>
  <div class="bar"><div>Mensagem</div></div>`;
}

(async () => {
  await db.connect();
  const browser = await chromium.launch();
  const amanha = new Date(Date.now() + 86400000).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

  // Alguns agendamentos já existentes amanhã, para a agenda não ficar vazia
  const { token: tr } = await login('recepcao@clinica.local', 'recepcao123');
  const medicos = await (await fetch(`${BASE}/api/medicos`, { headers: { authorization: `Bearer ${tr}` } })).json();
  const joao = medicos.find((m) => m.nome.startsWith('Dr. João'));
  const maria = medicos.find((m) => m.nome.startsWith('Dra. Maria'));
  const pacs = await (await fetch(`${BASE}/api/pacientes`, { headers: { authorization: `Bearer ${tr}` } })).json();
  const pre = [[joao, '08:00', 0, 'convenio', 'Unimed', 'retorno'], [joao, '10:00', 1, 'particular', null, 'primeira'], [maria, '08:30', 2, 'convenio', 'Bradesco Saúde', 'primeira'],
    [maria, '09:00', 3, 'convenio', 'SulAmérica', 'retorno'], [maria, '10:30', 4, 'particular', null, 'primeira']];
  for (const [m, hora, i, pagamento, convenio, tipo] of pre)
    await fetch(`${BASE}/api/agendamentos`, { method: 'POST', headers: { authorization: `Bearer ${tr}`, 'content-type': 'application/json' },
      body: JSON.stringify({ medico_id: m.id, data: amanha, hora, paciente_id: pacs[i].id, pagamento, convenio, tipo, enviar_whatsapp: false }) });

  // ================= RECEPÇÃO
  const { ctx: cr, page: rec } = await contexto(browser, MAC, 'recepcao@clinica.local', 'recepcao123');
  await rec.goto(`${BASE}/#/recepcao`);
  await rec.waitForSelector('.agv .slot');
  await rec.click('[data-d="1"]');
  await rec.waitForFunction((d) => document.querySelector('#dt')?.value === d, amanha);
  await rec.waitForSelector('.agv .slot.ocupado');
  const slot = `.agv .slot.livre[data-hora="09:30"][data-medcol="${joao.id}"]`;
  await marca(rec, slot, '1. Clique no horário livre');
  await foto(rec, 'Agenda da recepção', 'A recepcionista abre a agenda do dia (aqui, amanhã). Cada médico tem sua coluna, com os horários das 07h às 18h. Ela clica no bloco livre do médico desejado — Dr. João Ricardo, 09:30.');

  await rec.click(slot);
  await rec.waitForSelector('#busca');
  await marca(rec, '#busca', 'Digite o nome do paciente');
  await foto(rec, 'Janela de novo agendamento', 'Abre a janela de agendamento já com médico, data e horário preenchidos. O cursor fica no campo de paciente.');

  await rec.fill('#busca', 'Lucas Ferreira');
  await rec.waitForSelector('#pick li[data-novo]');
  await marca(rec, '#pick li[data-novo]');
  await foto(rec, 'Busca do paciente', 'Ao digitar, o sistema busca no cadastro por nome, CPF ou telefone. Se o paciente já existe, basta clicar no nome (o histórico e o convênio vêm junto). Como é a primeira vez do Lucas, a recepcionista clica em "Cadastrar novo paciente".');

  await rec.dispatchEvent('#pick li[data-novo]', 'mousedown');
  await rec.fill('[name=telefone]', '(11) 98123-4567');
  await rec.fill('[name=data_nascimento]', '1990-04-12');
  await rec.fill('[name=cpf]', '258.147.369-00');
  await rec.selectOption('[name=sexo]', 'M');
  await rec.click('#agf [name=pagamento][value=convenio] + span');
  await rec.fill('[name=convenio]', 'Unimed');
  await rec.fill('[name=carteirinha]', '0 555 123456789');
  await rec.fill('[name=observacoes]', 'Trazer exames de sangue recentes');
  await rec.$eval('.modal-body', (e) => { e.scrollTop = 0; });
  await marca(rec, '#novoPac', 'Dados do paciente');
  await foto(rec, 'Cadastro rápido do paciente', 'Preenche nome, WhatsApp (obrigatório, é para onde vai a confirmação), nascimento, CPF e sexo. O cadastro é criado junto com o agendamento.');

  await rec.$eval('.modal-body', (e) => { e.scrollTop = e.scrollHeight; });
  await marca(rec, '#agf .grid2:has([name=pagamento])');
  await foto(rec, 'Convênio, particular, primeira consulta ou retorno', 'Escolhe Particular ou Convênio (com nome do convênio e carteirinha) e 1ª consulta ou Retorno. Pode deixar uma observação para o médico. A opção "Enviar confirmação por WhatsApp" já vem marcada.');

  await marca(rec, '[data-ok]', '2. Agendar');
  await foto(rec, 'Confirmar o agendamento', 'Clica em Agendar.');

  await rec.click('[data-ok]');
  await rec.waitForSelector('a.btn.wa');
  await marca(rec, 'a.btn.wa', 'Abre o WhatsApp com a mensagem pronta');
  await foto(rec, 'Envio da confirmação por WhatsApp', 'O agendamento é gravado e a mensagem de confirmação é montada automaticamente. Com a integração ligada (API oficial da Meta ou Evolution API), ela é enviada sozinha e aparece só um aviso "Confirmação enviada por WhatsApp ✔". Sem integração (modo manual, mostrado aqui), a recepção toca em "Abrir WhatsApp" e a mensagem já sai pronta para o número do paciente.');
  await rec.click('text=Agora não');
  await rec.waitForSelector('.modal-wrap', { state: 'detached' });
  await marca(rec, `.agv .slot.ocupado:has-text("Lucas Ferreira")`, 'Novo agendamento');
  await foto(rec, 'Agenda atualizada', 'O bloco das 09:30 do Dr. João Ricardo já aparece ocupado com Lucas Ferreira — status "Agendado", 1ª consulta, Unimed — aguardando a confirmação do paciente.');

  // ================= CELULAR DO PACIENTE
  const ag = (await db.query(`SELECT a.id, a.token_confirmacao FROM agendamentos a JOIN pacientes p ON p.id=a.paciente_id WHERE p.nome='Lucas Ferreira'`)).rows[0];
  const msg = (await db.query(`SELECT conteudo FROM whatsapp_mensagens WHERE agendamento_id=$1 AND direcao='saida' ORDER BY id DESC LIMIT 1`, [ag.id])).rows[0].conteudo;
  const textoMsg = msg.replace(/http:\/\/localhost:3000/g, 'https://clinica.seudominio.com.br');
  const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

  const { ctx: cp, page: cel } = await contexto(browser, IPHONE);
  await cel.setContent(htmlConversa([{ de: 'clinica', texto: textoMsg, hora }], 'Clínica Vida & Saúde'));
  await foto(cel, 'Mensagem no celular do paciente', 'O Lucas recebe no WhatsApp a mensagem com médico, dia, horário e endereço. Ele pode responder 1 (confirmar) ou 2 (cancelar), ou tocar no link. (Este é exatamente o texto gerado pelo sistema; com a integração automática ele chega pelo número da clínica.)', 'Paciente');

  await cel.setContent(htmlConversa([{ de: 'clinica', texto: textoMsg, hora }, { de: 'paciente', texto: '1', hora }], 'Clínica Vida & Saúde'));
  await foto(cel, 'Opção A: paciente responde 1', 'Opção A — o paciente simplesmente responde "1". Com a integração ligada, o sistema lê a resposta e marca a consulta como Confirmada automaticamente ("2" cancela e libera o horário).', 'Paciente');

  await cel.goto(`${BASE}/c/${ag.token_confirmacao}`);
  await marca(cel, 'button.ok');
  await foto(cel, 'Opção B: página de confirmação', 'Opção B — tocando no link, abre uma página da clínica com os dados da consulta e os botões Confirmar e Cancelar. Funciona mesmo no modo manual, sem integração.', 'Paciente');

  await cel.click('button.ok');
  await cel.waitForSelector('text=Obrigado');
  await foto(cel, 'Presença confirmada', 'Ao confirmar, o paciente vê a mensagem de agradecimento e o status "Confirmada ✔". No dia anterior à consulta o sistema ainda envia um lembrete automático (com integração ligada).', 'Paciente');
  await cp.close();

  // ================= DE VOLTA À RECEPÇÃO
  await rec.reload();
  await rec.waitForSelector('.agv .slot.ocupado:has-text("Lucas Ferreira")');
  await marca(rec, `.agv .slot.ocupado:has-text("Lucas Ferreira")`, 'Confirmado pelo paciente');
  await foto(rec, 'Recepção vê a confirmação', 'Sem ninguém fazer nada, a agenda da recepção (que se atualiza sozinha a cada 30 s) passa a mostrar "Confirmado" e o ícone verde de WhatsApp no bloco do Lucas.');

  await rec.click('.agv .slot.ocupado:has-text("Lucas Ferreira")');
  await rec.waitForSelector('[data-st=aguardando]');
  await marca(rec, '[data-st=aguardando]', '3. Paciente chegou');
  await foto(rec, 'Paciente chega à clínica', 'No dia, quando o Lucas chega, a recepcionista clica no bloco dele. A janela mostra os dados, o histórico do WhatsApp (data/hora da confirmação) e as ações: Paciente chegou, Faltou, Cancelar, Remarcar, Reenviar WhatsApp. Ela clica em "Paciente chegou".');

  await rec.click('[data-st=aguardando]');
  await rec.waitForSelector('.modal-wrap', { state: 'detached' });
  await marca(rec, `.agv .slot.ocupado:has-text("Lucas Ferreira")`, 'Na recepção');
  await foto(rec, 'Paciente na recepção', 'O bloco muda para "Na recepção" (amarelo). Essa informação vai direto para a tela do médico.');
  await cr.close();

  // ================= MÉDICO
  const { ctx: cm, page: med } = await contexto(browser, MAC, 'joaoricardo@clinica.local', 'medico123');
  await med.goto(`${BASE}/#/agenda`);
  await med.waitForSelector('.ag-item');
  await med.click('[data-d="1"]');
  await med.waitForSelector('.ag-item[data-id]:has-text("Lucas Ferreira")');
  await marca(med, '.ag-item[data-id]:has-text("Lucas Ferreira")', 'Clique para atender');
  await foto(med, 'Agenda do médico', 'Na tela do Dr. João Ricardo, o Lucas aparece destacado como "Na recepção", com 1ª consulta, Unimed e idade. Ao clicar, abre o atendimento já com o prontuário do paciente.', 'Médico');
  await med.click('.ag-item[data-id]:has-text("Lucas Ferreira")');
  await med.waitForSelector('#pront');
  await marca(med, '.info-box', 'Observação da recepção');
  await foto(med, 'Atendimento aberto', 'O atendimento abre com os dados do cadastro feito pela recepção e a observação "Trazer exames de sangue recentes". A partir daqui o médico descreve o caso, emite receita e encerra a consulta.', 'Médico');
  await cm.close();

  // ================= PDF
  const pdf = await browser.newPage();
  const cor = { 'Recepção': '#0f766e', Paciente: '#1f9d55', 'Médico': '#1d4ed8' };
  await pdf.setContent(`<!doctype html><meta charset="utf-8"><style>
    @page{size:297mm 210mm;margin:0} body{margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#14212b}
    .p{width:297mm;height:210mm;page-break-after:always;display:grid;grid-template-columns:78mm 1fr;gap:8mm;padding:12mm;box-sizing:border-box;background:#f3f6f8}
    .p:last-child{page-break-after:auto}
    .txt{display:flex;flex-direction:column;justify-content:center}
    .n{font-size:44pt;font-weight:800;color:#cbd5dd;line-height:1}
    .q{display:inline-block;color:#fff;border-radius:99px;padding:2px 10px;font-size:10pt;font-weight:700;margin:6px 0 10px;align-self:flex-start}
    h2{margin:0 0 8px;font-size:19pt;line-height:1.15} p{margin:0;font-size:11.5pt;line-height:1.5;color:#36434d}
    .img{display:flex;align-items:center;justify-content:center;min-height:0}
    .img img{max-width:100%;max-height:186mm;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.18)}
    .capa{display:flex;flex-direction:column;justify-content:center;padding:24mm}
    .capa h1{font-size:34pt;margin:0 0 6mm} .capa ol{font-size:13pt;line-height:1.8;color:#36434d}
  </style>
  <div class="p capa" style="display:flex"><h1>Fluxo do agendamento</h1>
    <p style="font-size:14pt;max-width:220mm">Sequência completa de telas — da recepção ao celular do paciente e à tela do médico — no sistema da Clínica Vida &amp; Saúde.</p>
    <ol><li><b style="color:#0f766e">Recepção</b> agenda o paciente (passos 1–8)</li><li><b style="color:#1f9d55">Paciente</b> recebe a mensagem e confirma (passos 9–12)</li>
    <li><b style="color:#0f766e">Recepção</b> vê a confirmação e registra a chegada (passos 13–15)</li><li><b style="color:#1d4ed8">Médico</b> atende (passos 16–17)</li></ol></div>
  ${passos.map((s) => `<div class="p"><div class="txt"><div class="n">${s.n}</div><span class="q" style="background:${cor[s.quem]}">${s.quem}</span><h2>${s.titulo}</h2><p>${s.texto}</p></div>
    <div class="img"><img src="data:image/png;base64,${fs.readFileSync(s.arq).toString('base64')}"></div></div>`).join('')}`);
  await pdf.pdf({ path: path.join(OUT, 'fluxo-agendamento.pdf'), preferCSSPageSize: true, printBackground: true });
  await browser.close();
  await db.end();
  fs.writeFileSync(path.join(OUT, 'passos.json'), JSON.stringify(passos.map(({ arq, ...s }) => ({ ...s, arquivo: path.basename(arq) })), null, 2));
  console.log(passos.map((s) => `${s.n}. [${s.quem}] ${s.titulo}`).join('\n'));
})().catch(async (e) => { console.error(e); process.exit(1); });
