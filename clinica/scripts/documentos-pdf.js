// Gera PDFs dos documentos impressos pelo médico (com o cabeçalho dele), usando os botões reais do sistema:
// receita simples A5 e A4, receita de controle especial (2 vias), prontuário e atestado.
// Uso: servidor rodando com dados de demonstração -> node scripts/documentos-pdf.js
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = path.join(__dirname, '..', 'docs', 'documentos');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const r = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'marialuisa@clinica.local', senha: 'medico123' }) });
  const { token, user } = await r.json();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  await ctx.addInitScript(([t, u]) => { localStorage.setItem('token', t); localStorage.setItem('user', u); window.print = () => {}; }, [token, JSON.stringify(user)]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw e; });

  const salvarPdf = async (nome) => {
    await page.waitForSelector('#print-area .doc', { state: 'attached' });
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: path.join(OUT, nome), preferCSSPageSize: true, printBackground: true });
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(() => { document.getElementById('print-area').innerHTML = ''; });
    console.log(nome);
  };

  // Abre o atendimento da paciente com histórico e preenche o prontuário
  await page.goto(`${BASE}/#/agenda`);
  await page.click('.ag-item[data-id] >> text=Maria Aparecida');
  await page.waitForSelector('#pront');
  await page.fill('[name=queixa]', 'Retorno com exames. Refere melhora da cefaleia após ajuste da medicação. Ainda apresenta tontura ocasional ao levantar e dificuldade para dormir há cerca de 1 mês.');
  await page.fill('[name=anamnese]', 'Hipertensa há 10 anos, aderente à losartana 50 mg 12/12h. Nega dor torácica, dispneia ou edema. Refere insônia inicial, sem sintomas depressivos maiores.\nExames (15/11): colesterol total 232, LDL 151, HDL 48, TG 165, creatinina 0,9, K 4,3, glicemia 94.');
  await page.fill('[name=exame_fisico]', 'BEG, corada, hidratada. PA 132/84 mmHg (sentada) e 124/78 mmHg (em pé). FC 76 bpm. Peso 71 kg, IMC 27,4.\nACV: RCR 2T, BNF, sem sopros. AP: MV+ bilateral, sem RA.');
  await page.fill('[name=diagnostico]', 'HAS controlada (I10) · Dislipidemia (E78.5) · Insônia (G47.0)');
  await page.fill('[name=conduta]', 'Mantida losartana 50 mg 12/12h. Iniciada atorvastatina 20 mg à noite. Clonazepam 0,5 mg à noite por 30 dias, com orientações de higiene do sono. Dieta hipossódica e hipolipídica; caminhada 30 min, 5x/semana. Retorno em 3 meses com perfil lipídico, TGO/TGP e CPK.');
  await page.click('#pront button[type=submit]');
  await page.waitForSelector('text=Salvo às');

  // ---- Receita simples (A5 e A4)
  for (const tamanho of ['A5', 'A4']) {
    await page.click('.at-head [data-receita]');
    await page.waitForSelector('#itens .med-row');
    const linha = (i) => `#itens .med-row >> nth=${i}`;
    await page.fill(`${linha(0)} >> [data-k=medicamento]`, 'Atorvastatina cálcica 20 mg');
    await page.fill(`${linha(0)} >> [data-k=quantidade]`, '30 comprimidos');
    await page.fill(`${linha(0)} >> [data-k=posologia]`, 'Tomar 1 comprimido à noite, uso contínuo.');
    await page.click('[data-add]');
    await page.fill(`${linha(1)} >> [data-k=medicamento]`, 'Losartana potássica 50 mg');
    await page.fill(`${linha(1)} >> [data-k=quantidade]`, '60 comprimidos');
    await page.fill(`${linha(1)} >> [data-k=posologia]`, 'Tomar 1 comprimido de 12 em 12 horas, uso contínuo.');
    await page.click('[data-add]');
    await page.fill(`${linha(2)} >> [data-k=medicamento]`, 'Cetoconazol creme 2%');
    await page.fill(`${linha(2)} >> [data-k=quantidade]`, '1 bisnaga');
    await page.fill(`${linha(2)} >> [data-k=posologia]`, 'Aplicar fina camada na região afetada 2 vezes ao dia por 14 dias.');
    await page.selectOption(`${linha(2)} >> [data-k=via]`, 'Tópico');
    await page.fill('#rxf [name=observacoes]', 'Trazer esta receita no retorno.');
    await page.click(`[name=tamanho][value=${tamanho}] + span`);
    await page.click('[data-ok]');
    await salvarPdf(`receita-simples-${tamanho}.pdf`);
    await page.waitForSelector('.modal-wrap', { state: 'detached' });
  }

  // ---- Receita de controle especial (sempre A4, 1ª via farmácia + 2ª via paciente)
  await page.click('.at-head [data-receita]');
  await page.waitForSelector('#itens .med-row');
  await page.click('[name=tipo][value=controle_especial] + span');
  await page.fill('#itens .med-row >> nth=0 >> [data-k=medicamento]', 'Clonazepam 0,5 mg');
  await page.fill('#itens .med-row >> nth=0 >> [data-k=quantidade]', '30 (trinta) comprimidos');
  await page.fill('#itens .med-row >> nth=0 >> [data-k=posologia]', 'Tomar 1 comprimido à noite, 30 minutos antes de deitar, por 30 dias.');
  await page.click('[data-ok]');
  await salvarPdf('receita-controle-especial-A4.pdf');
  await page.waitForSelector('.modal-wrap', { state: 'detached' });

  // ---- Prontuário (registro do atendimento, A4)
  await page.click('.at-head [data-pront]');
  await salvarPdf('prontuario-atendimento-A4.pdf');

  // ---- Atestado (A5)
  await page.click('.at-head [data-atestado]');
  await page.fill('#atf [name=dias]', '2');
  await page.click('[data-ok]');
  await salvarPdf('atestado-A5.pdf');

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
