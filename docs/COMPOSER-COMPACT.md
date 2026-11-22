# Компактный Elements Composer

Источник: [официальный Elements Composer](https://www.assistant-ui.com/elements/composer), public MIT upstream commit076de9eaf1b5f0f1fb6fb359c5e5d68770cae65c. Компоненты/surfaces и лицензия находятся в shared/ui/elements-composer. Геометрия соответствует upstream: Bar radius24/padding10/gap8, общие круглые ghost32px toolbar buttons,44px attachment chip. Сохранены native Sombra callbacks, локализация и UI-only assistant runtime без model/network runtime. Цвета берутся из существующей dark palette независимо от светлой темы ОС.

Нижние подписи были не полезным footer: установленный TriggerPopover при CLOSED рендерит direct children для регистрации поведения. Свободные p заголовки попадали в форму. Теперь заголовки находятся внутри Items-render, который закрытым возвращает null. Скрытие CSS-костылём не добавлялось.

Вложение внутри той же поверхности — имя/размер/icon/x вместо160px image card и отдельной чёрной полосы. Размер валидируется/мемоизируется по base64; на каждую клавишу10МиБ не декодируются. Blob URL для generic-chip не создаётся. Runtime drafts/send/error/IME/paste/mentions/scoped commands остаются прежними. Autosize ограничен5строками/144px для voice на минимальном720×520окне.

Убраны использовавшиеся legacy textarea/tool/hint/draft styles; старые глобальные button/focus правила исключают новый Elements root/input. Цвет/геометрия кнопок не зависят от трёх разных wrappers.

132 actual React/source-Vite browser проверки:720/1080/1620и640 ширины, DM/group/voice,106px empty form,44pxchip,32px общие hover controls, dark в light media, closed menus, @/slash/IME/Enter/failure, containment до нижней границы. Root look/check_design подтверждают внешний вид и отсутствие composer overflow; штатный upstream chip-X20px намеренно сохранён. API синтетическая, native picker/hardware не проверялись.

Также shared in-app/native-popup notification CSS подсвечивает целую карточку, основной clickable overlay прозрачен; close остаётся отдельным действием.26 браузерных сценариев проверяют hover/focus/targets/close/guards; реальные OS tray input не заявляются.

TypeScript/Vite build пройден. Изменения в коде, отдельный installer release пока не публиковался.
