// Documentos para impressão com o cabeçalho do médico logado (receita, atestado, prontuário).
import { html, esc, fmtData, fmtDataHora, idade } from './core.js';

const TAMANHOS = { A4: ['210mm', '297mm'], A5: ['148mm', '210mm'] };

function cabecalho(medico, clinica) {
  const reg = [medico.crm && `CRM ${medico.crm_uf ? medico.crm_uf + ' ' : ''}${medico.crm}`, medico.rqe && `RQE ${medico.rqe}`].filter(Boolean).join(' · ');
  return html`<div class="dh">
    <div>
      <div class="dn">${medico.nome}</div>
      <div class="ds">${medico.especialidade || ''}${medico.especialidade && reg ? ' — ' : ''}${reg}</div>
    </div>
    <div class="dr">
      <b>${clinica?.nome || ''}</b><br>
      <span class="end">${medico.cabecalho_endereco || clinica?.endereco || ''}</span><br>
      ${medico.cabecalho_telefone || clinica?.telefone || ''}${clinica?.cnpj ? html` · CNPJ ${clinica.cnpj}` : ''}
    </div>
  </div>`;
}

function rodape(medico, clinica, quando = new Date()) {
  const cidade = clinica?.cidade ? clinica.cidade.split('/')[0] + ', ' : '';
  const data = quando.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  return html`<div class="sig">
    <div>${cidade}${data}</div>
    <div class="line"><div>${medico.nome}</div><div>${medico.crm ? `CRM ${medico.crm_uf || ''} ${medico.crm}` : ''}</div></div>
  </div>
  <div class="df">${[clinica?.nome, clinica?.endereco, clinica?.cidade, clinica?.telefone].filter(Boolean).join(' · ')}</div>`;
}

function linhaPaciente(p, extra = true) {
  const id = idade(p.data_nascimento);
  return html`<div class="pac">Paciente: <b>${p.nome}</b>${extra && id != null ? html` &nbsp;·&nbsp; ${id} anos` : ''}
    ${extra && p.cpf ? html` &nbsp;·&nbsp; CPF ${p.cpf}` : ''}${extra && p.endereco ? html`<br>Endereço: ${p.endereco}` : ''}</div>`;
}

function itensReceita(itens) {
  // agrupa por via de administração ("Uso oral", "Uso tópico"...)
  const grupos = new Map();
  itens.forEach((it) => { const v = it.via || 'Oral'; if (!grupos.has(v)) grupos.set(v, []); grupos.get(v).push(it); });
  let n = 0;
  return [...grupos].map(([via, lista]) => html`<div class="uso">Uso ${via.toLowerCase()}</div>
    <ol class="itens" start="${n + 1}">${lista.map((it) => { n++; return html`<li>
      <div class="med"><span>${it.medicamento}</span><span class="dots"></span><span class="q">${it.quantidade || ''}</span></div>
      ${it.posologia ? html`<div class="pos">${it.posologia}</div>` : ''}</li>`; })}</ol>`);
}

export function docReceita({ receita, medico, paciente, clinica }) {
  const quando = new Date(receita.criado_em);
  if (receita.tipo === 'controle_especial') {
    const via = (n) => html`<section>
      <div class="via">${n}ª via — ${n === 1 ? 'Farmácia' : 'Paciente'}</div>
      ${cabecalho(medico, clinica)}
      <div class="ttl">Receituário de controle especial</div>
      ${linhaPaciente(paciente)}
      ${itensReceita(receita.itens)}
      ${receita.observacoes ? html`<div class="obs">${receita.observacoes}</div>` : ''}
      ${rodape(medico, clinica, quando)}
      <div class="boxes">
        <div><b>Identificação do comprador</b>Nome:<br><br>RG: &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Órgão emissor:<br>Endereço:<br>Cidade: &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; UF: &nbsp;&nbsp;&nbsp; Telefone:</div>
        <div><b>Identificação do fornecedor</b><br><br><br>Assinatura do farmacêutico &nbsp;&nbsp;&nbsp; Data: ___/___/_____</div>
      </div>
    </section>`;
    return html`<div class="page">${via(1)}</div><div class="page">${via(2)}</div>`;
  }
  return html`<div class="page">
    ${cabecalho(medico, clinica)}
    <div class="ttl">Receituário</div>
    ${linhaPaciente(paciente, false)}
    ${itensReceita(receita.itens)}
    ${receita.observacoes ? html`<div class="obs">${receita.observacoes}</div>` : ''}
    ${rodape(medico, clinica, quando)}
  </div>`;
}

