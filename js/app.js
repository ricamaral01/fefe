/**
 * Controle de Slump — lógica principal (PWA).
 * Separação: HTML estrutura, CSS estilo, este arquivo = regras e exportação.
 */

const STORAGE_KEY = 'slump-controle-v1';
const HISTORY_KEY = 'slump-history-v1';
const HISTORY_MAX = 25;

/**
 * Google Apps Script — Web App (URL termina em /exec).
 * Onde colar: substitua a string abaixo pela URL copiada em "Gerenciar implantações".
 */
const URL_API = 'https://script.google.com/macros/s/AKfycbxXI4Q-Q13y8j6tCsD1MtHlf1Ve0QUokrGn-Z8v-GXuSMSImveBsjyqmf4GDglcIWlW/exec';

/** Colunas esperadas na planilha (ordem do backend) — usado para render da tabela local */
const COLS_PLANILHA = [
  'Data',
  'Traço',
  'Volume',
  'Cimento',
  'Areia',
  'Brita',
  'Água',
  'Aditivo',
  'Slump_T0',
  'Slump_T15',
  'Slump_Final',
  'Temp',
  'Umidade',
  'Hora',
  'R7',
  'R28',
  'Observações'
];

/** Instâncias Chart.js (para atualizar e exportar imagem no PDF) */
let chartSlumpInstance = null;
let chartAguaInstance = null;
let chartResistenciaInstance = null;

/** Referência ao prompt de instalação PWA */
let deferredPrompt = null;

/** Últimas linhas retornadas pelo GET (para importar na aba Dados) */
let cachedSheetRows = [];

/** Ativa aba por nome (preenchido em setupTabs) */
let activateTabFn = null;

/** Callback opcional ao clicar OK no modal */
let modalOnOk = null;

function $(id) {
  return document.getElementById(id);
}

/* ---------- Design system / UX: pill, modal, histórico, abas ---------- */

function setAppPill(variant, text) {
  const pill = $('app-status-pill');
  const label = $('app-status-text');
  if (!pill || !label) return;
  pill.classList.remove('pill--ok', 'pill--warn', 'pill--err');
  pill.classList.add(
    variant === 'err' ? 'pill--err' : variant === 'warn' ? 'pill--warn' : 'pill--ok'
  );
  label.textContent = text;
}

function showModal(message, opts = {}) {
  const { showCancel = false, okText = 'OK', onOk = null } = opts;
  modalOnOk = onOk;
  const overlay = $('modal-overlay');
  const msg = $('modal-message');
  const ok = $('modal-ok');
  const cancel = $('modal-cancel');
  if (!overlay || !msg || !ok) return;
  msg.textContent = message;
  ok.textContent = okText;
  if (cancel) cancel.classList.toggle('hidden', !showCancel);
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
  ok.focus();
}

function closeModal() {
  const overlay = $('modal-overlay');
  if (!overlay) return;
  modalOnOk = null;
  overlay.classList.add('hidden');
  overlay.setAttribute('aria-hidden', 'true');
  $('modal-cancel')?.classList.add('hidden');
  const ok = $('modal-ok');
  if (ok) ok.textContent = 'OK';
}

function pushHistory(action, detail) {
  try {
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    list.unshift({ at: new Date().toISOString(), action, detail: String(detail || '').slice(0, 160) });
    while (list.length > HISTORY_MAX) list.pop();
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    renderHistoryList();
  } catch (e) {
    console.warn('[History]', e);
  }
}

function renderHistoryList() {
  const ul = $('history-list');
  const empty = $('history-empty');
  if (!ul || !empty) return;
  let list = [];
  try {
    list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    list = [];
  }
  if (!list.length) {
    ul.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  const fmt = (iso) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return iso;
    }
  };
  ul.innerHTML = list
    .map(
      (h) =>
        `<li class="history-list__item"><span class="history-list__time">${fmt(h.at)}</span><span class="history-list__action">${escapeHtml(h.action)}</span><span class="history-list__detail">${escapeHtml(h.detail)}</span></li>`
    )
    .join('');
}

/** Opções Chart.js — tema claro (cards brancos) */
function chartThemeOptions() {
  const text = '#5a6a7e';
  const grid = 'rgba(26, 40, 64, 0.08)';
  return {
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          color: text,
          boxWidth: 14,
          padding: 14,
          font: { size: 11, weight: '600' }
        }
      }
    },
    scales: {
      x: {
        ticks: { color: text },
        grid: { color: grid }
      },
      y: {
        ticks: { color: text },
        grid: { color: grid },
        border: { color: grid }
      }
    }
  };
}

function setupTabs() {
  const buttons = document.querySelectorAll('.segmented__btn[data-tab]');
  const panels = {
    dados: $('view-dados'),
    graficos: $('view-graficos'),
    nuvem: $('view-nuvem')
  };
  function activate(tab) {
    buttons.forEach((b) => {
      const on = b.getAttribute('data-tab') === tab;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    Object.entries(panels).forEach(([key, el]) => {
      if (!el) return;
      el.classList.toggle('is-visible', key === tab);
    });
    if (tab === 'graficos') {
      requestAnimationFrame(() => refreshCharts());
    }
  }
  activateTabFn = activate;
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => activate(btn.getAttribute('data-tab')));
  });
}

function goToTab(tab) {
  if (typeof activateTabFn === 'function') activateTabFn(tab);
}

function setupModal() {
  $('modal-ok')?.addEventListener('click', () => {
    const fn = modalOnOk;
    modalOnOk = null;
    if (typeof fn === 'function') {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    }
    closeModal();
  });
  $('modal-cancel')?.addEventListener('click', () => {
    modalOnOk = null;
    closeModal();
  });
  $('modal-overlay')?.addEventListener('click', (e) => {
    if (e.target === $('modal-overlay')) {
      modalOnOk = null;
      closeModal();
    }
  });
}

/* ---------- Persistência local (offline) ---------- */

