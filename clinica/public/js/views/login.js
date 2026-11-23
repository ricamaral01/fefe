import { html, api, session, $, toast, formData, icon } from '../core.js';
import { inicio, state } from '../app.js';

export default async function login(el) {
  el.innerHTML = html`<div class="login">
    <section class="hero">
      <div class="row"><img src="/icons/icon.svg" width="40" height="40" style="border-radius:10px" alt=""><b style="font-size:18px">Clínica</b></div>
      <div>
        <h1>Agenda, prontuário e receituário em um só lugar.</h1>
        <p>Funciona no computador, tablet e celular. Instale como aplicativo pelo navegador.</p>
      </div>
      <ul>
        <li>${icon('calendar')} Agenda do dia com histórico do paciente</li>
        <li>${icon('whatsapp')} Confirmação automática por WhatsApp</li>
        <li>${icon('printer')} Receitas impressas com o seu cabeçalho</li>
      </ul>
    </section>
    <section class="form-side">
      <form novalidate>
        <div><h1>Entrar</h1><p class="muted">Use seu e-mail e senha.</p></div>
        <label class="f"><span>E-mail</span><input name="email" type="email" autocomplete="username" required autofocus inputmode="email"></label>
        <label class="f"><span>Senha</span><input name="senha" type="password" autocomplete="current-password" required></label>
        <button class="btn primary lg" type="submit">Entrar</button>
      </form>
    </section>
  </div>`.s;
  const form = $('form', el);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button', form);
    btn.disabled = true;
    try {
      const { token, user } = await api('/login', { method: 'POST', body: formData(form) });
      session.set(token, user);
      state.clinica = null;
      location.hash = inicio(user);
    } catch (err) {
      toast(err.message, 'erro');
    } finally {
      btn.disabled = false;
    }
  });
}
