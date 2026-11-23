// Tela de atendimento: prontuário do paciente, histórico, receituário e encerramento
import {
  html, api, session, $, $$, toast, modal, confirmar, formData, idade, fmtData, fmtDataHora, fmtHora,
  icon, iniciais, badgeStatus, badgePagamento, badgeTipo, debounce, comLoading,
} from '../core.js';
import { docReceita, docAtestado, docProntuario, imprimir } from '../print.js';
import { state } from '../app.js';

const CAMPOS = ['queixa', 'anamnese', 'exame_fisico', 'diagnostico', 'conduta', 'alergias'];
const VIAS = ['Oral', 'Sublingual', 'Tópico', 'Oftálmico', 'Otológico', 'Nasal', 'Inalatório', 'Intramuscular', 'Subcutâneo', 'Endovenoso', 'Retal', 'Vaginal'];

export default async function atendimento(el, [id]) {
  let at = await api(`/atendimentos/${id}`);
  let sujo = false;
  let salvando = null;
  const u = session.user;

  function render() {
    const p = at.paciente;
    const a = at.agendamento;
    const anos = idade(p.data_nascimento);
    const encerrado = !!at.encerrado_em;
    el.innerHTML = html`
      <div class="card at-head">
        <button class="btn ghost icon-only" data-voltar aria-label="Voltar à agenda">${icon('left')}</button>
        <div class="who"><div class="avatar lg" style="--av:${u.cor || '#0f766e'}">${iniciais(p.nome)}</div>
          <div class="grow"><h1 class="ellipsis">${p.nome}</h1>
            <div class="row wrap small muted" style="margin-top:4px">
              ${anos != null ? html`<span>${anos} anos</span>` : ''}${a ? html`${badgeTipo(a)}${badgePagamento(a)}${badgeStatus(a.status)}` : ''}
              <span>${icon('clock')} ${a ? a.hora + ' · ' : ''}início ${fmtHora(at.iniciado_em)}${encerrado ? ` · encerrado ${fmtHora(at.encerrado_em)}` : ''}</span>
            </div></div></div>
        <div class="at-actions">
          <button class="btn" data-receita>${icon('pill')} Receita</button>
          <button class="btn" data-atestado>${icon('file')} Atestado</button>
          <button class="btn" data-pront title="Imprimir registro do atendimento">${icon('printer')} Prontuário</button>
          <button class="btn primary" data-encerrar>${icon('check')} ${encerrado ? 'Voltar à agenda' : 'Encerrar consulta'}</button>
        </div>
      </div>

      <div class="seg tabs-m" role="tablist">
        <label><input type="radio" name="tab" value="form" checked><span>Atendimento</span></label>
        <label><input type="radio" name="tab" value="hist"><span>Histórico (${at.historico.atendimentos.length})</span></label>
      </div>

      <div class="at-grid" data-tab="form">
        <aside class="at-side">
          <div class="card">
            <header><h3 class="grow">Paciente</h3><a class="btn ghost sm" href="#/pacientes/${p.id}">${icon('edit')} Editar</a></header>
            <div class="card-pad stack">
              ${p.alergias ? html`<div class="alergia">${icon('alert')}<span>Alergias: ${p.alergias}</span></div>` : ''}
              <dl class="kv">
                ${p.data_nascimento ? html`<dt>Nascimento</dt><dd>${fmtData(p.data_nascimento)}</dd>` : ''}
                ${p.sexo ? html`<dt>Sexo</dt><dd>${p.sexo === 'F' ? 'Feminino' : p.sexo === 'M' ? 'Masculino' : p.sexo}</dd>` : ''}
                ${p.cpf ? html`<dt>CPF</dt><dd>${p.cpf}</dd>` : ''}
                ${p.telefone ? html`<dt>Telefone</dt><dd>${p.telefone}</dd>` : ''}
                ${p.convenio ? html`<dt>Convênio</dt><dd>${p.convenio}${p.carteirinha ? html`<br><span class="small muted">${p.carteirinha}</span>` : ''}</dd>` : ''}
                ${p.observacoes ? html`<dt>Obs.</dt><dd>${p.observacoes}</dd>` : ''}
              </dl>
              ${a?.observacoes ? html`<div class="info-box"><b>Recepção:</b> ${a.observacoes}</div>` : ''}
            </div>
          </div>
          <div class="card">
            <header>${icon('history')}<h3 class="grow">Histórico</h3><span class="small muted">${at.historico.atendimentos.length} consulta(s)</span></header>
            ${at.historico.atendimentos.length ? html`<ul class="timeline">${at.historico.atendimentos.map((h) => html`<li>
              <div class="when">${fmtDataHora(h.iniciado_em)}</div>
              <div class="small muted">${h.medico_nome}${h.tipo ? ` · ${h.tipo === 'retorno' ? 'Retorno' : '1ª consulta'}` : ''}</div>
              ${h.queixa ? html`<div class="lbl">Queixa</div><div class="txt">${h.queixa}</div>` : ''}
              ${h.diagnostico ? html`<div class="lbl">Diagnóstico</div><div class="txt">${h.diagnostico}</div>` : ''}
              ${h.conduta ? html`<div class="lbl">Conduta</div><div class="txt">${h.conduta}</div>` : ''}
              ${h.receitas.map((r) => html`<div class="rx-mini">${icon('pill')} ${r.itens.map((i) => i.medicamento).join(', ')}
                <div class="row" style="margin-top:4px"><button class="btn sm" data-repetir="${r.id}">Repetir receita</button></div></div>`)}
              ${h.anamnese || h.exame_fisico ? html`<details><summary>Ver anamnese e exame</summary>
                ${h.anamnese ? html`<div class="lbl">Anamnese</div><div class="txt">${h.anamnese}</div>` : ''}
                ${h.exame_fisico ? html`<div class="lbl">Exame físico</div><div class="txt">${h.exame_fisico}</div>` : ''}</details>` : ''}
            </li>`)}</ul>` : html`<div class="empty small">Primeira consulta — sem histórico anterior.</div>`}
          </div>
        </aside>

        <section class="at-form">
          <form class="card" id="pront" autocomplete="off">
            <header><h2 class="grow">Atendimento de ${fmtData(at.iniciado_em.slice(0, 10))}</h2></header>
            <div class="form-sec">
              <label class="f"><span>Queixa principal / descrição do problema</span><textarea name="queixa" class="big" placeholder="O que trouxe o paciente à consulta?">${at.queixa || ''}</textarea></label>
              <label class="f"><span>Anamnese / história da doença atual</span><textarea name="anamnese">${at.anamnese || ''}</textarea></label>
              <label class="f"><span>Exame físico</span><textarea name="exame_fisico" placeholder="PA, FC, peso, achados…">${at.exame_fisico || ''}</textarea></label>
              <label class="f"><span>Hipótese diagnóstica / CID</span><input name="diagnostico" value="${at.diagnostico || ''}"></label>
              <label class="f"><span>Conduta / o que foi receitado / orientações</span><textarea name="conduta" class="big">${at.conduta || ''}</textarea></label>
              <label class="f"><span>Alergias do paciente</span><input name="alergias" value="${p.alergias || ''}" placeholder="Nenhuma conhecida"></label>
            </div>
            <div class="form-sec" style="padding-top:0">
              <div class="row"><h3 class="grow">Receitas desta consulta</h3><button type="button" class="btn sm" data-receita>${icon('plus')} Nova receita</button></div>
              ${at.receitas.length ? html`<div class="rx-list">${at.receitas.map((r) => html`<div class="rx-row">
                ${icon('pill')}<div class="grow"><div class="ellipsis" style="font-weight:600">${r.itens.map((i) => i.medicamento).join(', ')}</div>
                <div class="small muted">${r.tipo === 'controle_especial' ? 'Controle especial' : 'Receita simples'} · ${fmtHora(r.criado_em)}</div></div>
                <button type="button" class="btn sm" data-reimprimir="${r.id}">${icon('printer')} Imprimir</button></div>`)}</div>`
                : html`<div class="small muted">Nenhuma receita emitida ainda.</div>`}
            </div>
            <div class="savebar"><span class="small muted grow" id="salvo">${at.atualizado_em !== at.iniciado_em ? `Salvo às ${fmtHora(at.atualizado_em)}` : 'Ainda não salvo'}</span>
              <button type="submit" class="btn">${icon('save')} Salvar</button>
              <button type="button" class="btn primary" data-encerrar>${icon('check')} ${encerrado ? 'Voltar à agenda' : 'Encerrar consulta'}</button></div>
          </form>
        </section>
      </div>`.s;
  }

  const dados = () => formData($('#pront', el));

  async function salvar({ silencioso = false } = {}) {
    if (salvando) return salvando;
    const corpo = dados();
    salvando = api(`/atendimentos/${at.id}`, { method: 'PUT', body: corpo })
      .then((novo) => {
        // mantém o que foi digitado durante o salvamento
        const atual = $('#pront', el) ? dados() : corpo;
        sujo = CAMPOS.some((c) => (atual[c] ?? '') !== (corpo[c] ?? ''));
        at = { ...novo };
        const s = $('#salvo', el);
        if (s) s.textContent = `Salvo às ${fmtHora(novo.atualizado_em)}`;
        if (!silencioso) toast('Prontuário salvo');
        return novo;
      })
      .finally(() => { salvando = null; });
    return salvando;
  }

  const autosave = debounce(() => sujo && salvar({ silencioso: true }).catch(() => {}), 4000);

  function abrirReceita(base = null) {
    const itensIniciais = base?.itens?.length ? base.itens : [{ via: 'Oral' }];
    const m = modal(html`<header><h2>${icon('pill')} Receituário</h2><button class="btn ghost icon-only" data-close aria-label="Fechar">${icon('x')}</button></header>
      <form class="modal-body" id="rxf">
        <div class="info-box">Paciente: <b>${at.paciente.nome}</b></div>
        <div class="grid2">
          <div class="seg"><label><input type="radio" name="tipo" value="simples" ${base?.tipo !== 'controle_especial' ? 'checked' : ''}><span>Simples</span></label>
            <label><input type="radio" name="tipo" value="controle_especial" ${base?.tipo === 'controle_especial' ? 'checked' : ''}><span>Controle especial</span></label></div>
          <div class="seg"><label><input type="radio" name="tamanho" value="A5" checked><span>Papel A5</span></label>
            <label><input type="radio" name="tamanho" value="A4"><span>Papel A4</span></label></div>
        </div>
        <div id="itens" class="stack"></div>
        <button type="button" class="btn" data-add>${icon('plus')} Adicionar medicamento</button>
        <label class="f"><span>Observações (opcional)</span><textarea name="observacoes" rows="2" style="min-height:60px">${base?.observacoes || ''}</textarea></label>
      </form>
      <footer><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-ok>${icon('printer')} Salvar e imprimir</button></footer>`.s, { largura: 720 });

    const box = $('#itens', m.el);
    const linha = (it = {}) => {
      const d = document.createElement('div');
      d.className = 'med-row';
      d.innerHTML = html`
        <label class="f sugs"><span>Medicamento e concentração</span><input data-k="medicamento" value="${it.medicamento || ''}" placeholder="Ex.: Amoxicilina 500 mg" autocomplete="off"><ul class="hidden"></ul></label>
        <label class="f qtd"><span>Quantidade</span><input data-k="quantidade" value="${it.quantidade || ''}" placeholder="21 cápsulas"></label>
        <button type="button" class="btn ghost icon-only" data-rm aria-label="Remover" style="margin-top:22px">${icon('trash')}</button>
        <label class="f full"><span>Posologia</span><input data-k="posologia" value="${it.posologia || ''}" placeholder="Tomar 1 cápsula de 8 em 8 horas por 7 dias"></label>
        <label class="f qtd"><span>Via</span><select data-k="via">${VIAS.map((v) => html`<option ${v === (it.via || 'Oral') ? 'selected' : ''}>${v}</option>`)}</select></label>`.s;
      box.appendChild(d);
      const inp = $('[data-k=medicamento]', d);
      const ul = $('ul', d);
      const buscar = debounce(async () => {
        const termo = inp.value.trim();
        if (termo.length < 2) return ul.classList.add('hidden');
        const sugs = await api(`/medicamentos?q=${encodeURIComponent(termo)}`).catch(() => []);
        ul.innerHTML = sugs.map((s, i) => html`<li data-i="${i}">${s.medicamento}<small>${s.posologia || ''}</small></li>`).join('');
        ul.classList.toggle('hidden', !sugs.length);
        $$('li', ul).forEach((li) => li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const s = sugs[li.dataset.i];
          inp.value = s.medicamento;
          if (!$('[data-k=posologia]', d).value) $('[data-k=posologia]', d).value = s.posologia || '';
          if (!$('[data-k=quantidade]', d).value) $('[data-k=quantidade]', d).value = s.quantidade || '';
          ul.classList.add('hidden');
        }));
      }, 200);
      inp.addEventListener('input', buscar);
      inp.addEventListener('blur', () => setTimeout(() => ul.classList.add('hidden'), 150));
      $('[data-rm]', d).addEventListener('click', () => { if ($$('.med-row', box).length > 1) d.remove(); });
      return d;
    };
    itensIniciais.forEach(linha);
    $('[data-add]', m.el).addEventListener('click', () => $('[data-k=medicamento]', linha()).focus());
    requestAnimationFrame(() => $('[data-k=medicamento]', box)?.focus());

    $('[data-ok]', m.el).addEventListener('click', (e) => comLoading(e.currentTarget, async () => {
      const f = formData($('#rxf', m.el));
      const itens = $$('.med-row', box).map((r) => Object.fromEntries($$('[data-k]', r).map((i) => [i.dataset.k, i.value.trim()]))).filter((i) => i.medicamento);
      if (!itens.length) throw new Error('Informe ao menos um medicamento');
      if (sujo) await salvar({ silencioso: true });
      const rec = await api(`/atendimentos/${at.id}/receitas`, { method: 'POST', body: { tipo: f.tipo, itens, observacoes: f.observacoes } });
      m.close();
      await imprimirReceita(rec.id, f.tamanho);
      at = await api(`/atendimentos/${at.id}`);
      sujo = false;
      render();
      toast('Receita salva no prontuário');
    }));
  }

  async function imprimirReceita(recId, tamanho = 'A5') {
    const dadosImp = await api(`/receitas/${recId}/impressao`);
    imprimir(docReceita(dadosImp).s, { tamanho: dadosImp.receita.tipo === 'controle_especial' ? 'A4' : tamanho, cor: dadosImp.medico.cor });
  }

  function abrirAtestado() {
    const m = modal(html`<header><h2>${icon('file')} Atestado</h2><button class="btn ghost icon-only" data-close aria-label="Fechar">${icon('x')}</button></header>
      <form class="modal-body" id="atf">
        <div class="grid2"><label class="f"><span>Dias de afastamento</span><input name="dias" type="number" min="0" max="365" value="1" inputmode="numeric"></label>
        <label class="f"><span>CID (opcional, com autorização do paciente)</span><input name="cid"></label></div>
        <div class="seg"><label><input type="radio" name="tamanho" value="A5" checked><span>Papel A5</span></label><label><input type="radio" name="tamanho" value="A4"><span>Papel A4</span></label></div>
      </form>
      <footer><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-ok>${icon('printer')} Imprimir</button></footer>`.s, { largura: 480 });
    $('[data-ok]', m.el).addEventListener('click', async () => {
      const f = formData($('#atf', m.el));
      const me = await api('/me');
      imprimir(docAtestado({ medico: me, paciente: at.paciente, clinica: state.clinica, dias: f.dias, cid: f.cid }).s, { tamanho: f.tamanho, cor: me.cor });
      m.close();
    });
  }

  render();

  el.addEventListener('input', (e) => { if (e.target.closest('#pront')) { sujo = true; $('#salvo', el).textContent = 'Alterações não salvas…'; autosave(); } });
  el.addEventListener('change', (e) => {
    if (e.target.name === 'tab') $('.at-grid', el).dataset.tab = e.target.value;
  });
  el.addEventListener('submit', (e) => { e.preventDefault(); comLoading(e.submitter || $('#pront button[type=submit]', el), () => salvar()); });
  el.addEventListener('click', async (e) => {
    const t = e.target.closest('button, a');
    if (!t) return;
    if (t.matches('[data-voltar]')) {
      if (sujo) await salvar({ silencioso: true }).catch(() => {});
      location.hash = '#/agenda';
    } else if (t.matches('[data-receita]')) abrirReceita();
    else if (t.matches('[data-atestado]')) abrirAtestado();
    else if (t.matches('[data-repetir]')) abrirReceita(at.historico.receitas.find((r) => r.id === Number(t.dataset.repetir)));
    else if (t.matches('[data-reimprimir]')) comLoading(t, () => imprimirReceita(Number(t.dataset.reimprimir)));
    else if (t.matches('[data-pront]')) comLoading(t, async () => {
      if (sujo) await salvar({ silencioso: true });
      const me = await api('/me');
      imprimir(docProntuario({ medico: me, clinica: state.clinica, atendimento: { ...at, ...dados(), paciente: { ...at.paciente, alergias: dados().alergias } } }).s, { tamanho: 'A4', cor: me.cor });
    });
    else if (t.matches('[data-encerrar]')) {
      if (at.encerrado_em) {
        if (sujo) await salvar({ silencioso: true }).catch(() => {});
        location.hash = '#/agenda';
        return;
      }
      if (!dados().queixa.trim() && !(await confirmar('Encerrar sem descrição?', 'A queixa / descrição do problema está vazia. Deseja encerrar mesmo assim?', { ok: 'Encerrar' }))) return;
      if (!(await confirmar('Encerrar consulta', `Salvar o atendimento de ${at.paciente.nome} e voltar para a agenda do dia?`, { ok: 'Encerrar consulta' }))) return;
      comLoading(t, async () => {
        await api(`/atendimentos/${at.id}/encerrar`, { method: 'POST', body: dados() });
        sujo = false;
        toast('Consulta encerrada');
        location.hash = '#/agenda';
      });
    }
  });

  const antesDeSair = (e) => { if (sujo) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', antesDeSair);
  return () => {
    window.removeEventListener('beforeunload', antesDeSair);
    if (sujo) api(`/atendimentos/${at.id}`, { method: 'PUT', body: dados() }).catch(() => {});
  };
}

