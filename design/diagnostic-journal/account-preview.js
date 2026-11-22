const windowPanel = document.querySelector('.window');
if (windowPanel) {
  const routes = new Map([
    ['Обновления','updates'], ['Голос и видео','voice'], ['Уведомления','notifications'],
    ['Данные и память','storage'], ['Учётная запись','profile'], ['Пароль и безопасность','security'],
    ['Активные сеансы','sessions'], ['Стикеры','stickers'], ['Журнал','index'],
  ]);
  const page = windowPanel.dataset.section || location.pathname.split('/').pop()?.replace(/\.html$/, '') || 'index';
  // Reuse the same sidebar markup and SVG icons as the three original screens.
  async function init() {
    let sidebar = windowPanel.querySelector('.sidebar');
    if (!sidebar?.querySelector('.account-switcher')) {
      const response = await fetch('index.html');
      if (!response.ok) throw new Error('Не удалось загрузить меню настроек');
      const shared = new DOMParser().parseFromString(await response.text(), 'text/html').querySelector('.sidebar');
      if (sidebar) {
        sidebar.querySelector('.account').append(shared.querySelector('.account-switcher'));
      } else {
        sidebar = shared;
        windowPanel.prepend(sidebar);
      }
    }
    sidebar.querySelector('.account a').href = 'profile.html';
    for (const item of sidebar.querySelectorAll('.nav-item')) {
      const route = routes.get(item.textContent.trim());
      if (!route) continue;
      item.href = `${route}.html`;
      if (route === page) item.setAttribute('aria-current','page');
      else item.removeAttribute('aria-current');
    }
    const heading = windowPanel.querySelector('.pane-head');
    if (!heading.querySelector('.modal-close')) {
      heading.insertAdjacentHTML('beforeend','<button type="button" class="icon-btn modal-close" aria-label="Закрыть настройки"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18m0-12 12 12"/></svg></button>');
    }
  }
  init();
  if (page === 'stickers') {
    windowPanel.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-sticker-view]');
      if (!trigger) return;
      const view = trigger.dataset.stickerView;
      for (const panel of windowPanel.querySelectorAll('[data-sticker-panel]')) panel.hidden = panel.dataset.stickerPanel !== view;
      for (const tab of windowPanel.querySelectorAll('[aria-pressed][data-sticker-view]')) {
        const active = tab.dataset.stickerView === view;
        tab.setAttribute('aria-pressed', String(active));
        tab.classList.toggle('btn--primary', active);
        tab.classList.toggle('btn--secondary', !active);
      }
    });
  }
}
