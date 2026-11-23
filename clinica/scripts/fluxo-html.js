// Gera a versão HTML (arquivo único, imagens embutidas) do passo a passo da consulta.
// Requer: node scripts/fluxo-agendamento.js já executado; ImageMagick (convert) e poppler (pdftoppm).
// Uso: node scripts/fluxo-html.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const DIR = path.join(__dirname, '..', 'docs', 'fluxo-agendamento');
const passos = JSON.parse(fs.readFileSync(path.join(DIR, 'passos.json'), 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxo-'));

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// PNG -> JPEG reduzido (o arquivo HTML fica leve para abrir no celular)
// Molduras de celular têm fundo transparente: ficam em PNG para não aparecer um quadrado branco no tema escuro
function png(arq, largura = 900) {
  const out = path.join(tmp, 'p-' + path.basename(arq));
  execFileSync('convert', [arq, '-resize', `${largura}x>`, '-strip', out]);
  return 'data:image/png;base64,' + fs.readFileSync(out).toString('base64');
}
function jpeg(arq, largura = 1600) {
  const out = path.join(tmp, path.basename(arq).replace(/\.png$/, '.jpg'));
  execFileSync('convert', [arq, '-background', 'white', '-flatten', '-resize', `${largura}x>`, '-quality', '82', out]);
  return 'data:image/jpeg;base64,' + fs.readFileSync(out).toString('base64');
}
// Página de PDF -> imagem
function pagina(pdf) {
  const base = path.join(tmp, path.basename(pdf, '.pdf'));
  execFileSync('pdftoppm', ['-r', '150', '-png', '-singlefile', pdf, base], { stdio: 'ignore' });
  return jpeg(base + '.png', 1240);
}

const FASES = [
  { id: 'recepcao', nome: 'Recepção agenda', quem: 'Recepção', de: 1, ate: 8 },
  { id: 'paciente', nome: 'Paciente confirma', quem: 'Paciente', de: 9, ate: 12 },
  { id: 'chegada', nome: 'Chegada', quem: 'Recepção', de: 13, ate: 15 },
  { id: 'medico', nome: 'Médico atende', quem: 'Médico', de: 16, ate: 24 },
  { id: 'fim', nome: 'Finalizada', quem: 'Recepção', de: 25, ate: 99 },
];
const COR = { 'Recepção': 'rec', Paciente: 'pac', 'Médico': 'med' };
const celular = (s) => s.quem === 'Paciente';

const secoes = FASES.map((f) => {
  const ps = passos.filter((p) => p.n >= f.de && p.n <= f.ate);
  if (!ps.length) return '';
  return `<section id="${f.id}" class="fase">
    <h2><span class="tag ${COR[f.quem]}">${esc(f.quem)}</span> ${esc(f.nome)} <small>passos ${ps[0].n}${ps.length > 1 ? '–' + ps[ps.length - 1].n : ''}</small></h2>
    ${ps.map((p) => `<article class="passo ${celular(p) ? 'cel' : ''}" id="passo-${p.n}">
      <div class="txt"><div class="num">${p.n}</div><span class="tag ${COR[p.quem]}">${esc(p.quem)}</span>
        <h3>${esc(p.titulo)}</h3><p>${esc(p.texto)}</p></div>
      <button class="shot" aria-label="Ampliar imagem do passo ${p.n}"><img loading="lazy" alt="${esc(p.titulo)}" src="${celular(p) ? png(path.join(DIR, p.arquivo), 700) : jpeg(path.join(DIR, p.arquivo))}"></button>
    </article>`).join('\n')}
  </section>`;
}).join('\n');

const receita = pagina(path.join(DIR, 'anexo-receita.pdf'));
const prontuario = pagina(path.join(DIR, 'anexo-prontuario.pdf'));

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fluxo da consulta</title>
<meta name="description" content="Sequência de telas do sistema da clínica, do agendamento ao fim da consulta, com receita e prontuário.">
<style>
:root{
  --bg:#f3f6f8;--surface:#fff;--line:#dfe6ec;--text:#14212b;--muted:#5b6b77;--faint:#9aa8b3;
  --rec:#0f766e;--pac:#1f9d55;--med:#1d4ed8;--shadow:0 6px 24px rgb(16 24 40 / .12);color-scheme:light;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#0c1318;--surface:#141e25;--line:#24333e;--text:#e5edf2;--muted:#9aabb7;--faint:#5f707c;
  --rec:#2dd4bf;--pac:#4ade80;--med:#7aa2ff;--shadow:0 6px 24px rgb(0 0 0 / .5);color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0c1318;--surface:#141e25;--line:#24333e;--text:#e5edf2;--muted:#9aabb7;--faint:#5f707c;
  --rec:#2dd4bf;--pac:#4ade80;--med:#7aa2ff;--shadow:0 6px 24px rgb(0 0 0 / .5);color-scheme:dark}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:64px}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1200px;margin:0 auto;padding:0 16px}
header.capa{padding-top:48px;padding-bottom:28px}
header.capa h1{font-size:clamp(28px,5vw,44px);line-height:1.1;margin:0 0 12px;letter-spacing:-.02em}
header.capa p{color:var(--muted);max-width:720px;margin:0;font-size:17px}
nav.fases{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
nav.fases .wrap{display:flex;gap:6px;overflow-x:auto;padding-top:10px;padding-bottom:10px;scrollbar-width:none}
nav.fases a{flex:none;text-decoration:none;color:var(--muted);font-weight:600;font-size:14px;padding:7px 12px;border-radius:99px;border:1px solid var(--line);background:var(--surface)}
nav.fases a:hover{color:var(--text)}
.tag{display:inline-block;font-size:12px;font-weight:700;padding:2px 10px;border-radius:99px;color:#fff;vertical-align:middle}
.tag.rec{background:var(--rec)}.tag.pac{background:var(--pac)}.tag.med{background:var(--med)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .tag{color:#04201d}}
:root[data-theme="dark"] .tag{color:#04201d}
.fase{padding:28px 0 8px}
.fase>h2{font-size:22px;margin:0 0 18px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.fase>h2 small{font-size:14px;color:var(--faint);font-weight:500}
.passo{display:grid;grid-template-columns:300px 1fr;gap:28px;align-items:center;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:24px;margin-bottom:18px}
.passo .num{font-size:44px;font-weight:800;line-height:1;color:var(--faint);opacity:.6}
.passo h3{font-size:21px;line-height:1.2;margin:10px 0 8px}
.passo p{margin:0;color:var(--muted)}
.shot{all:unset;cursor:zoom-in;display:block;justify-self:center;max-width:100%}
.shot img{display:block;max-width:100%;height:auto;border-radius:10px;box-shadow:var(--shadow);border:1px solid var(--line)}
.passo.cel .shot img{max-height:560px;width:auto;border:0;box-shadow:none}
.shot:focus-visible img{outline:3px solid var(--rec);outline-offset:3px}
.anexos{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.doc{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:20px}
.doc h3{margin:0 0 4px}.doc p{margin:0 0 14px;color:var(--muted);font-size:14px}
.doc .shot img{background:#fff}
footer{padding:32px 0 48px;color:var(--faint);font-size:14px}
.tema{flex:none;margin-left:auto;border:1px solid var(--line);background:var(--surface);color:var(--muted);border-radius:99px;padding:7px 12px;font:inherit;font-size:14px;font-weight:600;cursor:pointer}
dialog{border:0;padding:0;background:transparent;max-width:96vw;max-height:94vh}
dialog::backdrop{background:rgb(5 10 14 / .85)}
dialog img{display:block;max-width:96vw;max-height:94vh;border-radius:8px;background:#fff}
dialog button{position:fixed;top:12px;right:12px;width:44px;height:44px;border-radius:50%;border:0;background:#fff;color:#111;font-size:22px;cursor:pointer}
@media (max-width:820px){
  .passo{grid-template-columns:1fr;gap:16px;padding:16px}
  .passo .num{font-size:34px}
  .anexos{grid-template-columns:1fr}
  .passo.cel .shot img{max-height:520px}
}
@media print{nav.fases,.tema{display:none}.passo{break-inside:avoid}}
</style>
</head>
<body>
<header class="capa wrap">
  <h1>Do agendamento ao fim da consulta</h1>
  <p>Sequência completa de telas do sistema da Clínica Vida &amp; Saúde — recepção, celular do paciente e médico — com a receita e o prontuário gerados nesta consulta. Toque em qualquer imagem para ampliar.</p>
</header>
<nav class="fases" aria-label="Etapas"><div class="wrap">
  ${FASES.map((f) => `<a href="#${f.id}">${esc(f.nome)}</a>`).join('')}<a href="#anexos">Receita e prontuário</a><button class="tema" id="tema" type="button" aria-label="Alternar tema claro/escuro">◐ Tema</button>
</div></nav>
<main class="wrap">
${secoes}
<section id="anexos" class="fase">
  <h2>Anexos <small>documentos gerados nesta consulta</small></h2>
  <div class="anexos">
    <div class="doc"><h3>Receita</h3><p>Papel A5, com o cabeçalho do médico.</p><button class="shot" aria-label="Ampliar receita"><img loading="lazy" alt="Receita" src="${receita}"></button></div>
    <div class="doc"><h3>Prontuário</h3><p>Registro do atendimento, papel A4.</p><button class="shot" aria-label="Ampliar prontuário"><img loading="lazy" alt="Prontuário" src="${prontuario}"></button></div>
  </div>
</section>
</main>
<footer class="wrap">Telas capturadas do sistema em funcionamento, com dados de demonstração. A conversa de WhatsApp é ilustrativa, com o texto real gerado pelo sistema.</footer>
<dialog id="zoom"><button type="button" aria-label="Fechar">×</button><img alt=""></dialog>
<script>
(function(){
  var d=document.getElementById('zoom'), im=d.querySelector('img');
  document.querySelectorAll('.shot').forEach(function(b){b.addEventListener('click',function(){im.src=b.querySelector('img').src;im.alt=b.querySelector('img').alt;d.showModal();});});
  d.addEventListener('click',function(){d.close();});
  var r=document.documentElement, t=document.getElementById('tema');
  function aplica(v){if(v){r.setAttribute('data-theme',v);}else{r.removeAttribute('data-theme');}}
  try{aplica(localStorage.getItem('tema'));}catch(e){}
  t.addEventListener('click',function(){
    var escuro=r.getAttribute('data-theme')==='dark'||(!r.getAttribute('data-theme')&&matchMedia('(prefers-color-scheme: dark)').matches);
    var v=escuro?'light':'dark'; aplica(v); try{localStorage.setItem('tema',v);}catch(e){}
  });
})();
</script>
</body>
</html>`;

const out = path.join(DIR, 'fluxo-completo-consulta.html');
fs.writeFileSync(out, html);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(out, (fs.statSync(out).size / 1048576).toFixed(1) + ' MB');