function collectState() {
  return {
    objetivo: $('objetivo').value,
    projeto: $('projeto').value,
    fck: $('fck').value,
    slumpMeta: $('slumpMeta').value,
    dataEnsaio: $('dataEnsaio').value,
    responsaveis: $('responsaveis').value,
    volumeLitros: $('volumeLitros').value,
    descricaoTraco: $('descricaoTraco').value,
    acTeorico: $('acTeorico').value,
    arTeorico: $('arTeorico').value,
    dosagemAditivo1: $('dosagemAditivo1').value,
    dosagemAditivo2: $('dosagemAditivo2').value,
    observacoesGerais: $('observacoesGerais').value,
    materiais: readMateriaisFromDom(),
    ensaios: readEnsaiosFromDom(),
    resistencias: readResistenciasFromDom()
  };
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(collectState()));
  } catch (e) {
    console.warn('localStorage', e);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/* ---------- Materiais: linhas dinâmicas + cálculo batelada ---------- */

function materialRowTemplate(m = {}) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="m-nome" placeholder="Material" value="${escapeAttr(m.nome || '')}" /></td>
    <td><input type="number" class="m-kgm3" inputmode="decimal" step="0.01" min="0" value="${m.kgM3 ?? ''}" /></td>
    <td><input type="number" class="m-u" inputmode="decimal" step="0.01" min="0" value="${m.umidade ?? ''}" /></td>
    <td><input type="number" class="m-rho" inputmode="decimal" step="0.01" min="0" value="${m.rho ?? ''}" /></td>
    <td><button type="button" class="btn-icon rm-material" title="Remover">×</button></td>
  `;
  tr.querySelector('.rm-material').addEventListener('click', () => {
    tr.remove();
    recalcMateriaisPreview();
    saveState();
    refreshCharts();
  });
  tr.querySelectorAll('input').forEach((inp) => {
    inp.addEventListener('input', () => {
      recalcMateriaisPreview();
      saveState();
    });
  });
  return tr;
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;');
}

function readMateriaisFromDom() {
  const rows = [...document.querySelectorAll('#tbodyMateriais tr')];
  return rows.map((tr) => ({
    nome: tr.querySelector('.m-nome')?.value?.trim() || '',
    kgM3: parseFloat(tr.querySelector('.m-kgm3')?.value) || 0,
    umidade: parseFloat(tr.querySelector('.m-u')?.value) || 0,
    rho: parseFloat(tr.querySelector('.m-rho')?.value) || 0
  }));
}

/**
 * Massa na batelada: kg/m³ × (V_litros / 1000).
 * Massa corrigida (úmida): massa seca × (1 + U/100) — alinhado ao modelo do relatório Sika.
 */
function recalcMateriaisPreview() {
  const V = (parseFloat($('volumeLitros').value) || 0) / 1000; // m³ da mistura
  const tbody = $('tbodyMateriais');
  tbody.querySelectorAll('tr').forEach((tr) => {
    const kgM3 = parseFloat(tr.querySelector('.m-kgm3')?.value) || 0;
    const u = parseFloat(tr.querySelector('.m-u')?.value) || 0;
    const mSeco = kgM3 * V;
    const mCorr = mSeco * (1 + u / 100);
    tr.dataset.preview = `${mSeco.toFixed(2)} kg → corrig. ${mCorr.toFixed(2)} kg`;
  });

  // Atualiza campos calculados (espelho do XLSX)
  computeDerivedFromSpreadsheetModel();
}

/**
 * Replica os principais campos calculados na planilha XLSX:
 * - Massa batelada: kg/m³ × (V_litros/1000)
 * - Massa corrigida: massa seca × (1 + U/100)
 * - Água corrigida (batelada): Água seca - (água livre trazida pelos agregados úmidos)
 * - Aditivo 1 (kg/m³): dosagem × (cimento + adição)
 * - A/C teórico: água / (cimento+adição) (se o usuário não preencheu manualmente)
 * - Volume total (L): 1000 × (1 - arTeorico/100)
 * - Densidade teórica (kg/m³): soma de kg/m³ (cimento + adição + areia fina+grossa + britas)
 * - Argamassa (%): (cimento+adição+areias) / (cimento+adição+areias+britas)
 * - H (%): água / (cimento+adição+areias+britas)
 *
 * Partes críticas: dependem do nome do material para classificar.
 */
function computeDerivedFromSpreadsheetModel() {
  const mats = readMateriaisFromDom();
  const volL = parseFloat($('volumeLitros').value) || 0;
  const V = volL / 1000;
  if (!V) return;

  const by = (re) => mats.filter((m) => re.test(m.nome || ''));
  const sumKgM3 = (arr) => arr.reduce((a, m) => a + (m.kgM3 || 0), 0);

  const cimento = sumKgM3(by(/cimento/i));
  const adicao = sumKgM3(by(/adi(c|ç)ao|adi(c|ç)ão/i));
  const areia = sumKgM3(by(/areia/i));
  const areiaFina = sumKgM3(by(/areia.*fina/i));
  const areiaGrossa = sumKgM3(by(/areia.*grossa/i));
  const britas = sumKgM3(by(/brita/i));
  const brita0 = sumKgM3(by(/brita\\s*0/i));
  const brita1 = sumKgM3(by(/brita\\s*1/i));
  const agua = sumKgM3(by(/^(água|agua)$/i).length ? by(/^(água|agua)$/i) : by(/água|agua/i));

  // água livre trazida pelos agregados: (m_corr - m_seco) de areias/britas com umidade
  const agg = mats.filter((m) => /areia|brita/i.test(m.nome || ''));
  const waterFromAggKg = agg.reduce((acc, m) => {
    const mSeco = (m.kgM3 || 0) * V;
    const mCorr = mSeco * (1 + (m.umidade || 0) / 100);
    return acc + (mCorr - mSeco);
  }, 0);

  // Água corrigida (batelada) em kg ~ L
  const aguaBateladaKg = agua * V;
  const aguaCorrigidaKg = aguaBateladaKg - waterFromAggKg;

  // Aditivo 1 kg/m³: dosagem (%) × (cimento + adição)
  const dos1 = (parseFloat($('dosagemAditivo1').value) || 0) / 100;
  const aditivo1 = dos1 * (cimento + adicao);

  // A/C teórico (se usuário deixou em branco)
  const acCalc = (cimento + adicao) > 0 ? agua / (cimento + adicao) : 0;
  if ($('acTeorico') && (!$('acTeorico').value || Number.isNaN(parseFloat($('acTeorico').value)))) {
    $('acTeorico').value = acCalc ? acCalc.toFixed(2) : '';
  }

  // Volume total L (planilha: 1000 × (1 - arTeorico/100))
  const ar = parseFloat($('arTeorico').value) || 0;
  const volTotal = 1000 * (1 - ar / 100);

  // Densidade teórica (kg/m³) = soma cimento+adição+areias+britas (igual ao XLSX)
  const densTeor = (cimento + adicao + areia + britas);

  // Argamassa (%) conforme XLSX: (cimento+adição+areia fina+areia grossa) / total(sólidos)
  const arg = (cimento + adicao + areiaFina + areiaGrossa);
  const totalSolidos = (cimento + adicao + areiaFina + areiaGrossa + brita0 + brita1) || (cimento + adicao + areia + britas);
  const argPct = totalSolidos ? (arg / totalSolidos) * 100 : 0;

  // H (%) conforme XLSX: água / (cimento+adição+areias+britas)
  const hPct = (cimento + adicao + areia + britas) ? (agua / (cimento + adicao + areia + britas)) * 100 : 0;

  // Escreve nos campos read-only
  const set = (id, v) => {
    const el = $(id);
    if (!el) return;
    el.value = v;
  };
  set('aguaCorrigidaLitros', Number.isFinite(aguaCorrigidaKg) ? aguaCorrigidaKg.toFixed(2) : '');
  set('volumeTotalLitros', Number.isFinite(volTotal) ? volTotal.toFixed(2) : '');
  set('densidadeTeorica', Number.isFinite(densTeor) ? densTeor.toFixed(0) : '');
  set('argamassaPct', Number.isFinite(argPct) ? argPct.toFixed(2) : '');
  set('hPct', Number.isFinite(hPct) ? hPct.toFixed(2) : '');
  set('aditivo1KgM3', Number.isFinite(aditivo1) ? aditivo1.toFixed(2) : '');

  // Atualiza dados do traço (nova seção)
  updateDadosTraco(cimento, adicao, areiaFina, areiaGrossa, brita0, brita1, agua, britas, totalSolidos, volTotal, argPct, hPct, densTeor, ar);
}

/**
 * Atualiza os campos da seção "Dados do Traço" com proporções dos materiais
 */
function updateDadosTraco(cimento, adicao, areiaFina, areiaGrossa, brita0, brita1, agua, britas, totalSolidos, volTotal, argPct, hPct, densTeor, ar) {
  const set = (id, v) => {
    const el = $(id);
    if (!el) return;
    el.value = v;
  };

  // Valores principais
  set('dadoTracoArgamassa', Number.isFinite(argPct) ? argPct.toFixed(2) : '');
  set('dadoTracoH', Number.isFinite(hPct) ? hPct.toFixed(2) : '');
  set('dadoTracoDensidade', Number.isFinite(densTeor) ? densTeor.toFixed(0) : '');
  set('dadoTracoAr', Number.isFinite(ar) ? ar.toFixed(2) : '');
  set('dadoTracoVolume', Number.isFinite(volTotal) ? volTotal.toFixed(2) : '');

  // Proporções dos materiais (%)
  if (totalSolidos > 0) {
    set('dadoTracoBrita0', (brita0 / totalSolidos * 100).toFixed(2));
    set('dadoTracoBrita1', (brita1 / totalSolidos * 100).toFixed(2));
    set('dadoTracoAreiaFina', (areiaFina / totalSolidos * 100).toFixed(2));
    set('dadoTracoAreiaGrossa', (areiaGrossa / totalSolidos * 100).toFixed(2));
  } else {
    set('dadoTracoBrita0', '');
    set('dadoTracoBrita1', '');
    set('dadoTracoAreiaFina', '');
    set('dadoTracoAreiaGrossa', '');
  }
}

/* ---------- Ensaios e resistências ---------- */

function ensaioRowTemplate(e = {}) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="e-traco" value="${escapeAttr(e.traco || '')}" /></td>
    <td><input type="text" class="e-aditivo" value="${escapeAttr(e.aditivo || '')}" /></td>
    <td><input type="number" class="e-t0" step="1" value="${e.t0 ?? ''}" /></td>
    <td><input type="number" class="e-t15" step="1" value="${e.t15 ?? ''}" /></td>
    <td><input type="number" class="e-tf" step="1" value="${e.tf ?? ''}" /></td>
    <td><input type="number" class="e-ai" step="0.001" value="${e.aguaIni ?? ''}" /></td>
    <td><input type="number" class="e-af" step="0.001" value="${e.aguaFin ?? ''}" /></td>
    <td><input type="number" class="e-peso" step="0.01" value="${e.peso ?? ''}" /></td>
    <td><input type="number" class="e-temp" step="0.1" value="${e.temp ?? ''}" /></td>
    <td><input type="number" class="e-umid" step="1" value="${e.umid ?? ''}" /></td>
    <td><input type="time" class="e-hora" value="${e.hora || ''}" /></td>
    <td><input type="text" class="e-obs" value="${escapeAttr(e.obs || '')}" /></td>
    <td><button type="button" class="btn-icon rm-ensaio">×</button></td>
  `;
  tr.querySelector('.rm-ensaio').addEventListener('click', () => {
    tr.remove();
    syncResistenciaRows();
    saveState();
    refreshCharts();
  });
  tr.querySelectorAll('input').forEach((inp) =>
    inp.addEventListener('input', () => {
      saveState();
      refreshCharts();
    })
  );
  return tr;
}

