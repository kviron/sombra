from pathlib import Path
import re

root = Path(__file__).parent
pages = ('index', 'updates', 'voice', 'notifications', 'storage', 'profile', 'security', 'sessions', 'stickers')
routes = dict(zip(('Журнал', 'Обновления', 'Голос и видео', 'Уведомления', 'Данные и память', 'Учётная запись', 'Пароль и безопасность', 'Активные сеансы', 'Стикеры'), pages))
pattern = re.compile(r'(<a class="nav-item")[^>]*>(.*?</svg>)([^<]+)</a>')
outputs = {}
for page in pages:
    path = root / f'{page}.html'
    text = path.read_text(encoding='utf-8')
    def link(m):
        destination = routes.get(m[3].strip())
        if not destination:
            return m[0]
        current = ' aria-current="page"' if destination == page else ''
        return f'{m[1]} href="{destination}.html"{current}>{m[2]}{m[3]}</a>'
    text = pattern.sub(link, text)
    text = text.replace('<a href="#"><svg width="12"', '<a href="profile.html"><svg width="12"', 1)
    for target in pages:
        assert f'class="nav-item" href="{target}.html"' in text, (page, target)
    assert text.count('aria-current="page"') == 1, page
    outputs[path] = text
for path, text in outputs.items():
    path.write_text(text, encoding='utf-8')
print('Validated navigation on all nine screens.')
