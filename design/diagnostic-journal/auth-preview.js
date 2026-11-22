const authForm = document.querySelector('.auth form');
const password = authForm.querySelector('#password');
const confirmation = authForm.querySelector('#confirmation');
const toggle = authForm.querySelector('[data-password]');
const notice = authForm.querySelector('[role=status]');
toggle.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/><path d="m3 3 18 18" hidden/></svg>';
const slash = toggle.querySelector('[hidden]');
toggle.setAttribute('aria-pressed', 'false');
toggle.onclick = () => {
  const visible = password.type === 'password';
  password.type = visible ? 'text' : 'password';
  if (confirmation) confirmation.type = password.type;
  slash.toggleAttribute('hidden', !visible);
  toggle.setAttribute('aria-pressed', String(visible));
  toggle.setAttribute('aria-label', visible ? 'Скрыть пароль' : 'Показать пароль');
};
authForm.addEventListener('input', () => { notice.hidden = true; });
authForm.onsubmit = event => {
  event.preventDefault();
  notice.textContent = confirmation && confirmation.value !== password.value
    ? 'Пароли не совпадают. Проверьте подтверждение пароля.'
    : 'Это макет. Данные не отправляются.';
  notice.hidden = false;
};