function readEnsaiosFromDom() {
  return [...document.querySelectorAll('#tbodyEnsaios tr')].map((tr) => ({
    traco: tr.querySelector('.e-traco')?.value?.trim() || '',
    aditivo: tr.querySelector('.e-aditivo')?.value?.trim() || '',
    t0: parseFloat(tr.querySelector('.e-t0')?.value) || 0,
    t15: parseFloat(tr.querySelector('.e-t15')?.value) || 0,
    tf: parseFloat(tr.querySelector('.e-tf')?.value) || 0,
    aguaIni: parseFloat(tr.querySelector('.e-ai')?.value) || 0,
    aguaFin: parseFloat(tr.querySelector('.e-af')?.value) || 0,
    peso: parseFloat(tr.querySelector('.e-peso')?.value) || 0,
    temp: parseFloat(tr.querySelector('.e-temp')?.value) || 0,
    umid: parseFloat(tr.querySelector('.e-umid')?.value) || 0,
    hora: tr.querySelector('.e-hora')?.value || '',
    obs: tr.querySelector('.e-obs')?.value?.trim() || ''
  }));
}

function resistenciaRowTemplate(r = {}) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="r-traco" value="${escapeAttr(r.traco || '')}" /></td>
    <td><input type="text" class="r-aditivo" value="${escapeAttr(r.aditivo || '')}" /></td>
    <td><input type="number" class="r7" step="0.1" value="${r.r7 ?? ''}" /></td>
    <td><input type="number" class="r28" step="0.1" value="${r.r28 ?? ''}" /></td>
    <td><input type="text" class="r-idade" placeholder="Ex.: R 7 dias 14/04/2026" value="${escapeAttr(r.idadeData || '')}" /></td>
  `;
  tr.querySelectorAll('input').forEach((inp) =>
    inp.addEventListener('input', () => {
      saveState();
      refreshCharts();
    })
  );
  return tr;
}

function readResistenciasFromDom() {
  return [...document.querySelectorAll('#tbodyResistencias tr')].map((tr) => ({
    traco: tr.querySelector('.r-traco')?.value?.trim() || '',
    aditivo: tr.querySelector('.r-aditivo')?.value?.trim() || '',
    r7: parseFloat(tr.querySelector('.r7')?.value) || 0,
    r28: parseFloat(tr.querySelector('.r28')?.value) || 0,
    idadeData: tr.querySelector('.r-idade')?.value?.trim() || ''
  }));
}

/** Mantém uma linha de resistência por linha de ensaio (mesma ordem). */
function syncResistenciaRows() {
  const ensaios = readEnsaiosFromDom();
  const tbody = $('tbodyResistencias');
  const existing = [...tbody.querySelectorAll('tr')];
  while (existing.length < ensaios.length) {
    tbody.appendChild(resistenciaRowTemplate());
    existing.push(tbody.lastElementChild);
  }
  while (existing.length > ensaios.length) {
    existing.pop().remove();
  }
  [...tbody.querySelectorAll('tr')].forEach((tr, i) => {
    const e = ensaios[i];
    if (!e) return;
    const t = tr.querySelector('.r-traco');
    const a = tr.querySelector('.r-aditivo');
    if (t && !t.value) t.value = e.traco;
    if (a && !a.value) a.value = e.aditivo;
  });
}

/* ---------- Google Sheets (Apps Script Web App) ---------- */

function setSheetStatus(msg, isErr) {
  const el = $('sheet-status');
  const el2 = $('sheet-status-dados');
  if (el) {
    el.textContent = msg;
    el.classList.toggle('sheet-err', !!isErr);
  }
  if (el2) {
    el2.textContent = msg;
    el2.classList.toggle('sheet-err', !!isErr);
  }
  console.log('[Sheets]', msg);
  if (isErr) setAppPill('err', 'Planilha');
  else if (/Salvando|Carregando/i.test(msg)) setAppPill('warn', 'Nuvem…');
  else if (/Salvo|linha/i.test(msg)) setAppPill('ok', 'Sincronizado');
}

function volumeM3Batelada() {
  return (parseFloat($('volumeLitros').value) || 0) / 1000;
}

/** Soma kg na batelada (kg/m³ × V) para materiais cujo nome casa com o regex */
function massaBateladaPorNome(materiais, regex) {
  const V = volumeM3Batelada();
  return materiais
    .filter((m) => m.nome && regex.test(m.nome))
    .reduce((acc, m) => acc + (m.kgM3 || 0) * V, 0);
}

/**
 * Monta o objeto JSON esperado pelo doPost do Apps Script
 * (1ª linha de ensaio + 1ª resistência + totais de materiais por tipo).
 */
function coletarDadosPlanilha() {
  const materiais = readMateriaisFromDom();
  const ensaios = readEnsaiosFromDom();
  const res = readResistenciasFromDom();
  const e0 = ensaios[0] || {};
  const r0 = res[0] || {};
  const obsParts = [e0.obs, $('observacoesGerais').value?.trim()].filter(Boolean);
  return {
    Data: $('dataEnsaio').value || '',
    Traço: e0.traco || $('descricaoTraco').value || '',
    Volume: $('volumeLitros').value || '',
    Cimento: massaBateladaPorNome(materiais, /cimento/i),
    Areia: massaBateladaPorNome(materiais, /areia/i),
    Brita: massaBateladaPorNome(materiais, /brita/i),
    Água: massaBateladaPorNome(materiais, /água|^agua/i),
    Aditivo: e0.aditivo || '',
    Slump_T0: e0.t0 ?? '',
    Slump_T15: e0.t15 ?? '',
    Slump_Final: e0.tf ?? '',
    Temp: e0.temp ?? '',
    Umidade: e0.umid ?? '',
    Hora: e0.hora || '',
    R7: r0.r7 ?? '',
    R28: r0.r28 ?? '',
    Observações: obsParts.join(' | ')
  };
}

/** POST — text/plain evita preflight CORS com Apps Script */
async function salvarDados() {
  if (!URL_API || !URL_API.includes('script.google.com')) {
    setSheetStatus('Cole a URL /exec do Web App em URL_API (topo de js/app.js).', false);
    console.error('[Sheets] URL_API vazia ou inválida');
    return;
  }
  const payload = coletarDadosPlanilha();
  console.log('[Sheets] POST payload', payload);
  setSheetStatus('Salvando…', false);
  $('btn-sheet-save')?.classList.add('is-loading');
  try {
    const res = await fetch(URL_API, {
      method: 'POST',
      /** Apps Script: application/json dispara preflight; text/plain não */
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    console.log('[Sheets] POST raw', text);
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Resposta não é JSON: ' + text.slice(0, 200));
    }
    if (!data.ok) throw new Error(data.error || 'Erro no servidor');
    setSheetStatus('Salvo na planilha.', false);
    pushHistory('Planilha', `Linha: ${payload.Traço || '—'} · ${payload.Data || ''}`);
    await carregarDados();
  } catch (err) {
    console.error('[Sheets] salvarDados', err);
    setSheetStatus('Erro ao salvar: ' + (err.message || err), true);
    showModal('Falha ao salvar na planilha.\n\n' + (err.message || err));
  } finally {
    $('btn-sheet-save')?.classList.remove('is-loading');
  }
}

async function carregarDados() {
  if (!URL_API || !URL_API.includes('script.google.com')) {
    setSheetStatus('Google Sheets: configure URL_API no topo de js/app.js.', false);
    return;
  }
  setSheetStatus('Carregando planilha…', false);
  try {
    const res = await fetch(URL_API, { method: 'GET' });
    const text = await res.text();
    console.log('[Sheets] GET raw (trecho)', text.slice(0, 300));
    const data = JSON.parse(text);
    if (!data.ok) throw new Error(data.error || 'ok=false');
    cachedSheetRows = Array.isArray(data.rows) ? data.rows : [];
    renderizarTabelaPlanilha(cachedSheetRows);
    updateImportButtonVisibility();
    setSheetStatus('Planilha: ' + cachedSheetRows.length + ' linha(s).', false);
  } catch (err) {
    console.error('[Sheets] carregarDados', err);
    cachedSheetRows = [];
    updateImportButtonVisibility();
    setSheetStatus('Erro ao carregar: ' + (err.message || err), true);
    showModal('Não foi possível carregar a planilha.\n\n' + (err.message || err));
  }
}

function renderizarTabelaPlanilha(rows) {
  const thead = $('thead-sheet-remote');
  const tbody = $('tbody-sheet-remote');
  if (!thead || !tbody) return;
  const keys = COLS_PLANILHA;
  thead.innerHTML = '<tr>' + keys.map((k) => '<th>' + escapeHtml(k) + '</th>').join('') + '</tr>';
  tbody.innerHTML = rows
    .map((row) => {
      return (
        '<tr>' +
        keys.map((k) => '<td>' + escapeHtml(fmtCell(row[k])) + '</td>').join('') +
        '</tr>'
      );
    })
    .join('');
}

function fmtCell(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number' && !Number.isInteger(v)) return String(Math.round(v * 1000) / 1000);
  return String(v);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Exibe o botão Importar só quando há linhas na planilha em cache */
function updateImportButtonVisibility() {
  const btn = $('btn-sheet-import');
  const btn2 = $('btn-sheet-import-select');
  if (!btn && !btn2) return;
  const hidden = cachedSheetRows.length === 0;
  if (btn) btn.classList.toggle('hidden', hidden);
  if (btn2) btn2.classList.toggle('hidden', hidden);
}

/** Lê célula da planilha aceitando variações de nome de coluna */
function sheetPick(row, keys) {
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (row[k] !== undefined && row[k] !== null && row[k] !== '') return row[k];
  }
  return '';
}

function formatDateFromSheet(v) {
  if (v === '' || v == null) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/** Hora para input type=time (planilha / JSON) */
function formatTimeFromSheet(v) {
  if (v === '' || v == null) return '';
  if (typeof v === 'string' && /^\d{1,2}:\d{2}/.test(v)) {
    const m = v.match(/(\d{1,2}):(\d{2})/);
    if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
  }
  const d = new Date(v);
  if (!Number.isNaN(d.getTime())) {
    const h = d.getHours();
    const min = d.getMinutes();
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  return '';
}

/**
 * Ajusta kg/m³ nos materiais existentes a partir das massas na batelha (kg) da planilha.
 */
function applyBatchKgM3ToMateriais(batchCimento, batchAreia, batchBrita, batchAgua) {
  const volL = parseFloat($('volumeLitros').value) || 0;
  const V = volL / 1000;
  if (V <= 0) return;
  const tbody = $('tbodyMateriais');
  const rows = [...tbody.querySelectorAll('tr')];
  const setKg = (re, batchKg, nomeNovo) => {
    const b = parseFloat(batchKg);
    if (Number.isNaN(b) || b <= 0) return;
    const kgm3 = Math.round((b / V) * 100) / 100;
    let tr = rows.find((r) => re.test(r.querySelector('.m-nome')?.value || ''));
    if (!tr) {
      tr = materialRowTemplate({ nome: nomeNovo, kgM3: kgm3, umidade: 0, rho: 0 });
      tbody.appendChild(tr);
    } else {
      const inp = tr.querySelector('.m-kgm3');
      if (inp) inp.value = String(kgm3);
    }
  };
  setKg(/cimento/i, batchCimento, 'Cimento');
  setKg(/areia/i, batchAreia, 'Areia');
  setKg(/brita/i, batchBrita, 'Brita');
  setKg(/água|^agua/i, batchAgua, 'Água');
}

/** Importa a última linha da planilha (cache do GET) para o formulário na aba Dados */
function importarUltimaLinhaDaPlanilha() {
  if (!cachedSheetRows.length) {
    showModal('Atualize a lista da planilha antes de importar.');
    return;
  }
  const row = cachedSheetRows[cachedSheetRows.length - 1];
  const traco = String(sheetPick(row, ['Traço', 'Traco', 'traço', 'traco']) || '');
  const vol = String(sheetPick(row, ['Volume', 'volume']) || '');
  const dataVal = formatDateFromSheet(sheetPick(row, ['Data', 'data']));
  const aditivo = String(sheetPick(row, ['Aditivo', 'aditivo']) || '');
  const t0 = sheetPick(row, ['Slump_T0', 'slump_t0']);
  const t15 = sheetPick(row, ['Slump_T15', 'slump_t15']);
  const tf = sheetPick(row, ['Slump_Final', 'slump_final']);
  const temp = sheetPick(row, ['Temp', 'temp']);
  const umid = sheetPick(row, ['Umidade', 'umidade']);
  const hora = formatTimeFromSheet(sheetPick(row, ['Hora', 'hora']));
  const r7 = sheetPick(row, ['R7', 'r7']);
  const r28 = sheetPick(row, ['R28', 'r28']);
  const obs = String(sheetPick(row, ['Observações', 'Observacoes', 'observações', 'observacoes']) || '');

  if (dataVal) $('dataEnsaio').value = dataVal;
  if (vol) $('volumeLitros').value = vol;
  if (traco) $('descricaoTraco').value = traco;
  if (obs) $('observacoesGerais').value = obs;

  const tbodyE = $('tbodyEnsaios');
  if (!tbodyE.querySelector('tr')) tbodyE.appendChild(ensaioRowTemplate({}));
  const trE = tbodyE.querySelector('tr');
  if (trE) {
    const set = (sel, val) => {
      const el = trE.querySelector(sel);
      if (el && val !== '' && val != null) el.value = String(val);
    };
    set('.e-traco', traco || 'T1');
    set('.e-aditivo', aditivo);
    set('.e-t0', t0);
    set('.e-t15', t15);
    set('.e-tf', tf);
    set('.e-temp', temp);
    set('.e-umid', umid);
    set('.e-hora', hora);
    set('.e-obs', obs);
    set('.e-ai', sheetPick(row, ['Agua_ini', 'Água_ini']) || '');
    set('.e-af', sheetPick(row, ['Agua_fin', 'Água_fin']) || '');
  }

  applyBatchKgM3ToMateriais(
    sheetPick(row, ['Cimento', 'cimento']),
    sheetPick(row, ['Areia', 'areia']),
    sheetPick(row, ['Brita', 'brita']),
    sheetPick(row, ['Água', 'Agua', 'água', 'agua'])
  );

  const tbodyR = $('tbodyResistencias');
  if (!tbodyR.querySelector('tr')) tbodyR.appendChild(resistenciaRowTemplate({}));
  const trR = tbodyR.querySelector('tr');
  if (trR) {
    if (traco) trR.querySelector('.r-traco').value = traco;
    if (aditivo) trR.querySelector('.r-aditivo').value = aditivo;
    if (r7 !== '' && r7 != null) trR.querySelector('.r7').value = String(r7);
    if (r28 !== '' && r28 != null) trR.querySelector('.r28').value = String(r28);
  }

  recalcMateriaisPreview();
  syncResistenciaRows();
  saveState();
  refreshCharts();
  goToTab('dados');
  setAppPill('ok', 'Importado');
  pushHistory('Importação', traco || dataVal || 'planilha');
  showModal('Dados da última linha da planilha aplicados na aba Dados.');
}

/**
 * Importar linha selecionável — abre modal com lista de linhas para escolher qual importar
 */
function importarLinhaComSelecao() {
  if (!cachedSheetRows.length) {
    showModal('Atualize a lista da planilha antes de importar.');
    return;
  }

  // Cria lista de opções (data + traço)
  const linhas = cachedSheetRows.map((row, idx) => {
    const dataVal = formatDateFromSheet(sheetPick(row, ['Data', 'data']));
    const traco = String(sheetPick(row, ['Traço', 'Traco', 'traço', 'traco']) || '');
    const label = `${idx + 1}. ${dataVal || '—'} · ${traco || '—'}`;
    return { idx, label, row };
  });

  // Cria elemento select dentro de um modal customizado
  const selectId = 'import-select-' + Date.now();
  const container = document.createElement('div');
  container.innerHTML = `
    <p style="margin-bottom: 12px; font-size: 0.9rem;">Qual linha deseja importar?</p>
    <select id="${selectId}" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 6px; font-size: 0.9rem;">
      ${linhas.map((l) => `<option value="${l.idx}">${escapeHtml(l.label)}</option>`).join('')}
    </select>
  `;

  const overlay = $('modal-overlay');
  const msgEl = $('modal-message');
  const okBtn = $('modal-ok');
  const cancelBtn = $('modal-cancel');

  if (!overlay || !msgEl || !okBtn || !cancelBtn) return;

  // Limpa mensagem e adiciona select
  msgEl.innerHTML = '';
  msgEl.appendChild(container);

  // Configura ação ao clicar OK
  modalOnOk = () => {
    const select = document.getElementById(selectId);
    if (select) {
      const idx = parseInt(select.value);
      const row = cachedSheetRows[idx];
      if (row) importarLinhaPlanilhaByRow(row);
    }
  };

  cancelBtn.classList.remove('hidden');
  okBtn.textContent = 'Importar';
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
  okBtn.focus();
}

/**
 * Importa uma linha específica da planilha (função auxiliar)
 */
function importarLinhaPlanilhaByRow(row) {
  const traco = String(sheetPick(row, ['Traço', 'Traco', 'traço', 'traco']) || '');
  const vol = String(sheetPick(row, ['Volume', 'volume']) || '');
  const dataVal = formatDateFromSheet(sheetPick(row, ['Data', 'data']));
  const aditivo = String(sheetPick(row, ['Aditivo', 'aditivo']) || '');
  const t0 = sheetPick(row, ['Slump_T0', 'slump_t0']);
  const t15 = sheetPick(row, ['Slump_T15', 'slump_t15']);
  const tf = sheetPick(row, ['Slump_Final', 'slump_final']);
  const temp = sheetPick(row, ['Temp', 'temp']);
  const umid = sheetPick(row, ['Umidade', 'umidade']);
  const hora = formatTimeFromSheet(sheetPick(row, ['Hora', 'hora']));
  const r7 = sheetPick(row, ['R7', 'r7']);
  const r28 = sheetPick(row, ['R28', 'r28']);
  const obs = String(sheetPick(row, ['Observações', 'Observacoes', 'observações', 'observacoes']) || '');

  if (dataVal) $('dataEnsaio').value = dataVal;
  if (vol) $('volumeLitros').value = vol;
  if (traco) $('descricaoTraco').value = traco;
  if (obs) $('observacoesGerais').value = obs;

  const tbodyE = $('tbodyEnsaios');
  if (!tbodyE.querySelector('tr')) tbodyE.appendChild(ensaioRowTemplate({}));
  const trE = tbodyE.querySelector('tr');
  if (trE) {
    const set = (sel, val) => {
      const el = trE.querySelector(sel);
      if (el && val !== '' && val != null) el.value = String(val);
    };
    set('.e-traco', traco || 'T1');
    set('.e-aditivo', aditivo);
    set('.e-t0', t0);
    set('.e-t15', t15);
    set('.e-tf', tf);
    set('.e-temp', temp);
    set('.e-umid', umid);
    set('.e-hora', hora);
    set('.e-obs', obs);
    set('.e-ai', sheetPick(row, ['Agua_ini', 'Água_ini']) || '');
    set('.e-af', sheetPick(row, ['Agua_fin', 'Água_fin']) || '');
  }

  applyBatchKgM3ToMateriais(
    sheetPick(row, ['Cimento', 'cimento']),
    sheetPick(row, ['Areia', 'areia']),
    sheetPick(row, ['Brita', 'brita']),
    sheetPick(row, ['Água', 'Agua', 'água', 'agua'])
  );

  const tbodyR = $('tbodyResistencias');
  if (!tbodyR.querySelector('tr')) tbodyR.appendChild(resistenciaRowTemplate({}));
  const trR = tbodyR.querySelector('tr');
  if (trR) {
    if (traco) trR.querySelector('.r-traco').value = traco;
    if (aditivo) trR.querySelector('.r-aditivo').value = aditivo;
    if (r7 !== '' && r7 != null) trR.querySelector('.r7').value = String(r7);
    if (r28 !== '' && r28 != null) trR.querySelector('.r28').value = String(r28);
  }

  recalcMateriaisPreview();
  syncResistenciaRows();
  saveState();
  refreshCharts();
  goToTab('dados');
  setAppPill('ok', 'Importado');
  pushHistory('Importação', traco || dataVal || 'planilha');
  closeModal();
  showModal('Dados da linha importados na aba Dados.');
}

function limparTodosDados() {
  showModal('Apagar todo o formulário, histórico local e cache da lista da planilha neste aparelho?', {
    showCancel: true,
    okText: 'Limpar',
    onOk: () => {
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(HISTORY_KEY);
      } catch (e) {
        console.warn(e);
      }
      cachedSheetRows = [];
      updateImportButtonVisibility();
      seedDefaults();
      syncResistenciaRows();
      recalcMateriaisPreview();
      refreshCharts();
      renderHistoryList();
      renderizarTabelaPlanilha([]);
      saveState();
      goToTab('dados');
      setAppPill('warn', 'Reset');
      queueMicrotask(() => showModal('Dados locais limpos. Formulário restaurado ao padrão inicial.'));
    }
  });
}

/* ---------- Gráficos (Chart.js) — layout inspirado no relatório Sika ---------- */

function shortLabel(e) {
  const s = (e.aditivo || e.traco || '').trim();
  return s.length > 28 ? s.slice(0, 26) + '…' : s || '—';
}

function refreshCharts() {
  const ensaios = readEnsaiosFromDom();
  const res = readResistenciasFromDom();
  const labels = ensaios.map(shortLabel);

  const slumpData = {
    labels,
    datasets: [
      { label: "Slump T0' (mm)", data: ensaios.map((x) => x.t0), backgroundColor: '#2563a8' },
      { label: "Slump T15' (mm)", data: ensaios.map((x) => x.t15), backgroundColor: '#e8762a' },
      { label: 'Slump Final (mm)', data: ensaios.map((x) => x.tf), backgroundColor: '#0d9488' }
    ]
  };

  const aguaData = {
    labels,
    datasets: [
      {
        label: 'Água final (L)',
        data: ensaios.map((x) => x.aguaFin),
        borderColor: '#c62828',
        backgroundColor: 'rgba(198, 40, 40, 0.12)',
        fill: true,
        tension: 0.25
      }
    ]
  };

  const rLabels = res.length ? res.map((x) => shortLabel({ aditivo: x.aditivo, traco: x.traco })) : labels;
  const resistData = {
    labels: rLabels,
    datasets: [
      {
        label: 'R 7 dias (MPa)',
        data: res.map((x) => (x.r7 > 0 ? x.r7 : null)),
        backgroundColor: '#5c4d7d'
      },
      {
        label: 'R 28 dias (MPa)',
        data: res.map((x) => (x.r28 > 0 ? x.r28 : null)),
        backgroundColor: '#1a7f4a'
      }
    ]
  };

  const theme = chartThemeOptions();
  const commonOpts = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: theme.plugins,
    scales: theme.scales
  };

  if (!labels.length) {
    if (chartSlumpInstance) chartSlumpInstance.destroy();
    if (chartAguaInstance) chartAguaInstance.destroy();
    if (chartResistenciaInstance) chartResistenciaInstance.destroy();
    const emptyTheme = chartThemeOptions();
    chartSlumpInstance = new Chart($('chartSlump'), {
      type: 'bar',
      data: { labels: ['—'], datasets: [{ label: 'Sem dados', data: [0], backgroundColor: '#90a4ae' }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: emptyTheme.scales }
    });
    chartAguaInstance = new Chart($('chartAgua'), {
      type: 'line',
      data: { labels: ['—'], datasets: [{ label: 'Sem dados', data: [0], borderColor: '#90a4ae' }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: emptyTheme.scales }
    });
    chartResistenciaInstance = new Chart($('chartResistencia'), {
      type: 'bar',
      data: { labels: ['—'], datasets: [{ label: 'Sem dados', data: [0], backgroundColor: '#90a4ae' }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: emptyTheme.scales }
    });
    return;
  }

  const tc = chartThemeOptions();
  const axisTitle = (text) => ({ display: true, text, color: '#5a6a7e', font: { size: 11, weight: '600' } });

  if (chartSlumpInstance) chartSlumpInstance.destroy();
  chartSlumpInstance = new Chart($('chartSlump'), {
    type: 'bar',
    data: slumpData,
    options: {
      ...commonOpts,
      scales: {
        x: { ...tc.scales.x },
        y: { ...tc.scales.y, beginAtZero: true, title: axisTitle('mm') }
      }
    }
  });

  if (chartAguaInstance) chartAguaInstance.destroy();
  chartAguaInstance = new Chart($('chartAgua'), {
    type: 'line',
    data: aguaData,
    options: {
      ...commonOpts,
      scales: {
        x: { ...tc.scales.x },
        y: { ...tc.scales.y, beginAtZero: true, title: axisTitle('L') }
      }
    }
  });

  if (chartResistenciaInstance) chartResistenciaInstance.destroy();
  chartResistenciaInstance = new Chart($('chartResistencia'), {
    type: 'bar',
    data: resistData,
    options: {
      ...commonOpts,
      scales: {
        x: { ...tc.scales.x },
        y: { ...tc.scales.y, beginAtZero: true, title: axisTitle('MPa') }
      }
    }
  });
}

/* ---------- PDF (jsPDF + autotable + imagens dos gráficos) ---------- */

function addChartImage(doc, chart, x, y, w, h) {
  if (!chart) return y;
  try {
    const img = chart.toBase64Image('image/png', 1);
    doc.addImage(img, 'PNG', x, y, w, h);
    return y + h + 4;
  } catch {
    return y;
  }
}

function buildPdf() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 12;
  let y = margin;

  const vol = parseFloat($('volumeLitros').value) || 0;
  const V = vol / 1000;
  const materiais = readMateriaisFromDom();

  doc.setFontSize(14);
  doc.setTextColor(26, 58, 92);
  doc.text('Relatório — Análise de Desempenho de Aditivos', margin, y);
  y += 7;
  doc.setFontSize(10);
  doc.setTextColor(40, 40, 40);
  doc.text(`Objetivo: ${$('objetivo').value || '—'}`, margin, y);
  y += 5;
  doc.text(`Projeto: ${$('projeto').value || '—'}`, margin, y);
  y += 5;
  doc.text(`Fck: ${$('fck').value || '—'}   Slump/Flow: ${$('slumpMeta').value || '—'}`, margin, y);
  y += 5;
  doc.text(`Data: ${$('dataEnsaio').value || '—'}   Resp.: ${$('responsaveis').value || '—'}`, margin, y);
  y += 5;
  doc.text(`Volume mistura: ${vol} L   Traço: ${$('descricaoTraco').value || '—'}`, margin, y);
  y += 6;

  doc.setFontSize(11);
  doc.text('Materiais (referência 1 m³ → batelada)', margin, y);
  y += 4;

  const matBody = materiais.map((m) => {
    const mSeco = m.kgM3 * V;
    const mCorr = mSeco * (1 + (m.umidade || 0) / 100);
    return [
      m.nome || '—',
      String(m.kgM3),
      mSeco.toFixed(2),
      `${m.umidade ?? ''}`,
      mCorr.toFixed(2),
      m.rho ? String(m.rho) : '—'
    ];
  });

  doc.autoTable({
    startY: y,
    head: [['Material', 'kg/m³', 'Massa seca (kg)', 'U (%)', 'Massa corr. (kg)', 'ρ (g/cm³)']],
    body: matBody,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [26, 58, 92] },
    margin: { left: margin, right: margin }
  });
  y = doc.lastAutoTable.finalY + 6;

  doc.text(`A/C teórico: ${$('acTeorico').value || '—'}   Ar teórico (%): ${$('arTeorico').value || '—'}`, margin, y);
  y += 5;
  doc.text(
    `Dosagem aditivo 1: ${$('dosagemAditivo1').value || '—'}%   Dosagem aditivo 2: ${$('dosagemAditivo2').value || '—'}%`,
    margin,
    y
  );
  y += 8;

  // SEÇÃO: DADOS DO TRAÇO
  doc.setFontSize(11);
  doc.text('Dados do Traço', margin, y);
  y += 4;
  const traceDataBody = [
    ['Argamassa (%)', $('dadoTracoArgamassa').value || '—'],
    ['H - Umidade (%)', $('dadoTracoH').value || '—'],
    ['Densidade Teórica (kg/m³)', $('dadoTracoDensidade').value || '—'],
    ['Volume total (L)', $('dadoTracoVolume').value || '—'],
    ['Ar teórico (%)', $('dadoTracoAr').value || '—'],
    ['Brita 0 (%)', $('dadoTracoBrita0').value || '—'],
    ['Brita 1 (%)', $('dadoTracoBrita1').value || '—'],
    ['Areia Natural Fina (%)', $('dadoTracoAreiaFina').value || '—'],
    ['Areia Natural Grossa (%)', $('dadoTracoAreiaGrossa').value || '—']
  ];
  doc.autoTable({
    startY: y,
    head: [['Parâmetro', 'Valor']],
    body: traceDataBody,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [156, 39, 176] },
    columnStyles: { 0: { cellWidth: 90 }, 1: { cellWidth: 40 } },
    margin: { left: margin, right: margin }
  });
  y = doc.lastAutoTable.finalY + 8;

  const ensaios = readEnsaiosFromDom();
  doc.autoTable({
    startY: y,
    head: [
      [
        'Traço',
        'Aditivo',
        "T0'",
        "T15'",
        'Fin',
        'Água i',
        'Água f',
        'Peso',
        'T/UR',
        'Hora',
        'Obs'
      ]
    ],
    body: ensaios.map((e) => [
      e.traco,
      e.aditivo,
      e.t0,
      e.t15,
      e.tf,
      e.aguaIni,
      e.aguaFin,
      e.peso,
      `${e.temp} / ${e.umid}`,
      e.hora,
      e.obs
    ]),
    styles: { fontSize: 7 },
    headStyles: { fillColor: [0, 131, 143] },
    margin: { left: margin, right: margin }
  });
  y = doc.lastAutoTable.finalY + 8;

  const res = readResistenciasFromDom();
  doc.autoTable({
    startY: y,
    head: [['Traço', 'Aditivo', 'R7', 'R28', 'Idade / ruptura']],
    body: res.map((r) => [r.traco, r.aditivo, r.r7, r.r28, r.idadeData]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [106, 27, 154] },
    margin: { left: margin, right: margin }
  });
  y = doc.lastAutoTable.finalY + 8;

  const obs = $('observacoesGerais').value?.trim();
  if (obs) {
    doc.setFontSize(9);
    doc.text('Observações:', margin, y);
    y += 4;
    const split = doc.splitTextToSize(obs, pageW - 2 * margin);
    doc.text(split, margin, y);
    y += split.length * 4 + 6;
  }

  /* Gráficos em nova página — render fixo para não estourar na impressão */
  doc.addPage();
  y = margin;
  doc.setFontSize(12);
  doc.text('Gráficos (modelo planilha)', margin, y);
  y += 6;

  const imgW = pageW - 2 * margin;
  const h1 = 70;
  const h2 = 60;

  const pdfCharts = renderChartsForPdf();
  y = addImageDataUrl(doc, pdfCharts.slumpBars, margin, y, imgW, h1);
  if (y + h2 > doc.internal.pageSize.getHeight() - margin) {
    doc.addPage();
    y = margin;
  }
  y = addImageDataUrl(doc, pdfCharts.slumpMaintenance, margin, y, imgW, h2);
  if (y + h2 > doc.internal.pageSize.getHeight() - margin) {
    doc.addPage();
    y = margin;
  }
  addImageDataUrl(doc, pdfCharts.resistencia, margin, y, imgW, h2);

  const nomeArquivo = `relatorio-slump-${$('dataEnsaio').value || new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(nomeArquivo);
  pushHistory('PDF', nomeArquivo);
  setAppPill('ok', 'PDF gerado');
}

