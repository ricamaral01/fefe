// Gera as telas da Recepção, Agenda do médico e Atendimento em MacBook, iPad, Windows e iPhone,
// dentro de uma moldura do aparelho, e junta tudo em um PDF.
// Uso: servidor rodando com dados de demonstração -> node scripts/telas-dispositivos.js
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = path.join(__dirname, '..', 'docs', 'telas-dispositivos');
const RAW = path.join(OUT, '.capturas');
fs.mkdirSync(RAW, { recursive: true });

const APARELHOS = [
  { id: 'macbook', nome: 'MacBook', ctx: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 } },
  { id: 'ipad', nome: 'iPad', ctx: devices['iPad Pro 11 landscape'] },
  { id: 'windows', nome: 'Windows', ctx: { viewport: { width: 1536, height: 864 }, deviceScaleFactor: 1.25 } },
  { id: 'iphone', nome: 'iPhone', ctx: devices['iPhone 15 Pro'] },
];
const TELAS = [
  { id: '1-recepcao', nome: 'Recepção — agenda vertical por médico' },
  { id: '2-agenda-medico', nome: 'Médico — agenda do dia' },
  { id: '3-atendimento', nome: 'Médico — atendimento / prontuário' },
];

async function token(email, senha) {
  const r = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, senha }) });
  return r.json();
}

