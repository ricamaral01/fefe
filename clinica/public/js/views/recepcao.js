// Recepção: agenda vertical do dia — uma coluna por médico, horários das 07h às 18h; clica no bloco para agendar
import {
  html, api, session, $, $$, toast, modal, confirmar, formData, hojeISO, addDias, fmtData, fmtDataLonga, fmtDataHora,
  idade, icon, iniciais, badgeStatus, badgePagamento, badgeTipo, debounce, comLoading, WA_STATUS,
} from '../core.js';

const CONVENIOS = ['Unimed', 'Bradesco Saúde', 'SulAmérica', 'Amil', 'NotreDame Intermédica', 'Hapvida', 'Porto Seguro', 'Cassi', 'Golden Cross', 'Prevent Senior'];

export default async function recepcao(el) {
  const medicos = await api('/medicos');
  const u = session.user;
  let medicoId = medicos[0]?.id; // médico do agendamento em edição
  let data = sessionStorage.getItem('rec-data') || hojeISO();

  if (!medicos.length) {
    el.innerHTML = html`<div class="empty">Nenhum médico cadastrado.${u.admin ? html` <a href="#/config">Cadastre em Configurações.</a>` : ''}</div>`.s;
    return;
  }

  el.innerHTML = html`
    <div class="topbar">
      <div class="grow"><h1>Recepção</h1><div class="muted" id="sub"></div></div>
      <div class="datenav">
        <button class="btn ghost icon-only" data-d="-1" aria-label="Dia anterior">${icon('left')}</button>
        <input type="date" id="dt" aria-label="Data">
        <button class="btn ghost icon-only" data-d="1" aria-label="Próximo dia">${icon('right')}</button>
        <button class="btn ghost sm" data-hoje>Hoje</button>
      </div>
      <button class="btn" data-encaixe>${icon('plus')} Encaixe</button>
    </div>
    <div class="row wrap small muted" style="margin:0 0 10px" id="resumo"></div>
    <div class="agv-wrap" id="agv"></div>`.s;

  const medico = () => medicos.find((m) => m.id === medicoId);
  const min = (h) => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  function celulaAg(a, b, m) {
    const wa = a.whatsapp_status === 'respondido' || a.status === 'confirmado'
      ? html`<span class="badge green" title="Confirmado pelo paciente">${icon('whatsapp')}</span>`
      : a.whatsapp_status === 'falhou' ? html`<span class="badge red" title="WhatsApp falhou">${icon('whatsapp')}</span>` : '';
    return html`<button class="slot ocupado st-${a.status}" data-ag="${a.id}" style="--c:${m.cor || '#0f766e'}">
      <span class="h">${a.hora}${b.encaixe ? html`<span class="badge amber">encaixe</span>` : ''}<span class="grow"></span>${wa}</span>
      <span class="n">${a.paciente_nome}</span>
      <span class="meta">${badgeStatus(a.status)}${badgeTipo(a)}${badgePagamento(a)}</span></button>`;
  }

  async function carregar() {
    if (!$('#dt', el)) return;
    sessionStorage.setItem('rec-data', data);
    $('#dt', el).value = data;
    $('#sub', el).textContent = fmtDataLonga(data) + (data === hojeISO() ? ' · hoje' : '');
    let agendas;
    try { agendas = await Promise.all(medicos.map((m) => api(`/agenda?medico_id=${m.id}&data=${data}`))); } catch (e) { return toast(e.message, 'erro'); }

    // Linhas de horário: das 07:00 às 18:00 (ou mais, se a grade/encaixes passarem disso)
    const todos = agendas.flatMap((g) => g.blocos);
    const passo = Math.max(10, Math.min(30, ...todos.map((b) => b.duracao_min)));
    let ini = min('07:00'), fim = min('18:00');
    for (const b of todos) { ini = Math.min(ini, min(b.hora)); fim = Math.max(fim, min(b.hora) + b.duracao_min); }
    ini -= ini % passo;
    const tempos = new Set();
    for (let t = ini; t < fim; t += passo) tempos.add(t);
    todos.forEach((b) => tempos.add(min(b.hora)));
    const linhas = [...tempos].sort((x, y) => x - y);
    const idx = new Map(linhas.map((t, i) => [t, i]));

    const agora = new Date().toTimeString().slice(0, 5);
    const passado = (h) => data < hojeISO() || (data === hojeISO() && h < agora);
    const cel = [];
    let ocupados = 0, livres = 0, confirmados = 0, chegaram = 0;

    // cabeçalho + coluna de horários
    cel.push(html`<div class="agv-corner" style="grid-row:1;grid-column:1"></div>`);
    linhas.forEach((t, i) => cel.push(html`<div class="agv-time ${t % 60 === 0 ? 'hr' : ''}" style="grid-row:${i + 2};grid-column:1">${hhmm(t)}</div>`));

    medicos.forEach((m, ci) => {
      const col = ci + 2;
      const blocos = agendas[ci].blocos;
      const ag = blocos.filter((b) => b.agendamento);
      ocupados += ag.length;
      livres += blocos.length - ag.length;
      confirmados += ag.filter((b) => b.agendamento.status === 'confirmado').length;
      chegaram += ag.filter((b) => b.agendamento.status === 'aguardando').length;
      cel.push(html`<div class="agv-head" style="grid-row:1;grid-column:${col}">
        <span class="avatar" style="--av:${m.cor || '#0f766e'}">${iniciais(m.nome)}</span>
        <div class="grow" style="min-width:0"><b class="ellipsis" style="display:block">${m.nome}</b>
        <small>${m.especialidade || 'Médico(a)'} · ${ag.length}/${blocos.length}</small></div></div>`);

      const inicios = blocos.map((b) => min(b.hora)).sort((x, y) => x - y);
      const coberto = new Set();
      for (const b of blocos) {
        const t0 = min(b.hora);
        const prox = inicios.find((t) => t > t0) ?? Infinity;
        const t1 = Math.min(t0 + b.duracao_min, prox);
        let span = 0;
        for (const t of linhas) if (t >= t0 && t < t1) { coberto.add(t); span++; }
        const pos = `grid-row:${idx.get(t0) + 2} / span ${Math.max(1, span)};grid-column:${col}`;
        cel.push(html`<div class="agv-cell" style="${pos}">${b.agendamento ? celulaAg(b.agendamento, b, m)
          : html`<button class="slot livre ${passado(b.hora) ? 'passado' : ''}" data-hora="${b.hora}" data-medcol="${m.id}" aria-label="Agendar ${m.nome} às ${b.hora}">
              <span class="add">${icon('plus')} ${b.hora} · Agendar</span></button>`}</div>`);
      }
      // horários fora da grade do médico: permitem encaixe
      for (const t of linhas) if (!coberto.has(t))
        cel.push(html`<div class="agv-cell" style="grid-row:${idx.get(t) + 2};grid-column:${col}"><button class="slot fora" data-encaixe-em="${hhmm(t)}" data-medcol="${m.id}"
          aria-label="Encaixe ${m.nome} às ${hhmm(t)}"><span>Fora do horário</span><span class="add">${icon('plus')} Encaixe</span></button></div>`);
    });

    $('#resumo', el).innerHTML = html`<span><b>${ocupados}</b> agendados</span>·<span><b>${livres}</b> livres</span>·
      <span><b>${confirmados}</b> confirmados</span>·<span><b>${chegaram}</b> na recepção</span>`.s;
    const scroll = $('#agv', el).scrollTop;
    $('#agv', el).innerHTML = html`<div class="agv" style="--cols:${medicos.length};grid-template-rows:auto repeat(${linhas.length}, minmax(var(--row), auto))">${cel}</div>`.s;
    $('#agv', el).scrollTop = scroll;
  }

  // ------------------------------------------------ novo agendamento
  function novo(hora, encaixe = false) {
    let paciente = null;
    const m = modal(html`<header><h2>Novo agendamento</h2><button class="btn ghost icon-only" data-close aria-label="Fechar">${icon('x')}</button></header>
      <form class="modal-body" id="agf" autocomplete="off" novalidate>
        <div class="info-box row wrap"><span class="avatar" style="--av:${medico().cor};width:28px;height:28px;font-size:11px">${iniciais(medico().nome)}</span>
          ${encaixe ? html`<select name="medico_enc" style="width:auto;min-height:34px" aria-label="Médico">${medicos.map((x) => html`<option value="${x.id}" ${x.id === medicoId ? 'selected' : ''}>${x.nome}</option>`)}</select>` : html`<b>${medico().nome}</b>`}
          <span class="muted">· ${fmtData(data)}</span>
          ${encaixe ? html`<input name="hora" type="time" required style="width:120px;min-height:34px" value="${hora || ''}" aria-label="Horário">` : html`<span class="muted">às</span> <b>${hora}</b>`}</div>

        <div class="pac-pick" id="pick">
          <label class="f sugs"><span>Paciente (nome, CPF ou telefone)</span>
            <input id="busca" placeholder="Digite para buscar ou cadastrar" autofocus><ul class="hidden"></ul></label>
        </div>
        <div id="novoPac" class="grid2 hidden">
          <label class="f span2"><span>Nome completo *</span><input name="nome"></label>
          <label class="f"><span>WhatsApp / celular *</span><input name="telefone" type="tel" inputmode="tel" placeholder="(11) 99999-9999"></label>
          <label class="f"><span>Data de nascimento</span><input name="data_nascimento" type="date"></label>
          <label class="f"><span>CPF</span><input name="cpf" inputmode="numeric" placeholder="000.000.000-00"></label>
          <label class="f"><span>Sexo</span><select name="sexo"><option value="">—</option><option value="F">Feminino</option><option value="M">Masculino</option></select></label>
        </div>

        <div class="grid2">
          <div><span class="small muted" style="font-weight:600;display:block;margin-bottom:4px">Pagamento *</span>
            <div class="seg"><label><input type="radio" name="pagamento" value="particular" checked><span>Particular</span></label>
            <label><input type="radio" name="pagamento" value="convenio"><span>Convênio</span></label></div></div>
          <div><span class="small muted" style="font-weight:600;display:block;margin-bottom:4px">Tipo de consulta *</span>
            <div class="seg"><label><input type="radio" name="tipo" value="primeira" checked><span>1ª consulta</span></label>
            <label><input type="radio" name="tipo" value="retorno"><span>Retorno</span></label></div></div>
        </div>
        <div class="grid2 hidden" id="conv">
          <label class="f"><span>Convênio *</span><input name="convenio" list="convs"><datalist id="convs">${CONVENIOS.map((c) => html`<option value="${c}">`)}</datalist></label>
          <label class="f"><span>Nº da carteirinha</span><input name="carteirinha"></label>
        </div>
        <label class="f"><span>Observações para o médico</span><input name="observacoes" placeholder="Ex.: trazer exames, encaminhado por…"></label>
        <label class="row"><input type="checkbox" name="enviar_whatsapp" checked> <span>Enviar confirmação por WhatsApp</span></label>
      </form>
      <footer><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-ok>${icon('check')} Agendar</button></footer>`.s, { largura: 620 });

    const f = $('#agf', m.el);
    const busca = $('#busca', m.el);
    const ul = $('#pick ul', m.el);
    const conv = $('#conv', m.el);
    const novoPac = $('#novoPac', m.el);
    const setPag = () => conv.classList.toggle('hidden', f.pagamento.value !== 'convenio');
    f.addEventListener('change', (e) => { if (e.target.name === 'pagamento') setPag(); });

    function selecionar(p) {
      paciente = p;
      novoPac.classList.add('hidden');
      $('#pick', m.el).innerHTML = html`<div class="pac-sel"><span class="avatar" style="width:32px;height:32px;font-size:12px">${iniciais(p.nome)}</span>
        <div class="grow"><b>${p.nome}</b><div class="small muted">${[p.telefone, p.cpf, idade(p.data_nascimento) != null && idade(p.data_nascimento) + ' anos'].filter(Boolean).join(' · ')}</div>
        ${p.ultima_consulta ? html`<div class="small">Última consulta: ${fmtData(p.ultima_consulta)}</div>` : ''}</div>
        <button type="button" class="btn ghost sm" data-trocar>Trocar</button></div>
        ${!p.telefone ? html`<label class="f" style="margin-top:10px"><span>WhatsApp / celular (paciente sem telefone)</span><input name="telefone_pac" type="tel" inputmode="tel"></label>` : ''}`.s;
      // sugere retorno e convênio com base no cadastro
      if (p.ultima_consulta) f.tipo.value = 'retorno';
      if (p.convenio) { f.pagamento.value = 'convenio'; f.convenio.value = p.convenio; f.carteirinha.value = p.carteirinha || ''; }
      setPag();
      $('[data-trocar]', m.el).addEventListener('click', () => { m.close(); novo(hora, encaixe); });
    }

    let resultados = [];
    const buscar = debounce(async () => {
      const t = busca.value.trim();
      if (t.length < 2) { ul.classList.add('hidden'); return; }
      resultados = await api(`/pacientes?busca=${encodeURIComponent(t)}`).catch(() => []);
      ul.innerHTML = html`${resultados.map((p, i) => html`<li data-i="${i}">${p.nome}<small>${[p.telefone, p.cpf, p.convenio].filter(Boolean).join(' · ')}</small></li>`)}
        <li data-novo>${icon('plus')} Cadastrar novo paciente: <b>${t}</b></li>`.s;
      ul.classList.remove('hidden');
    }, 200);
    busca.addEventListener('input', buscar);
    ul.addEventListener('mousedown', (e) => {
      const li = e.target.closest('li');
      if (!li) return;
      e.preventDefault();
      if (li.dataset.novo !== undefined) {
        const t = busca.value.trim();
        ul.classList.add('hidden');
        novoPac.classList.remove('hidden');
        $('#pick', m.el).classList.add('hidden');
        if (/\d{6,}/.test(t.replace(/\D/g, ''))) f.telefone.value = t; else f.nome.value = t;
        (f.nome.value ? f.telefone : f.nome).focus();
      } else selecionar(resultados[li.dataset.i]);
    });

    $('[data-ok]', m.el).addEventListener('click', (e) => comLoading(e.currentTarget, async () => {
      const d = formData(f);
      const horaFinal = encaixe ? d.hora : hora;
      if (!horaFinal) throw new Error('Informe o horário');
      const body = {
        medico_id: Number(d.medico_enc) || medicoId, data, hora: horaFinal, pagamento: d.pagamento, tipo: d.tipo, convenio: d.convenio, carteirinha: d.carteirinha,
        observacoes: d.observacoes, enviar_whatsapp: d.enviar_whatsapp,
      };
      if (paciente) {
        body.paciente_id = paciente.id;
        if (d.telefone_pac) body.paciente = { telefone: d.telefone_pac };
      } else {
        if (!d.nome?.trim()) throw new Error(busca.value.trim() ? 'Selecione o paciente na lista ou cadastre um novo' : 'Informe o paciente');
        if (!d.telefone?.trim()) throw new Error('Informe o WhatsApp do paciente');
        body.paciente = { nome: d.nome, telefone: d.telefone, data_nascimento: d.data_nascimento, cpf: d.cpf, sexo: d.sexo };
      }
      const r = await api('/agendamentos', { method: 'POST', body });
      m.close();
      await carregar();
      avisoWhatsapp(r.whatsapp, 'Agendado');
    }));
  }

  function avisoWhatsapp(w, prefixo) {
    if (!w) return toast(`${prefixo}.`);
    if (w.ok) return toast(`${prefixo}. Confirmação enviada por WhatsApp ✔`);
    if (w.linkManual) {
      modal(html`<header><h2>${prefixo}</h2></header><div class="modal-body"><p>${w.provider === 'manual'
        ? 'Envie a confirmação pelo WhatsApp da recepção. A mensagem já está pronta com o link de confirmação.'
        : 'O envio automático falhou. Envie a confirmação manualmente:'}</p></div>
        <footer><button class="btn ghost" data-close>Agora não</button><a class="btn wa" href="${w.linkManual}" target="_blank" rel="noopener" data-close>${icon('whatsapp')} Abrir WhatsApp</a></footer>`.s, { largura: 440 });
      return;
    }
    toast(`${prefixo}. ${w.erro || 'WhatsApp não enviado'}`, 'erro');
  }

  // ------------------------------------------------ detalhes do agendamento
  async function detalhes(id) {
    const a = await api(`/agendamentos/${id}`);
    const editavel = !['finalizado', 'em_atendimento'].includes(a.status);
    const anos = idade(a.paciente_nascimento);
    const m = modal(html`<header><h2 class="ellipsis">${a.paciente_nome}</h2><button class="btn ghost icon-only" data-close aria-label="Fechar">${icon('x')}</button></header>
      <div class="modal-body">
        <div class="row wrap">${badgeStatus(a.status)}${badgeTipo(a)}${badgePagamento(a)}</div>
        <dl class="kv">
          <dt>Quando</dt><dd>${fmtData(a.data)} às ${a.hora} · ${a.medico_nome}</dd>
          ${a.paciente_telefone ? html`<dt>Telefone</dt><dd>${a.paciente_telefone}</dd>` : ''}
          ${anos != null ? html`<dt>Idade</dt><dd>${anos} anos</dd>` : ''}
          ${a.paciente_cpf ? html`<dt>CPF</dt><dd>${a.paciente_cpf}</dd>` : ''}
          ${a.carteirinha ? html`<dt>Carteirinha</dt><dd>${a.carteirinha}</dd>` : ''}
          ${a.observacoes ? html`<dt>Obs.</dt><dd>${a.observacoes}</dd>` : ''}
          <dt>WhatsApp</dt><dd>${WA_STATUS[a.whatsapp_status] || a.whatsapp_status}${a.confirmado_em ? html` · confirmou em ${fmtDataHora(a.confirmado_em)}` : ''}</dd>
        </dl>
        ${editavel ? html`
        <div><h3 style="margin-bottom:8px">Status</h3><div class="row wrap">
          <button class="btn ${a.status === 'aguardando' ? 'primary' : ''}" data-st="aguardando">${icon('door')} Paciente chegou</button>
          <button class="btn ${a.status === 'confirmado' ? 'primary' : ''}" data-st="confirmado">${icon('check')} Confirmado</button>
          <button class="btn" data-st="faltou">Faltou</button>
          ${a.status === 'cancelado' || a.status === 'faltou' ? html`<button class="btn" data-st="agendado">Reabrir</button>` : ''}
        </div></div>
        <form id="edf" class="stack">
          <h3>Dados da consulta</h3>
          <div class="grid2">
            <div class="seg"><label><input type="radio" name="pagamento" value="particular" ${a.pagamento === 'particular' ? 'checked' : ''}><span>Particular</span></label>
              <label><input type="radio" name="pagamento" value="convenio" ${a.pagamento === 'convenio' ? 'checked' : ''}><span>Convênio</span></label></div>
            <div class="seg"><label><input type="radio" name="tipo" value="primeira" ${a.tipo === 'primeira' ? 'checked' : ''}><span>1ª consulta</span></label>
              <label><input type="radio" name="tipo" value="retorno" ${a.tipo === 'retorno' ? 'checked' : ''}><span>Retorno</span></label></div>
          </div>
          <div class="grid2" id="conv2"><label class="f"><span>Convênio</span><input name="convenio" list="convs2" value="${a.convenio || ''}"><datalist id="convs2">${CONVENIOS.map((c) => html`<option value="${c}">`)}</datalist></label>
            <label class="f"><span>Carteirinha</span><input name="carteirinha" value="${a.carteirinha || ''}"></label></div>
          <div class="grid2"><label class="f"><span>Remarcar: data</span><input type="date" name="data" value="${a.data}"></label>
            <label class="f"><span>Horário</span><input type="time" name="hora" value="${a.hora}"></label></div>
          <label class="f"><span>Observações</span><input name="observacoes" value="${a.observacoes || ''}"></label>
        </form>` : html`<div class="info-box">Consulta ${a.status === 'finalizado' ? 'já realizada' : 'em andamento'}. Para um retorno, agende um novo horário.</div>`}
      </div>
      <footer>
        ${editavel && a.status !== 'cancelado' ? html`<button class="btn danger-ghost left" data-cancelar>${icon('x')} Cancelar consulta</button>` : ''}
        ${a.status !== 'cancelado' ? html`<button class="btn" data-wa>${icon('whatsapp')} Reenviar WhatsApp</button>` : ''}
        ${editavel ? html`<button class="btn primary" data-salvar>${icon('save')} Salvar</button>` : html`<button class="btn" data-close>Fechar</button>`}
      </footer>`.s, { largura: 600 });

    const edf = $('#edf', m.el);
    if (edf) {
      const setPag = () => $('#conv2', m.el).classList.toggle('hidden', edf.pagamento.value !== 'convenio');
      setPag();
      edf.addEventListener('change', (e) => { if (e.target.name === 'pagamento') setPag(); });
    }
    const atualizar = async (body, msg) => {
      const r = await api(`/agendamentos/${a.id}`, { method: 'PUT', body });
      m.close();
      await carregar();
      if (r.whatsapp) avisoWhatsapp(r.whatsapp, 'Consulta remarcada'); else toast(msg);
    };
    $$('[data-st]', m.el).forEach((b) => b.addEventListener('click', () => comLoading(b, () => atualizar({ status: b.dataset.st }, 'Status atualizado'))));
    $('[data-salvar]', m.el)?.addEventListener('click', (e) => comLoading(e.currentTarget, () => {
      const d = formData(edf);
      if (d.pagamento === 'convenio' && !d.convenio.trim()) throw new Error('Informe o convênio');
      return atualizar(d, 'Agendamento atualizado');
    }));
    $('[data-cancelar]', m.el)?.addEventListener('click', async () => {
      if (await confirmar('Cancelar consulta', `Cancelar a consulta de ${a.paciente_nome} em ${fmtData(a.data)} às ${a.hora}? O horário ficará livre.`, { ok: 'Cancelar consulta', perigo: true }))
        await atualizar({ status: 'cancelado' }, 'Consulta cancelada').catch((e) => toast(e.message, 'erro'));
    });
    $('[data-wa]', m.el)?.addEventListener('click', (e) => comLoading(e.currentTarget, async () => {
      const w = await api(`/agendamentos/${a.id}/whatsapp`, { method: 'POST' });
      m.close();
      await carregar();
      avisoWhatsapp(w, 'Confirmação');
    }));
  }

  el.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.d) { data = addDias(data, Number(t.dataset.d)); carregar(); }
    else if (t.matches('[data-hoje]')) { data = hojeISO(); carregar(); }
    else if (t.dataset.hora) { medicoId = Number(t.dataset.medcol); novo(t.dataset.hora); }
    else if (t.dataset.encaixeEm) { medicoId = Number(t.dataset.medcol); novo(t.dataset.encaixeEm, true); }
    else if (t.dataset.ag) detalhes(Number(t.dataset.ag)).catch((err) => toast(err.message, 'erro'));
    else if (t.matches('[data-encaixe]')) { medicoId = medicos[0].id; novo('', true); }
  });
  $('#dt', el).addEventListener('change', (e) => { if (e.target.value) { data = e.target.value; carregar(); } });

  await carregar();
  const t = setInterval(() => !$('.modal-wrap') && carregar(), 30_000);
  return () => clearInterval(t);
}