function addImageDataUrl(doc, dataUrl, x, y, w, h) {
  if (!dataUrl) return y;
  try {
    doc.addImage(dataUrl, 'PNG', x, y, w, h);
    return y + h + 6;
  } catch {
    return y;
  }
}

/**
 * Renderiza charts específicos para PDF (tamanho fixo, fundo branco).
 * Ajuste crítico: gráficos responsivos no DOM mudam de tamanho e estouram no PDF.
 */
function renderChartsForPdf() {
  const ensaios = readEnsaiosFromDom();
  const res = readResistenciasFromDom();

  const labels = ensaios.map((e) => (e.aditivo || e.traco || '—').toString().slice(0, 32));
  const t0 = ensaios.map((e) => e.t0 || 0);
  const t15 = ensaios.map((e) => e.t15 || 0);
  const tf = ensaios.map((e) => e.tf || 0);

  // 1) Barras agrupadas (igual tabela slump: T0/T15/Final por aditivo)
  const slumpBars = makeChartPng(900, 420, (ctx) => {
    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: "Slump T0' (mm)", data: t0, backgroundColor: '#2563a8' },
          { label: "Slump T15' (mm)", data: t15, backgroundColor: '#e8762a' },
          { label: 'Slump Final (mm)', data: tf, backgroundColor: '#0d9488' }
        ]
      },
      options: {
        responsive: false,
        animation: false,
        plugins: {
          legend: { position: 'bottom' },
          title: { display: true, text: "Slump T0' · T15' · Final (mm)" }
        },
        scales: { y: { beginAtZero: true, title: { display: true, text: 'mm' } } }
      }
    });
  });

  // 2) Manutenção de slump: linhas por aditivo em (0,15,30) minutos (aproxima o gráfico da planilha)
  const minutes = ['0', '15', '30'];
  const slumpMaintenance = makeChartPng(900, 360, (ctx) => {
    const colors = ['#1a3a5c', '#2563a8', '#e8762a', '#0d9488', '#5c4d7d'];
    return new Chart(ctx, {
      type: 'line',
      data: {
        labels: minutes,
        datasets: ensaios.map((e, i) => ({
          label: (e.aditivo || e.traco || `S${i + 1}`).toString().slice(0, 40),
          data: [e.t0 || 0, e.t15 || 0, e.tf || 0],
          borderColor: colors[i % colors.length],
          backgroundColor: 'transparent',
          tension: 0.25,
          pointRadius: 3
        }))
      },
      options: {
        responsive: false,
        animation: false,
        plugins: {
          legend: { position: 'bottom' },
          title: { display: true, text: 'Manutenção de SLUMP (mm) — 0/15/Final' }
        },
        scales: {
          y: { beginAtZero: false, title: { display: true, text: 'mm' } },
          x: { title: { display: true, text: 'min' } }
        }
      }
    });
  });

  // 3) Resistências: barras R7/R28 por aditivo
  const rLabels = res.length ? res.map((r) => (r.aditivo || r.traco || '—').toString().slice(0, 32)) : labels;
  const resistencia = makeChartPng(900, 360, (ctx) => {
    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels: rLabels,
        datasets: [
          { label: 'R 7 DIAS (MPa)', data: res.map((r) => r.r7 || 0), backgroundColor: '#1a3a5c' },
          { label: 'R 28 DIAS (MPa)', data: res.map((r) => r.r28 || 0), backgroundColor: '#1a7f4a' }
        ]
      },
      options: {
        responsive: false,
        animation: false,
        plugins: { legend: { position: 'bottom' }, title: { display: true, text: 'RESISTÊNCIAS (MPa)' } },
        scales: { y: { beginAtZero: true, title: { display: true, text: 'MPa' } } }
      }
    });
  });

  return { slumpBars, slumpMaintenance, resistencia };
}

