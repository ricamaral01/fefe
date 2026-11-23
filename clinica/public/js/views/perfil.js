// Médico: dados do cabeçalho das receitas e troca de senha
import { html, api, session, $, toast, formData, icon, comLoading } from '../core.js';
import { cabecalho } from '../print.js';
import { state } from '../app.js';

export default async function perfil(el) {
  const me = await api('/me');
  el.innerHTML = html`<div class="topbar"><div class="grow"><h1>Meu cabeçalho</h1><div class="muted">Estes dados saem em todas as receitas, atestados e prontuários impressos.</div></div></div>
    <div class="at-grid" data-perfil>
      <form class="card" id="cf"><div class="form-sec">
        <label class="f"><span>Nome como deve aparecer</span><input name="nome" value="${me.nome}"></label>
        <div class="grid3"><label class="f"><span>CRM</span><input name="crm" value="${me.crm || ''}"></label>
          <label class="f"><span>UF</span><input name="crm_uf" value="${me.crm_uf || ''}" maxlength="2"></label>
          <label class="f"><span>RQE</span><input name="rqe" value="${me.rqe || ''}"></label></div>
        <label class="f"><span>Especialidade</span><input name="especialidade" value="${me.especialidade || ''}"></label>
        <label class="f"><span>Endereço no cabeçalho</span><input name="cabecalho_endereco" value="${me.cabecalho_endereco || ''}" placeholder="Usa o endereço da clínica se vazio"></label>
        <label class="f"><span>Telefone no cabeçalho</span><input name="cabecalho_telefone" value="${me.cabecalho_telefone || ''}"></label>
        <label class="f"><span>Cor do cabeçalho</span><input name="cor" type="color" value="${me.cor || '#0f766e'}" style="padding:4px;width:80px"></label>
      </div><div class="savebar"><span class="grow"></span><button class="btn primary">${icon('save')} Salvar cabeçalho</button></div></form>
      <div class="stack">
        <div class="card"><header><h3>Prévia</h3></header><div class="card-pad"><div class="doc-preview doc" id="prev"></div></div></div>
        <form class="card" id="sf"><header><h3>Trocar senha</h3></header><div class="form-sec">
          <label class="f"><span>Senha atual</span><input name="senha_atual" type="password" autocomplete="current-password"></label>
          <label class="f"><span>Nova senha (mín. 8 caracteres)</span><input name="nova_senha" type="password" autocomplete="new-password"></label>
        </div><div class="savebar"><span class="grow"></span><button class="btn">Alterar senha</button></div></form>
      </div>
    </div>`.s;
  const prev = () => {
    const d = formData($('#cf', el));
    $('#prev', el).style.setProperty('--dc', d.cor);
    $('#prev', el).innerHTML = cabecalho(d, state.clinica).s + '<div class="ttl">Receituário</div><div class="pac">Paciente: <b>Nome do paciente</b></div>';
  };
  prev();
  $('#cf', el).addEventListener('input', prev);
  $('#cf', el).addEventListener('submit', (e) => { e.preventDefault(); comLoading(e.submitter, async () => {
    session.setUser(await api('/me', { method: 'PUT', body: formData(e.target) })); toast('Cabeçalho salvo');
  }); });
  $('#sf', el).addEventListener('submit', (e) => { e.preventDefault(); comLoading(e.submitter, async () => {
    await api('/me', { method: 'PUT', body: formData(e.target) }); e.target.reset(); toast('Senha alterada');
  }); });
}