async function abrir(browser, ap, login) {
  const { token: t, user } = await token(...login);
  const ctx = await browser.newContext({ ...ap.ctx, colorScheme: 'light', locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  await ctx.addInitScript(([a, b]) => { localStorage.setItem('token', a); localStorage.setItem('user', b); }, [t, JSON.stringify(user)]);
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  return { ctx, page, erros };
}

// Moldura desenhada em CSS em volta da captura
function moldura(ap, img, w, h) {
  const src = 'data:image/png;base64,' + fs.readFileSync(img).toString('base64');
  const tela = `<img src="${src}" style="display:block;width:${w}px;height:${h}px">`;
  const css = `*{box-sizing:border-box}body{margin:0;background:transparent;font-family:-apple-system,Segoe UI,Roboto,sans-serif}#d{display:inline-block;padding:40px 100px}`;
  let corpo;
  if (ap.id === 'macbook') {
    corpo = `<div style="background:#1b1d21;border-radius:22px 22px 0 0;padding:26px 22px 22px;border:2px solid #3a3d44">${tela}</div>
      <div style="height:22px;margin:0 -70px;background:linear-gradient(#d4d6da,#a9acb2);border-radius:0 0 26px 26px;position:relative">
      <div style="position:absolute;left:50%;top:0;width:180px;height:9px;margin-left:-90px;background:#9a9da3;border-radius:0 0 10px 10px"></div></div>`;
  } else if (ap.id === 'ipad') {
    corpo = `<div style="background:#18191c;border-radius:44px;padding:34px;border:3px solid #4a4c52">${tela}</div>`;
  } else if (ap.id === 'windows') {
    corpo = `<div style="background:#0f1115;border-radius:10px;padding:18px 18px 30px;border:2px solid #2c2f36">
      <div style="background:#e9edf2;height:40px;display:flex;align-items:center;gap:10px;padding:0 14px;border-radius:4px 4px 0 0;font-size:14px;color:#333">
        <span style="background:#fff;border-radius:6px;padding:6px 14px;flex:1;color:#555">🔒 clinica.seudominio.com.br</span><span>— ☐ ✕</span></div>${tela}
      <div style="text-align:center;color:#8a93a0;font-size:13px;margin-top:8px;letter-spacing:.2em">WINDOWS</div></div>
      <div style="width:260px;height:70px;margin:0 auto;background:linear-gradient(#2a2d33,#1a1c20);clip-path:polygon(30% 0,70% 0,85% 100%,15% 100%)"></div>
      <div style="width:420px;height:14px;margin:0 auto;background:#2a2d33;border-radius:8px"></div>`;
  } else {
    corpo = `<div style="background:#111;border-radius:64px;padding:16px;border:3px solid #5d5f66;position:relative">
      <div style="position:absolute;left:50%;top:30px;width:120px;height:34px;margin-left:-60px;background:#000;border-radius:20px;z-index:2"></div>
      <div style="border-radius:50px;overflow:hidden;background:#f3f6f8">
        <div style="height:54px;display:flex;align-items:center;justify-content:space-between;padding:6px 34px 0 44px;font-weight:600;font-size:16px;color:#111">
          <span>9:41</span><span style="font-size:13px;letter-spacing:2px">●●●● 5G ▮</span></div>${tela}</div></div>`;
  }
  return `<!doctype html><style>${css}</style><div id="d">${corpo}</div>`;
}

(async () => {
  const browser = await chromium.launch();
  const gerados = [];
  for (const ap of APARELHOS) {
    // ---- recepção
    {
      const { ctx, page, erros } = await abrir(browser, ap, ['recepcao@clinica.local', 'recepcao123']);
      await page.goto(`${BASE}/#/recepcao`);
      await page.waitForSelector('.agv .slot');
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(RAW, `${ap.id}-1-recepcao.png`) });
      if (erros.length) throw new Error(erros.join('\n'));
      await ctx.close();
    }
    // ---- médico: agenda e atendimento
    {
      const { ctx, page, erros } = await abrir(browser, ap, ['marialuisa@clinica.local', 'medico123']);
      await page.goto(`${BASE}/#/agenda`);
      await page.waitForSelector('.ag-item[data-id]');
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(RAW, `${ap.id}-2-agenda-medico.png`) });
      await page.click('.ag-item[data-id] >> text=Maria Aparecida');
      await page.waitForSelector('#pront');
      await page.fill('[name=queixa]', 'Retorno com exames. Refere melhora da cefaleia após ajuste da medicação. Ainda apresenta tontura ocasional ao levantar.');
      await page.fill('[name=anamnese]', 'Aderente à losartana 50 mg 12/12h. Nega dor torácica ou dispneia. Exames: colesterol total 232, LDL 151, creatinina 0,9.');
      await page.fill('[name=exame_fisico]', 'PA 132/84 mmHg · FC 76 bpm · Peso 71 kg. Bom estado geral.');
      await page.fill('[name=diagnostico]', 'HAS controlada (I10) · Dislipidemia (E78.5)');
      await page.fill('[name=conduta]', 'Mantida losartana. Iniciada atorvastatina 20 mg à noite. Retorno em 3 meses com perfil lipídico.');
      await page.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll('.toast').forEach((t) => t.remove()); });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(RAW, `${ap.id}-3-atendimento.png`) });
      if (erros.length) throw new Error(erros.join('\n'));
      await ctx.close();
    }
    // ---- molduras
    const vp = ap.ctx.viewport;
    const escala = ap.id === 'iphone' ? 1 : ap.id === 'windows' ? 1 : 1; // tamanho da imagem em CSS px = viewport
    for (const t of TELAS) {
      const p = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 2400, height: 1600 } });
      await p.setContent(moldura(ap, path.join(RAW, `${ap.id}-${t.id}.png`), vp.width * escala, vp.height * escala));
      const arq = path.join(OUT, `${t.id}-${ap.id}.png`);
      await (await p.$('#d')).screenshot({ path: arq, omitBackground: true });
      gerados.push({ ap, t, arq });
      await p.close();
    }
  }

  // ---- PDF com todas as telas (uma por página)
  const pg = await browser.newPage();
  const paginas = TELAS.flatMap((t) => APARELHOS.map((ap) => gerados.find((g) => g.t === t && g.ap === ap)));
  await pg.setContent(`<!doctype html><style>
    @page{size:297mm 210mm;margin:0} body{margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#14212b}
    .p{width:297mm;height:210mm;page-break-after:always;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#eef3f5;padding:10mm}
    .p:last-child{page-break-after:auto} h1{margin:0 0 2mm;font-size:20pt} h2{margin:0 0 6mm;font-weight:500;color:#0f766e;font-size:14pt}
    .p img{max-width:100%;max-height:160mm;object-fit:contain}
    .capa h1{font-size:34pt}.capa p{font-size:14pt;color:#5b6b77;text-align:center;max-width:200mm}</style>
    <div class="p capa"><h1>Clínica Vida &amp; Saúde</h1><p>Telas do sistema em MacBook, iPad, Windows e iPhone:<br>Recepção (agenda vertical por médico), Agenda do médico e Atendimento.</p></div>
    ${paginas.map((g) => `<div class="p"><h1>${g.t.nome}</h1><h2>${g.ap.nome}</h2><img src="data:image/png;base64,${fs.readFileSync(g.arq).toString('base64')}"></div>`).join('')}`);
  await pg.pdf({ path: path.join(OUT, 'telas-clinica.pdf'), preferCSSPageSize: true, printBackground: true });
  await browser.close();
  fs.rmSync(RAW, { recursive: true, force: true });
  console.log(gerados.map((g) => path.basename(g.arq)).join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