function makeChartPng(width, height, buildChart) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  // fundo branco para PDF
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  const chart = buildChart(canvas);
  const url = canvas.toDataURL('image/png', 1.0);
  chart.destroy();
  return url;
}

/* ---------- Dados iniciais (espelho do exemplo Sika / laboratório) ---------- */

function seedDefaults() {
  const today = new Date().toISOString().slice(0, 10);
  $('objetivo').value = 'Desenvolvimento';
  $('projeto').value = 'Aditivo para LINHA';
  $('fck').value = '30';
  $('slumpMeta').value = '100 +/- 20 mm';
  $('dataEnsaio').value = '2026-04-07';
  $('responsaveis').value = 'Orlando / Ary / Felipe';
  $('volumeLitros').value = '20';
  $('descricaoTraco').value = 'CP V ARI RS - CSN (BARROSO)';
  $('acTeorico').value = '0.60';
  $('arTeorico').value = '1.95';
  $('dosagemAditivo1').value = '0.65';
  $('dosagemAditivo2').value = '0';
  $('observacoesGerais').value =
    'MANUTENÇÃO: BETONEIRA BATENDO POR 15 MINUTOS. ADITIVO MEDIDO EM PESO; NA BETONEIRA ADICIONAR NA SEGUINTE SEQUÊNCIA: BRITA, CIMENTO, AREIA E A ÁGUA COM CORTE. HOMOGENEIZAR POR 1\' E ADICIONAR O ADITIVO COM O RESTANTE DA ÁGUA ATÉ CHEGAR NA CONSISTÊNCIA DESEJADA. HOMOGENEIZAR POR MAIS 3\' PARA PODER TIRAR O SLUMP / FLOW COM 5\' TOTAL.';

  const tbodyM = $('tbodyMateriais');
  tbodyM.innerHTML = '';
  const mats = [
    { nome: 'Cimento', kgM3: 310, umidade: 0, rho: 3.1 },
    { nome: 'Areia Natural Fina - Salione', kgM3: 237, umidade: 7.2, rho: 2.62 },
    { nome: 'Areia Natural Grossa - N. S. Aparecida', kgM3: 674, umidade: 5.0, rho: 2.62 },
    { nome: 'Brita 0 - Pedreira Basalto', kgM3: 230, umidade: 0, rho: 2.93 },
    { nome: 'Brita 1 - Pedreira Basalto', kgM3: 760, umidade: 0, rho: 2.93 },
    { nome: 'Água', kgM3: 185, umidade: 0, rho: 1.0 },
    { nome: 'Aditivo 1 - MiraSet 519 (Chryso)', kgM3: 2.02, umidade: 0, rho: 1.1 },
    { nome: 'Aditivo 2', kgM3: 0, umidade: 0, rho: 1.0 }
  ];
  mats.forEach((m) => tbodyM.appendChild(materialRowTemplate(m)));

  const tbodyE = $('tbodyEnsaios');
  tbodyE.innerHTML = '';
  const ens = [
    {
      traco: 'T1',
      aditivo: 'MiraSet 519 - 0,65%',
      t0: 120,
      t15: 110,
      tf: 110,
      aguaIni: 0.19,
      aguaFin: 0.19,
      peso: 3.75,
      temp: 27,
      umid: 55,
      hora: '11:35',
      obs: 'Aspecto Bom.'
    },
    {
      traco: 'T2',
      aditivo: 'Sika Plastiment 106 - 0,80%',
      t0: 120,
      t15: 110,
      tf: 110,
      aguaIni: 0.08,
      aguaFin: 0.08,
      peso: 3.8,
      temp: 28,
      umid: 51,
      hora: '12:20',
      obs: 'Aspecto Bom.'
    },
    {
      traco: 'T3',
      aditivo: 'Sika Plastiment PH 30 - 0,80%',
      t0: 120,
      t15: 90,
      tf: 120,
      aguaIni: -0.02,
      aguaFin: 0.08,
      peso: 3.8,
      temp: 30,
      umid: 53,
      hora: '14:55',
      obs: 'Aspecto Bom.'
    },
    {
      traco: 'T4',
      aditivo: 'Sika Plastiment 103 - 0,80%',
      t0: 120,
      t15: 95,
      tf: 120,
      aguaIni: 0.08,
      aguaFin: 0.18,
      peso: 3.8,
      temp: 29,
      umid: 53,
      hora: '16:10',
      obs: 'Aspecto Bom.'
    }
  ];
  ens.forEach((e) => tbodyE.appendChild(ensaioRowTemplate(e)));

  const tbodyR = $('tbodyResistencias');
  tbodyR.innerHTML = '';
  const rs = [
    { traco: 'T1', aditivo: 'MiraSet 519 - 0,65%', r7: 34.7, r28: '', idadeData: 'R 7 dias 14/04/2026' },
    { traco: 'T2', aditivo: 'Sika Plastiment 106 - 0,80%', r7: 34.8, r28: '', idadeData: 'R 28 dias 05/05/2026' },
    { traco: 'T3', aditivo: 'Sika Plastiment PH 30 - 0,80%', r7: 31.7, r28: '', idadeData: '' },
    { traco: 'T4', aditivo: 'Sika Plastiment 103 - 0,80%', r7: 30.4, r28: '', idadeData: '' }
  ];
  rs.forEach((r) => tbodyR.appendChild(resistenciaRowTemplate(r)));

  recalcMateriaisPreview();
}

