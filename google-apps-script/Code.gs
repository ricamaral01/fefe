/**
 * Web App REST para planilha de slump.
 * Planilha: https://docs.google.com/spreadsheets/d/1epzB9GgO7FCRssPAU7R-jwCH-t0Qo2hQwg9-_iL_PBw/edit
 * Aba: Página1 (fallback Sheet1 / primeira aba)
 *
 * Deploy: Implantar > Novo implantação > Tipo: App da Web
 *   Executar como: Eu
 *   Quem tem acesso: Qualquer pessoa
 * Copie a URL /exec e cole em URL_API no app.js
 */

var SPREADSHEET_ID = '1epzB9GgO7FCRssPAU7R-jwCH-t0Qo2hQwg9-_iL_PBw';

/** Ordem fixa das colunas (linha 1 da planilha) */
var HEADERS = [
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

function getSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName('Página1');
  if (!sh) sh = ss.getSheetByName('Sheet1');
  if (!sh) sh = ss.getSheets()[0];
  return sh;
}

/** Garante cabeçalho na linha 1 */
function ensureHeaders_(sh) {
  var range = sh.getRange(1, 1, 1, HEADERS.length);
  var first = range.getValues()[0];
  if (!first[0] || String(first[0]).trim() === '') {
    range.setValues([HEADERS]);
  }
}

/**
 * Resposta JSON uniforme (Web App já expõe CORS para exec anônimo).
 * POST: use Content-Type text/plain no cliente para evitar preflight.
 */
function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** GET — todas as linhas como array de objetos (chaves = cabeçalho) */
function doGet(e) {
  try {
    var sh = getSheet_();
    ensureHeaders_(sh);
    var data = sh.getDataRange().getValues();
    if (data.length < 2) {
      return jsonResponse_({ ok: true, rows: [] });
    }
    var headerRow = data[0].map(function (h) {
      return String(h).trim();
    });
    var rows = [];
    for (var r = 1; r < data.length; r++) {
      var obj = {};
      for (var c = 0; c < headerRow.length; c++) {
        var key = headerRow[c] || 'col_' + c;
        obj[key] = data[r][c];
      }
      rows.push(obj);
    }
    return jsonResponse_({ ok: true, rows: rows });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err.message || err) });
  }
}

/**
 * POST — corpo JSON (via postData.contents).
 * Aceita chaves iguais ao cabeçalho ou aliases em minúsculo.
 */
function doPost(e) {
  try {
    var sh = getSheet_();
    ensureHeaders_(sh);
    var raw = (e.postData && e.postData.contents) ? e.postData.contents : '{}';
    var body = JSON.parse(raw);

    var row = [
      pick_(body, ['Data', 'data']),
      pick_(body, ['Traço', 'Traco', 'traço', 'traco']),
      pick_(body, ['Volume', 'volume']),
      pick_(body, ['Cimento', 'cimento']),
      pick_(body, ['Areia', 'areia']),
      pick_(body, ['Brita', 'brita']),
      pick_(body, ['Água', 'Agua', 'água', 'agua']),
      pick_(body, ['Aditivo', 'aditivo']),
      pick_(body, ['Slump_T0', 'slump_t0', 'SlumpT0']),
      pick_(body, ['Slump_T15', 'slump_t15', 'SlumpT15']),
      pick_(body, ['Slump_Final', 'slump_final', 'SlumpFinal']),
      pick_(body, ['Temp', 'temp']),
      pick_(body, ['Umidade', 'umidade']),
      pick_(body, ['Hora', 'hora']),
      pick_(body, ['R7', 'r7']),
      pick_(body, ['R28', 'r28']),
      pick_(body, ['Observações', 'Observacoes', 'observações', 'observacoes', 'Obs'])
    ];

    sh.appendRow(row);
    return jsonResponse_({ ok: true, message: 'Linha inserida' });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err.message || err) });
  }
}

function pick_(obj, keys) {
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') {
      return obj[k];
    }
  }
  return '';
}
