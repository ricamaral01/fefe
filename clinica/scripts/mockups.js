// Gera as telas (mockups) do sistema em vários dispositivos e testa o fluxo principal.
// Uso: servidor rodando com dados de demonstração (SEED_DEMO=true) -> npm run mockups
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = path.join(__dirname, '..', 'docs', 'mockups');
fs.mkdirSync(OUT, { recursive: true });

const DISPOSITIVOS = {
  macbook: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  ipad: devices['iPad Pro 11 landscape'],
  iphone: devices['iPhone 15 Pro'],
  android: devices['Pixel 7'],
};

const erros = [];
async function login(browser, disp, email, senha) {
  const r = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, senha }) });
  const { token, user } = await r.json();
  const ctx = await browser.newContext({ ...DISPOSITIVOS[disp], colorScheme: 'light', locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  await ctx.addInitScript(([t, u]) => { localStorage.setItem('token', t); localStorage.setItem('user', u); window.print = () => {}; }, [token, JSON.stringify(user)]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => erros.push(`${disp}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && erros.push(`${disp} console: ${m.text()}`));
  return { ctx, page };
}
const shot = (page, nome, full = false) => page.screenshot({ path: path.join(OUT, `${nome}.png`), fullPage: full });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();

  // ---------- login
  for (const d of ['macbook', 'iphone']) {
    const ctx = await browser.newContext({ ...DISPOSITIVOS[d], locale: 'pt-BR' });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/#/login`);
    await page.waitForSelector('form');
    await shot(page, `01-login-${d}`);
    await ctx.close();
  }

  // ---------- recepção
  for (const d of ['macbook', 'ipad', 'android']) {
    const { ctx, page } = await login(browser, d, 'recepcao@clinica.local', 'recepcao123');
    await page.goto(`${BASE}/#/recepcao`);
    await page.waitForSelector('.agv .slot');
    await shot(page, `02-recepcao-${d}`);
    if (d === 'macbook') {
      await page.$eval('#agv', (e) => { const t = [...e.querySelectorAll('.agv-time')].find((x) => x.textContent === '11:00'); e.scrollTop = t.offsetTop - 60; });
      await page.hover('.slot.fora >> nth=0');
      await shot(page, `02b-recepcao-tarde-${d}`);
      await page.$eval('#agv', (e) => { e.scrollTop = 0; });
    }
    if (d === 'macbook' || d === 'android') {
      // novo agendamento em um bloco livre
      await page.click('.agv .slot.livre:not(.passado) >> nth=0');
      await page.fill('#busca', 'Lucas Ferreira');
      await page.waitForSelector('#pick li[data-novo]');
      await page.dispatchEvent('#pick li[data-novo]', 'mousedown');
      await page.fill('[name=telefone]', '(11) 98123-4567');
      await page.fill('[name=data_nascimento]', '1990-04-12');
      await page.click('text=Convênio');
      await page.fill('[name=convenio]', 'Unimed');
      await page.fill('[name=carteirinha]', '0 555 123456789');
      await page.fill('[name=observacoes]', 'Trazer exames de sangue recentes');
      await espera(200);
      await shot(page, `03-novo-agendamento-${d}`);
      if (d === 'macbook') {
        await page.click('[data-ok]');
        await page.waitForSelector('a.btn.wa');
        await shot(page, `04-whatsapp-${d}`);
        await page.click('text=Agora não');
        // detalhes de um agendamento existente
        await page.click('.agv .slot.ocupado.st-agendado >> nth=0');
        await page.waitForSelector('[data-st]');
        await shot(page, `05-detalhes-agendamento-${d}`);
        await page.click('[data-st=aguardando]');
        await page.waitForSelector('.modal-wrap', { state: 'detached' });
      } else {
        await page.click('[data-close] >> nth=0');
      }
    }
    await ctx.close();
  }

  // ---------- médico: agenda
  for (const d of ['ipad', 'iphone', 'macbook']) {
    const { ctx, page } = await login(browser, d, 'marialuisa@clinica.local', 'medico123');
    await page.goto(`${BASE}/#/agenda`);
    await page.waitForSelector('.ag-item[data-id]');
    await shot(page, `06-agenda-medico-${d}`);
    // abre o atendimento da Maria (tem histórico)
    await page.click('.ag-item[data-id] >> text=Maria Aparecida');
    await page.waitForSelector('#pront');
    {
      await page.fill('[name=queixa]', 'Retorno com exames. Refere melhora da cefaleia após ajuste da medicação. Ainda apresenta tontura ocasional ao levantar.');
      await page.fill('[name=anamnese]', 'Aderente à losartana 50 mg 12/12h. Nega dor torácica, dispneia ou edema. Exames: colesterol total 232, LDL 151, creatinina 0,9, K 4,3.');
      await page.fill('[name=exame_fisico]', 'PA 132/84 mmHg · FC 76 bpm · Peso 71 kg · IMC 27,4. Bom estado geral.');
      await page.fill('[name=diagnostico]', 'HAS controlada (I10) · Dislipidemia (E78.5)');
      await page.fill('[name=conduta]', 'Mantida losartana. Iniciada atorvastatina 20 mg. Orientada dieta e atividade física. Retorno em 3 meses com perfil lipídico.');
      await page.click('.at-head [data-salvar], #pront button[type=submit]');
      await page.waitForSelector('text=Salvo às');
      await page.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll('.toast').forEach((t) => t.remove()); });
    }
    await shot(page, `07-atendimento-${d}`);
    if (d === 'iphone') {
      await page.click('.tabs-m >> text=Histórico');
      await shot(page, `08-historico-${d}`);
    }
    if (d === 'macbook') {
      await page.click('.at-head [data-receita]');
      await page.waitForSelector('#itens .med-row');
      await page.fill('#itens .med-row >> nth=0 >> [data-k=medicamento]', 'Atorvastatina cálcica 20 mg');
      await page.fill('#itens .med-row >> nth=0 >> [data-k=quantidade]', '30 comprimidos');
      await page.fill('#itens .med-row >> nth=0 >> [data-k=posologia]', 'Tomar 1 comprimido à noite, uso contínuo.');
      await page.click('[data-add]');
      await page.fill('#itens .med-row >> nth=1 >> [data-k=medicamento]', 'Losart');
      await page.waitForSelector('.sugs li');
      await shot(page, `09-receita-autocompletar-${d}`);
      await page.dispatchEvent('.sugs li >> nth=0', 'mousedown');
      await page.click('[name=tamanho][value=A4] + span');
      await shot(page, `10-receita-editor-${d}`);
      await page.click('[data-ok]');
      await page.waitForSelector('#print-area .doc', { state: 'attached' });
      await page.emulateMedia({ media: 'print' });
      await page.pdf({ path: path.join(OUT, 'receita-exemplo.pdf'), preferCSSPageSize: true, printBackground: true });
      const prev = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2 });
      await prev.setContent(`<link rel="stylesheet" href="${BASE}/css/app.css"><body style="background:#fff;margin:0;padding:12mm">${await page.$eval('#print-area', (e) => e.innerHTML)}</body>`);
      await prev.addStyleTag({ content: '#print-area{display:block} .doc .page{min-height:calc(297mm - 24mm)}' });
      await espera(300);
      await prev.screenshot({ path: path.join(OUT, '11-receita-impressa-A4.png') });
      await prev.close();
      await page.emulateMedia({ media: 'screen' });
      await page.waitForSelector('.rx-row');
      // encerrar consulta -> volta para a agenda
      await page.click('.at-head [data-encerrar]');
      await page.click('[data-ok]');
      await page.waitForSelector('.ag-item[data-id]');
      await espera(300);
      await shot(page, `12-agenda-apos-encerrar-${d}`);
      // cabeçalho do médico
      await page.goto(`${BASE}/#/perfil`);
      await page.waitForSelector('#prev .dn');
      await shot(page, `13-meu-cabecalho-${d}`);
    }
    await ctx.close();
  }

  // ---------- admin: configurações
  {
    const { ctx, page } = await login(browser, 'macbook', 'admin@clinica.local', 'trocar123');
    await page.goto(`${BASE}/#/config`);
    await page.waitForSelector('tr[data-i]');
    await shot(page, '14-config-usuarios-macbook');
    await page.click('text=Horários');
    await page.waitForSelector('#ht');
    await shot(page, '15-config-horarios-macbook');
    await ctx.close();
  }

  // ---------- página que o paciente abre pelo WhatsApp
  {
    const { Client } = require('pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://clinica:clinica@localhost:5432/clinica' });
    await c.connect();
    const { rows } = await c.query(`SELECT token_confirmacao FROM agendamentos WHERE status='agendado' ORDER BY data DESC, hora LIMIT 1`);
    await c.end();
    const ctx = await browser.newContext({ ...DISPOSITIVOS.iphone, locale: 'pt-BR' });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/c/${rows[0].token_confirmacao}`);
    await shot(page, '16-confirmacao-paciente-iphone');
    await ctx.close();
  }

  await browser.close();
  if (erros.length) { console.error('ERROS NO NAVEGADOR:\n' + erros.join('\n')); process.exit(1); }
  console.log('Mockups gerados em', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