function applyLoadedState(s) {
  if (!s) return;
  const campos = [
    'objetivo',
    'projeto',
    'fck',
    'slumpMeta',
    'dataEnsaio',
    'responsaveis',
    'volumeLitros',
    'descricaoTraco',
    'acTeorico',
    'arTeorico',
    'dosagemAditivo1',
    'dosagemAditivo2',
    'observacoesGerais'
  ];
  campos.forEach((k) => {
    const el = $(k);
    if (el) el.value = s[k] == null ? '' : String(s[k]);
  });
  if (s.materiais?.length) {
    $('tbodyMateriais').innerHTML = '';
    s.materiais.forEach((m) => $('tbodyMateriais').appendChild(materialRowTemplate(m)));
  }
  if (s.ensaios?.length) {
    $('tbodyEnsaios').innerHTML = '';
    s.ensaios.forEach((e) => $('tbodyEnsaios').appendChild(ensaioRowTemplate(e)));
  }
  if (s.resistencias?.length) {
    $('tbodyResistencias').innerHTML = '';
    s.resistencias.forEach((r) => $('tbodyResistencias').appendChild(resistenciaRowTemplate(r)));
  }
  recalcMateriaisPreview();
}

/* ---------- PWA: service worker + instalar ---------- */

function registerSw() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker
    .register('./sw.js', { scope: './' })
    .then(() => {
      $('sync-status').textContent = 'PWA registrado — dados salvos no aparelho.';
      setAppPill('ok', 'PWA OK');
    })
    .catch(() => {
      $('sync-status').textContent = 'Abra via http://localhost para cache completo (Service Worker).';
      setAppPill('warn', 'SW off');
    });
}

