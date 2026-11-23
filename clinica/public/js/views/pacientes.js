// Cadastro de pacientes (recepção e médicos)
import { html, api, session, $, toast, modal, formData, fmtData, idade, icon, debounce, comLoading, badgeStatus } from '../core.js';

const campos = (p = {}) => html`
  <div class="grid2">
    <label class="f span2"><span>Nome completo *</span><input name="nome" value="${p.nome || ''}" required></label>
    <label class="f"><span>CPF</span><input name="cpf" value="${p.cpf || ''}" inputmode="numeric"></label>
    <label class="f"><span>Data de nascimento</span><input name="data_nascimento" type="date" value="${p.data_nascimento || ''}"></label>
    <label class="f"><span>WhatsApp / celular</span><input name="telefone" type="tel" value="${p.telefone || ''}" inputmode="tel"></label>
    <label class="f"><span>Sexo</span><select name="sexo"><option value="">—</option>
      <option value="F" ${p.sexo === 'F' ? 'selected' : ''}>Feminino</option><option value="M" ${p.sexo === 'M' ? 'selected' : ''}>Masculino</option></select></label>
    <label class="f span2"><span>E-mail</span><input name="email" type="email" value="${p.email || ''}"></label>
    <label class="f span2"><span>Endereço</span><input name="endereco" value="${p.endereco || ''}"></label>
    <label class="f"><span>Convênio</span><input name="convenio" value="${p.convenio || ''}" placeholder="Particular se vazio"></label>
    <label class="f"><span>Carteirinha</span><input name="carteirinha" value="${p.carteirinha || ''}"></label>
    <label class="f span2"><span>Alergias</span><input name="alergias" value="${p.alergias || ''}"></label>
    <label class="f span2"><span>Observações</span><textarea name="observacoes" rows="2" style="min-height:60px">${p.observacoes || ''}</textarea></label>
  </div>`;

export function editarPaciente(p, aoSalvar) {
  const m = modal(html`<header><h2>${p?.id ? 'Editar paciente' : 'Novo paciente'}</h2><button class="btn ghost icon-only" data-close aria-label="Fechar">${icon('x')}</button></header>
    <form class="modal-body" id="pf">${campos(p || {})}<div id="hist"></div></form>
    <footer><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-ok>${icon('save')} Salvar</button></footer>`.s, { largura: 640 });
  if (p?.id)
    api(`/pacientes/${p.id}/agendamentos`).then((ags) => {
      if (!ags.length || !$('#hist', m.el)) return;
      $('#hist', m.el).innerHTML = html`<h3 style="margin:6px 0 8px">Consultas</h3><table class="table"><tbody>${ags.slice(0, 8).map((a) => html`<tr>
        <td class="nowrap">${fmtData(a.data)} ${a.hora}</td><td class="hide-m">${a.medico_nome}</td><td>${badgeStatus(a.status)}</td></tr>`)}</tbody></table>`.s;
    }).catch(() => {});
  $('[data-ok]', m.el).addEventListener('click', (e) => comLoading(e.currentTarget, async () => {
    const d = formData($('#pf', m.el));
    if (!d.nome.trim()) throw new Error('Informe o nome');
    const salvo = await api(p?.id ? `/pacientes/${p.id}` : '/pacientes', { method: p?.id ? 'PUT' : 'POST', body: d });
    m.close();
    toast('Paciente salvo');
    aoSalvar?.(salvo);
  }));
}

export default async function pacientes(el, [abrirId]) {
  el.innerHTML = html`<div class="topbar"><div class="grow"><h1>Pacientes</h1></div><button class="btn primary" data-novo>${icon('plus')} Novo paciente</button></div>
    <div class="card"><header><span class="muted">${icon('search')}</span><input id="q" placeholder="Buscar por nome, CPF ou telefone" style="border:0;min-height:36px;padding:0" autofocus></header>
    <table class="table"><thead><tr><th>Nome</th><th class="hide-m">Idade</th><th class="hide-m">Telefone</th><th>Convênio</th><th class="hide-m">Última consulta</th></tr></thead><tbody id="tb"></tbody></table></div>`.s;
  let lista = [];
  const carregar = async () => {
    lista = await api(`/pacientes?busca=${encodeURIComponent($('#q', el).value)}`);
    $('#tb', el).innerHTML = lista.length ? lista.map((p, i) => html`<tr class="click" data-i="${i}"><td><b>${p.nome}</b>${p.cpf ? html`<div class="small muted">${p.cpf}</div>` : ''}</td>
      <td class="hide-m">${idade(p.data_nascimento) ?? ''}</td><td class="hide-m nowrap">${p.telefone || ''}</td><td>${p.convenio || html`<span class="muted">Particular</span>`}</td>
      <td class="hide-m">${p.ultima_consulta ? fmtData(p.ultima_consulta) : ''}</td></tr>`).join('') : html`<tr><td colspan="5" class="empty">Nenhum paciente encontrado.</td></tr>`.s;
  };
  $('#q', el).addEventListener('input', debounce(carregar, 250));
  el.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-i]');
    if (tr) editarPaciente(lista[tr.dataset.i], carregar);
    if (e.target.closest('[data-novo]')) editarPaciente(null, carregar);
  });
  await carregar();
  if (abrirId) {
    const p = await api(`/pacientes/${abrirId}`).catch(() => null);
    if (p) editarPaciente(p, () => (session.user.perfil === 'medico' ? history.back() : carregar()));
  }
}
