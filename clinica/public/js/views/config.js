// Administração: dados da clínica, usuários (médicos e recepção) e grade de horários
import { html, api, session, $, $$, toast, modal, formData, icon, iniciais, comLoading } from '../core.js';
import { state } from '../app.js';

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export default async function config(el) {
  let aba = sessionStorage.getItem('cfg-aba') || 'usuarios';
  el.innerHTML = html`<div class="topbar"><div class="grow"><h1>Configurações</h1></div></div>
    <div class="seg" style="max-width:520px;margin-bottom:16px">
      <label><input type="radio" name="aba" value="usuarios"><span>Usuários</span></label>
      <label><input type="radio" name="aba" value="horarios"><span>Horários</span></label>
      <label><input type="radio" name="aba" value="clinica"><span>Clínica</span></label></div>
    <div id="cfg"></div>`.s;
  const box = $('#cfg', el);

  async function usuarios() {
    const lista = await api('/usuarios');
    box.innerHTML = html`<div class="card"><header><h2 class="grow">Usuários</h2><button class="btn primary" data-novo>${icon('plus')} Novo usuário</button></header>
      <table class="table"><thead><tr><th>Nome</th><th class="hide-m">E-mail</th><th>Perfil</th><th class="hide-m">CRM</th></tr></thead><tbody>
      ${lista.map((u, i) => html`<tr class="click" data-i="${i}"><td><div class="row"><span class="avatar" style="--av:${u.cor || '#64748b'};width:30px;height:30px;font-size:11px">${iniciais(u.nome)}</span>
        <div><b>${u.nome}</b>${!u.ativo ? html` <span class="badge red">inativo</span>` : ''}</div></div></td><td class="hide-m">${u.email}</td>
        <td>${u.perfil === 'medico' ? 'Médico(a)' : 'Recepção'}${u.admin ? html` <span class="badge blue">admin</span>` : ''}</td>
        <td class="hide-m">${u.crm ? `${u.crm_uf || ''} ${u.crm}` : ''}</td></tr>`)}</tbody></table></div>`.s;
    box.onclick = (e) => {
      const tr = e.target.closest('tr[data-i]');
      if (tr) editar(lista[tr.dataset.i]);
      if (e.target.closest('[data-novo]')) editar({ perfil: 'medico', ativo: true });
    };
  }

  function editar(u) {
    const m = modal(html`<header><h2>${u.id ? 'Editar usuário' : 'Novo usuário'}</h2><button class="btn ghost icon-only" data-close aria-label="Fechar">${icon('x')}</button></header>
      <form class="modal-body" id="uf" autocomplete="off">
        <div class="seg"><label><input type="radio" name="perfil" value="medico" ${u.perfil === 'medico' ? 'checked' : ''}><span>Médico(a)</span></label>
          <label><input type="radio" name="perfil" value="recepcao" ${u.perfil === 'recepcao' ? 'checked' : ''}><span>Recepção</span></label></div>
        <div class="grid2">
          <label class="f span2"><span>Nome (como sai na receita, ex.: Dra. Ana Souza)</span><input name="nome" value="${u.nome || ''}"></label>
          <label class="f"><span>E-mail (login)</span><input name="email" type="email" value="${u.email || ''}"></label>
          <label class="f"><span>${u.id ? 'Nova senha (deixe vazio p/ manter)' : 'Senha inicial (mín. 8)'}</span><input name="senha" type="password" autocomplete="new-password"></label>
        </div>
        <div class="grid2" data-med>
          <label class="f"><span>CRM</span><input name="crm" value="${u.crm || ''}"></label>
          <label class="f"><span>UF do CRM</span><input name="crm_uf" value="${u.crm_uf || ''}" maxlength="2"></label>
          <label class="f"><span>Especialidade</span><input name="especialidade" value="${u.especialidade || ''}"></label>
          <label class="f"><span>RQE</span><input name="rqe" value="${u.rqe || ''}"></label>
          <label class="f span2"><span>Endereço no cabeçalho</span><input name="cabecalho_endereco" value="${u.cabecalho_endereco || ''}"></label>
          <label class="f"><span>Telefone no cabeçalho</span><input name="cabecalho_telefone" value="${u.cabecalho_telefone || ''}"></label>
          <label class="f"><span>Cor</span><input name="cor" type="color" value="${u.cor || '#0f766e'}" style="padding:4px;width:80px"></label>
        </div>
        <label class="row"><input type="checkbox" name="admin" ${u.admin ? 'checked' : ''}> Administrador (gerencia usuários, horários e clínica)</label>
        <label class="row"><input type="checkbox" name="ativo" ${u.ativo !== false ? 'checked' : ''}> Ativo</label>
      </form>
      <footer><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-ok>${icon('save')} Salvar</button></footer>`.s, { largura: 620 });
    const f = $('#uf', m.el);
    const toggle = () => $('[data-med]', m.el).classList.toggle('hidden', f.perfil.value !== 'medico');
    toggle();
    f.addEventListener('change', toggle);
    $('[data-ok]', m.el).addEventListener('click', (e) => comLoading(e.currentTarget, async () => {
      const d = formData(f);
      if (!d.senha) delete d.senha;
      await api(u.id ? `/usuarios/${u.id}` : '/usuarios', { method: u.id ? 'PUT' : 'POST', body: d });
      if (u.id === session.user.id) session.setUser(await api('/me'));
      m.close();
      toast('Usuário salvo');
      usuarios();
    }));
  }

  async function horarios() {
    const medicos = await api('/medicos');
    if (!medicos.length) { box.innerHTML = html`<div class="empty">Cadastre um médico primeiro.</div>`.s; return; }
    let mid = Number(sessionStorage.getItem('cfg-med')) || medicos[0].id;
    if (!medicos.some((m) => m.id === mid)) mid = medicos[0].id;
    const draw = async () => {
      sessionStorage.setItem('cfg-med', mid);
      const hs = await api(`/medicos/${mid}/horarios`);
      const linha = (h = { dia_semana: 1, inicio: '08:00', fim: '12:00', duracao_min: 30 }) => html`<tr>
        <td><select data-k="dia_semana">${DIAS.map((d, i) => html`<option value="${i}" ${i === h.dia_semana ? 'selected' : ''}>${d}</option>`)}</select></td>
        <td><input type="time" data-k="inicio" value="${String(h.inicio).slice(0, 5)}"></td><td><input type="time" data-k="fim" value="${String(h.fim).slice(0, 5)}"></td>
        <td><select data-k="duracao_min">${[10, 15, 20, 30, 40, 45, 60].map((n) => html`<option ${n === h.duracao_min ? 'selected' : ''}>${n}</option>`)}</select></td>
        <td><button class="btn ghost icon-only" data-rm aria-label="Remover">${icon('trash')}</button></td></tr>`;
      box.innerHTML = html`<div class="doctors" style="margin-bottom:12px">${medicos.map((m) => html`<button class="doc-chip ${m.id === mid ? 'on' : ''}" data-med="${m.id}">
          <span class="avatar" style="--av:${m.cor}">${iniciais(m.nome)}</span><b>${m.nome}</b></button>`)}</div>
        <div class="card"><header><h2 class="grow">Grade de atendimento</h2><button class="btn" data-add>${icon('plus')} Período</button></header>
        <div style="overflow-x:auto"><table class="table" id="ht"><thead><tr><th>Dia</th><th>Início</th><th>Fim</th><th>Bloco (min)</th><th></th></tr></thead>
        <tbody>${hs.map((h) => linha(h))}</tbody></table></div>
        <div class="savebar"><span class="small muted grow">Os blocos da recepção são gerados a partir desta grade.</span><button class="btn primary" data-salvar>${icon('save')} Salvar grade</button></div></div>`.s;
      box.onclick = (e) => {
        const t = e.target.closest('button');
        if (!t) return;
        if (t.dataset.med) { mid = Number(t.dataset.med); draw(); }
        else if (t.matches('[data-add]')) $('#ht tbody', box).insertAdjacentHTML('beforeend', linha().s);
        else if (t.matches('[data-rm]')) t.closest('tr').remove();
        else if (t.matches('[data-salvar]')) comLoading(t, async () => {
          const body = $$('#ht tbody tr', box).map((tr) => Object.fromEntries($$('[data-k]', tr).map((i) => [i.dataset.k, i.dataset.k === 'inicio' || i.dataset.k === 'fim' ? i.value : Number(i.value)])));
          await api(`/medicos/${mid}/horarios`, { method: 'PUT', body });
          toast('Grade salva');
          draw();
        });
      };
    };
    await draw();
  }

  async function clinica() {
    const c = await api('/clinica');
    box.innerHTML = html`<form class="card" id="clf" style="max-width:720px"><div class="form-sec"><div class="grid2">
      <label class="f span2"><span>Nome da clínica</span><input name="nome" value="${c.nome || ''}"></label>
      <label class="f"><span>CNPJ</span><input name="cnpj" value="${c.cnpj || ''}"></label>
      <label class="f"><span>Cidade/UF</span><input name="cidade" value="${c.cidade || ''}" placeholder="São Paulo/SP"></label>
      <label class="f span2"><span>Endereço</span><input name="endereco" value="${c.endereco || ''}"></label>
      <label class="f"><span>Telefone</span><input name="telefone" value="${c.telefone || ''}"></label>
      <label class="f"><span>WhatsApp</span><input name="whatsapp" value="${c.whatsapp || ''}"></label>
      <label class="f span2"><span>E-mail</span><input name="email" value="${c.email || ''}"></label>
    </div></div><div class="savebar"><span class="grow"></span><button class="btn primary">${icon('save')} Salvar</button></div></form>`.s;
    box.onclick = null;
    $('#clf', box).addEventListener('submit', (e) => { e.preventDefault(); comLoading(e.submitter, async () => {
      state.clinica = await api('/clinica', { method: 'PUT', body: formData(e.target) });
      toast('Dados da clínica salvos');
    }); });
  }

  const abas = { usuarios, horarios, clinica };
  const ir = (a) => { aba = a; sessionStorage.setItem('cfg-aba', a); $(`[name=aba][value=${a}]`, el).checked = true; abas[a]().catch((e) => toast(e.message, 'erro')); };
  el.addEventListener('change', (e) => { if (e.target.name === 'aba') ir(e.target.value); });
  ir(aba);
}