export function docAtestado({ medico, paciente, clinica, dias, cid, texto }) {
  const corpo = texto || `Atesto, para os devidos fins, que ${paciente.nome}${paciente.cpf ? `, CPF ${paciente.cpf},` : ''} esteve sob meus cuidados médicos nesta data` +
    (Number(dias) > 0 ? `, necessitando de ${dias} (${extenso(Number(dias))}) dia${Number(dias) > 1 ? 's' : ''} de afastamento de suas atividades a partir de hoje.` : '.') +
    (cid ? `\n\nCID: ${cid}` : '');
  return html`<div class="page">${cabecalho(medico, clinica)}<div class="ttl">Atestado médico</div>
    <p style="font-size:13pt;line-height:1.8;white-space:pre-wrap;text-align:justify">${corpo}</p>${rodape(medico, clinica)}</div>`;
}

export function docProntuario({ medico, clinica, atendimento }) {
  const p = atendimento.paciente;
  const sec = (t, v) => (v ? html`<div class="sec"><h4>${t}</h4><p>${v}</p></div>` : '');
  return html`<div class="page">${cabecalho(medico, clinica)}<div class="ttl">Registro de atendimento</div>
    <div class="pac"><b>${p.nome}</b>${idade(p.data_nascimento) != null ? ` · ${idade(p.data_nascimento)} anos` : ''}${p.cpf ? ` · CPF ${p.cpf}` : ''}
      ${p.data_nascimento ? ` · Nasc. ${fmtData(p.data_nascimento)}` : ''}<br>
      Atendimento: ${fmtDataHora(atendimento.iniciado_em)}${atendimento.encerrado_em ? ` às ${new Date(atendimento.encerrado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}
      ${atendimento.agendamento ? ` · ${atendimento.agendamento.tipo === 'retorno' ? 'Retorno' : 'Primeira consulta'} · ${atendimento.agendamento.pagamento === 'convenio' ? 'Convênio ' + (atendimento.agendamento.convenio || '') : 'Particular'}` : ''}</div>
    ${p.alergias ? sec('Alergias', p.alergias) : ''}
    ${sec('Queixa / descrição do problema', atendimento.queixa)}${sec('Anamnese', atendimento.anamnese)}
    ${sec('Exame físico', atendimento.exame_fisico)}${sec('Hipótese diagnóstica / CID', atendimento.diagnostico)}
    ${sec('Conduta / prescrição', atendimento.conduta)}
    ${atendimento.receitas?.length ? html`<div class="sec"><h4>Medicamentos prescritos</h4><p>${unicos(atendimento.receitas.flatMap((r) => r.itens)).map((i) => `• ${i.medicamento} ${i.quantidade ? '(' + i.quantidade + ')' : ''} — ${i.posologia || ''}`).join('\n')}</p></div>` : ''}
    ${rodape(medico, clinica)}</div>`;
}

// Mesma prescrição impressa mais de uma vez aparece uma só vez no prontuário
function unicos(itens) {
  const vistos = new Set();
  return itens.filter((i) => { const k = `${i.medicamento}|${i.posologia}|${i.quantidade}`.toLowerCase(); return !vistos.has(k) && vistos.add(k); });
}

function extenso(n) {
  const u = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove', 'vinte'];
  if (n <= 20) return u[n];
  if (n === 30) return 'trinta';
  if (n < 30) return 'vinte e ' + u[n - 20];
  return String(n);
}

// Renderiza no #print-area e abre a impressão do navegador (funciona em Safari/iPad, Chrome, Edge)
export function imprimir(conteudo, { tamanho = 'A5', cor = '#0f766e' } = {}) {
  const [w, h] = TAMANHOS[tamanho] || TAMANHOS.A4;
  const area = document.getElementById('print-area');
  area.innerHTML = `<style>@page{size:${w} ${h};margin:12mm}</style><div class="doc ${tamanho === 'A5' ? 'a5' : ''}" style="--ph:${h};--dc:${esc(cor)}">${conteudo}</div>`;
  setTimeout(() => window.print(), 50);
}

export { cabecalho };