function setupInstallButton() {
  const btn = $('btn-install');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    btn.classList.remove('hidden');
  });
  btn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    btn.classList.add('hidden');
  });
}

/* ---------- Boot ---------- */

function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

const debouncedSave = debounce(saveState, 400);

document.querySelectorAll('input, textarea').forEach((el) => {
  el.addEventListener('input', () => debouncedSave());
});

$('btn-add-material').addEventListener('click', () => {
  $('tbodyMateriais').appendChild(materialRowTemplate({}));
  recalcMateriaisPreview();
  saveState();
});

$('btn-add-ensaio').addEventListener('click', () => {
  $('tbodyEnsaios').appendChild(ensaioRowTemplate({ traco: `T${$('tbodyEnsaios').children.length + 1}` }));
  syncResistenciaRows();
  saveState();
  refreshCharts();
});

$('volumeLitros').addEventListener('input', () => {
  recalcMateriaisPreview();
});

$('btn-pdf').addEventListener('click', () => {
  refreshCharts();
  // Pequeno atraso garante render do canvas antes do toBase64Image
  requestAnimationFrame(() => {
    requestAnimationFrame(() => buildPdf());
  });
});

$('btn-sheet-save')?.addEventListener('click', () => salvarDados());
$('btn-sheet-refresh')?.addEventListener('click', () => carregarDados());
$('btn-sheet-import')?.addEventListener('click', () => importarUltimaLinhaDaPlanilha());
$('btn-sheet-refresh-dados')?.addEventListener('click', () => carregarDados());
$('btn-sheet-import-select')?.addEventListener('click', () => importarLinhaComSelecao());
$('btn-clear-all')?.addEventListener('click', () => limparTodosDados());

setupTabs();
setupModal();
renderHistoryList();

registerSw();
setupInstallButton();

const saved = loadState();
if (saved) applyLoadedState(saved);
else seedDefaults();

syncResistenciaRows();
refreshCharts();

updateImportButtonVisibility();
carregarDados();
