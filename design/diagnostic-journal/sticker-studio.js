(() => {
  const studio = document.querySelector('.studio');
  document.querySelector('#open-sticker-studio').onclick = () => studio.showModal();
  const tabs = [...studio.querySelectorAll('[role=tab]')];
  function select(tab) {
    for (const item of tabs) {
      const active = item === tab;
      item.tabIndex = active ? 0 : -1;
      item.setAttribute('aria-selected', active);
      document.getElementById(item.getAttribute('aria-controls')).hidden = !active;
    }
  }
  tabs.forEach((tab, index) => {
    tab.onclick = () => select(tab);
    tab.onkeydown = event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const next = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index];
      select(next);
      next.focus();
    };
  });
  const zip = studio.querySelector('#sticker-zip');
  const drop = zip.parentElement;
  function archive(file) {
    if (!file) return;
    studio.querySelector('#zip-status').textContent = /\.zip$/i.test(file.name)
      ? `Выбран архив: ${file.name}. В макете файл не отправляется.` : 'Выберите архив в формате ZIP.';
  }
  zip.onchange = () => archive(zip.files[0]);
  drop.ondragover = event => { event.preventDefault(); drop.dataset.drag = ''; };
  drop.ondragleave = () => { delete drop.dataset.drag; };
  drop.ondrop = event => { event.preventDefault(); delete drop.dataset.drag; archive(event.dataTransfer.files[0]); };
  const form = studio.querySelector('form.studio-composer');
  const prompt = form.querySelector('textarea');
  const files = form.querySelector('[type=file]');
  const fileList = form.querySelector('.studio-files');
  const chat = studio.querySelector('.studio-chat');
  const names = () => [...files.files].map(file => file.name).join(', ');
  files.onchange = () => { fileList.textContent = names(); };
  function message(author, text, user = false) {
    const bubble = document.createElement('div');
    bubble.className = 'studio-message';
    if (user) bubble.dataset.user = '';
    const title = document.createElement('strong');
    const body = document.createElement('p');
    title.textContent = author;
    body.textContent = text;
    bubble.append(title, body);
    chat.append(bubble);
    return bubble;
  }
  form.onsubmit = event => {
    event.preventDefault();
    if (!prompt.value.trim()) return;
    message('Вы', prompt.value.trim() + (names() ? `\nФайлы: ${names()}` : ''), true);
    form.reset();
    fileList.textContent = '';
    const result = message('Sombra', 'Так будет выглядеть предпросмотр набора. Ниже — демонстрационные стикеры, не результат генерации.');
    const grid = document.createElement('div');
    grid.className = 'studio-grid';
    const expressions = [['Радость','M23 36q9 10 18 0'],['Удивление','M32 35a4 5 0 1 0 0 10a4 5 0 1 0 0-10'],['Грусть','M24 43q8-10 16 0']];
    for (const [label, mouth] of expressions) {
      const figure = document.createElement('figure');
      figure.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 28V12l14 8h12l14-8v16c8 21-4 27-20 27S4 49 12 28Z"/><path d="M24 30h.1m16 0h.1 ${mouth}"/></svg><figcaption>${label}</figcaption>`;
      grid.append(figure);
    }
    result.append(grid);
    chat.scrollTop = chat.scrollHeight;
  };
})();
