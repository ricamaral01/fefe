// Tela inicial do médico: agenda do dia
import { html, api, session, $, toast, hojeISO, addDias, fmtDataLonga, idade, icon, badgeStatus, badgePagamento, badgeTipo } from '../core.js';

export default async function agenda(el) {
  const u = session.user;
  let data = sessionStorage.getItem('agenda-data') || hojeISO();

  el.innerHTML = html`
    <div class="topbar">
      <div class="grow"><h1>Bom dia, ${u.nome.split(' ').slice(0, 2).join(' ')}</h1><div class="muted" id="sub"></div></div>
      <div class="datenav">
        <button class="btn ghost icon-only" data-d="-1" aria-label="Dia anterior">${icon('left')}</button>
        <input type="date" id="dt" aria-label="Data">
        <button class="btn ghost icon-only" data-d="1" aria-label="Próximo dia">${icon('right')}</button>
        <button class="btn ghost sm" data-hoje>Hoje</button>
      </div>
    </div>
    <div class="stats" id="stats"></div>
    <div class="card"><header><h2 class="grow">Agendamentos</h2><span class="small muted" id="upd"></span></header><div class="ag-list" id="lista"></div></div>`.s;

  const saud = new Date().getHours();
  $('h1', el).textContent = `${saud < 12 ? 'Bom dia' : saud < 18 ? 'Boa tarde' : 'Boa noite'}, ${u.nome.split(' ').slice(0, 2).join(' ')}`;

  async function carregar() {
    const dtEl = $('#dt', el);
    if (!dtEl) return;
    dtEl.value = data;
    sessionStorage.setItem('agenda-data', data);
    $('#sub', el).textContent = fmtDataLonga(data) + (data === hojeISO() ? ' · hoje' : '');
    let r;
    try { r = await api(`/agenda?data=${data}`); } catch (e) { return toast(e.message, 'erro'); }
    const ags = r.blocos.map((b) => b.agendamento).filter(Boolean);
    const n = (f) => ags.filter(f).length;
    $('#stats', el).innerHTML = html`
      <div class="card stat"><b>${ags.length}</b><span>Pacientes no dia</span></div>
      <div class="card stat"><b>${n((a) => a.status === 'aguardando')}</b><span>Na recepção</span></div>
      <div class="card stat"><b>${n((a) => a.status === 'finalizado')}</b><span>Atendidos</span></div>
      <div class="card stat"><b>${n((a) => a.tipo === 'primeira')}</b><span>Primeiras consultas</span></div>`.s;

    const agora = new Date().toTimeString().slice(0, 5);
    const proximo = data === hojeISO() ? ags.find((a) => a.hora >= agora.slice(0, 5) || a.status === 'aguardando') : null;
    $('#lista', el).innerHTML = r.blocos.length
      ? r.blocos.map((b) => {
          const a = b.agendamento;
          if (!a) return html`<div class="ag-item livre"><div class="hora">${b.hora}</div><div class="nome">Horário livre</div><span></span></div>`;
          const id = idade(a.paciente_nascimento);
          return html`<button class="ag-item st-${a.status} ${proximo?.id === a.id ? 'agora' : ''}" data-id="${a.id}">
            <div class="hora">${a.hora}</div>
            <div class="grow"><div class="nome ellipsis">${a.paciente_nome}</div>
              <div class="meta">${badgeStatus(a.status)}${badgeTipo(a)}${badgePagamento(a)}${id != null ? html`<span class="small muted">${id} anos</span>` : ''}
              ${a.observacoes ? html`<span class="small muted ellipsis">· ${a.observacoes}</span>` : ''}</div></div>
            <span class="go">${a.status === 'finalizado' ? 'Ver' : 'Atender'} ${icon('right')}</span>
          </button>`;
        }).join('')
      : html`<div class="empty">Sem horários de atendimento neste dia.</div>`.s;
    $('#upd', el).textContent = 'Atualizado ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  el.addEventListener('click', async (e) => {
    const d = e.target.closest('[data-d]');
    if (d) { data = addDias(data, Number(d.dataset.d)); return carregar(); }
    if (e.target.closest('[data-hoje]')) { data = hojeISO(); return carregar(); }
    const item = e.target.closest('.ag-item[data-id]');
    if (item) {
      item.disabled = true;
      try {
        const at = await api(`/agendamentos/${item.dataset.id}/atender`, { method: 'POST' });
        location.hash = `#/atendimento/${at.id}`;
      } catch (err) { toast(err.message, 'erro'); item.disabled = false; }
    }
  });
  $('#dt', el).addEventListener('change', (e) => { if (e.target.value) { data = e.target.value; carregar(); } });

  await carregar();
  const t = setInterval(carregar, 30_000); // vê novos agendamentos e chegadas da recepção
  const onFocus = () => document.visibilityState === 'visible' && carregar();
  document.addEventListener('visibilitychange', onFocus);
  return () => { clearInterval(t); document.removeEventListener('visibilitychange', onFocus); };
}
