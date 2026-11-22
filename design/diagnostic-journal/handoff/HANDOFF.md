# 交接：diagnostic-journal → React + Vite（跟项目一样）

> 给写代码的模型看：照这份把设计稿做成真页面。设计稿就是源码——每屏一个 HTML，样式在 tokens.css 等样式表里。先读源文件，截图只用来对照，别凭截图猜数值。

## 做什么

- 设计目录：`D:\media\Documents\Craft Anything\discord\app\design\diagnostic-journal`（9 屏，desktop 1280×800）
- 做到：`D:\media\Documents\Craft Anything\discord\app`（现有项目 mines：React + Vite + Tailwind，TypeScript，包管理 npm）
- 框架：React + Vite（跟项目一样）
- 生成时间：2026-11-20 02:36（UTC+3）

## 桌面软件要点

- 这是桌面软件的设计（窗口内容 1280×800）。要做成真软件：Electron 或 Tauri 套网页，框架选的「React + Vite（跟项目一样）」写界面；用户要原生（SwiftUI / WinUI）就先问清。
- 窗口按钮是系统画的：Mac 用无边框标题栏（Electron `titleBarStyle: 'hiddenInset'`，Tauri `titleBarStyle: 'Overlay'`），红绿灯盖在左上角，设计稿左上空出的 80×52 照留；顶栏可拖动的地方加 `-webkit-app-region: drag`，按钮、输入框加 `no-drag`。Windows 用自定义标题栏时右上角 138×32 留给系统按钮（Electron `titleBarOverlay`）。
- 整个窗口不滚，侧栏、列表、详情各自滚（`overflow: auto`）；最小窗口尺寸照设计里最小的那种（多尺寸里的 1024×680）设。

## 屏幕和路由

| 屏 | 设计文件 | 建议路由 | 截图（handoff/shots/） | 跳到 |
| --- | --- | --- | --- | --- |
| Журнал · Sombra | index.html | `/` | index-1.jpg | profile、updates、voice、notifications、storage、security、sessions、stickers |
| profile | profile.html | `/profile` | 没截成（TypeError: Cannot read properties of undefined (reading 'settle')
    at <anonymous>:1:20） | — |
| Пароль и безопасность · Sombra | security.html | `/security` | 没截成（Runtime.evaluate timeout） | profile、updates、voice、notifications、storage、sessions、stickers、index |
| Активные сеансы · Sombra | sessions.html | `/sessions` | sessions-1.jpg | profile、updates、voice、notifications、storage、security、stickers、index |
| Данные и память · Sombra | storage.html | `/storage` | 没截成（TypeError: Cannot read properties of undefined (reading 'scroll')
    at <anonymous>:1:20） | profile、updates、voice、notifications、security、sessions、stickers、index |
| Стикеры · Sombra | stickers.html | `/stickers` | stickers-1.jpg | profile、updates、voice、notifications、storage、security、sessions、index |
| Голос и видео · Sombra | voice.html | `/voice` | voice-1.jpg | profile、updates、notifications、storage、security、sessions、stickers、index |
| Обновления · Sombra | updates.html | `/updates` | 没截成（Inspected target navigated or closed） | profile、voice、notifications、storage、security、sessions、stickers、index |
| Уведомления · Sombra | notifications.html | `/notifications` | notifications-1.jpg | profile、updates、voice、storage、security、sessions、stickers、index |

## 设计变量

`tokens.css` 里 65 个变量（颜色 0 个：）。

- 把 tokens.css 原样放进项目的全局样式并在入口引入；Tailwind 的 theme.extend 里把颜色、圆角、字号、阴影映射到这些变量（如 `primary: 'var(--color-primary)'`），类名里别写死色值。
- 别的样式表：`account-preview.css`、`auth-alternatives.css`、`auth-ambient.css`、`components.css`、`extras-b.css`、`journal.css`、`sticker-studio.css`、`updates.css`、`voice-design.css`（公共样式，拆进对应组件或全局样式）

## 几屏共用的部分（做成组件）

- `.pane`：9 屏都有（index、profile、security、sessions、storage、stickers、voice、updates、notifications）→ `Pane` 组件
- `.window`：9 屏都有（index、profile、security、sessions、storage、stickers、voice、updates、notifications）→ `Window` 组件
- `.btn`：8 屏都有（index、profile、security、sessions、storage、stickers、voice、updates）→ `Btn` 组件
- `.actions`：5 屏都有（index、profile、security、sessions、voice）→ `Actions` 组件
- `.icon-btn`：4 屏都有（index、stickers、voice、updates）→ `IconBtn` 组件
- `.account`：3 屏都有（index、voice、updates）→ `Account` 组件
- `.modal-close`：3 屏都有（index、voice、updates）→ `ModalClose` 组件
- `.nav`：3 屏都有（index、voice、updates）→ `Nav` 组件
- `.section`：3 屏都有（profile、storage、notifications）→ `Section` 组件
- `.sidebar`：3 屏都有（index、voice、updates）→ `Sidebar` 组件
- `.card`：2 屏都有（voice、updates）→ `Card` 组件
- `.stack`：2 屏都有（profile、security）→ `Stack` 组件

## 交互和状态

- index.html：1 个输入控件（做成受控组件、加校验和出错状态）
- profile.html：1 段脚本（改成框架里的状态和事件）；6 个输入控件（做成受控组件、加校验和出错状态）
- security.html：3 个输入控件（做成受控组件、加校验和出错状态）
- storage.html：1 段脚本（改成框架里的状态和事件）；1 个输入控件（做成受控组件、加校验和出错状态）
- stickers.html：3 个输入控件（做成受控组件、加校验和出错状态）
- voice.html：1 段脚本（改成框架里的状态和事件）；8 个输入控件（做成受控组件、加校验和出错状态）
- updates.html：1 个输入控件（做成受控组件、加校验和出错状态）
- notifications.html：2 个输入控件（做成受控组件、加校验和出错状态）
- 悬停 / 聚焦 / 按下的样式 29 处：照搬，别丢。

## 图片和字体

- `assets/favicon.svg`、`assets/sombra.svg`：照原样复制进项目的静态资源目录（public/ 或 src/assets/）

## 做法和验收

1. 搭骨架：在现有项目里加页面和路由（看清它现有的目录结构、样式写法、组件库再动手）；把 tokens.css（和公共样式表）搬进去。
2. 一屏一个页面，路由照上面的表；先抽几屏共用的组件，再拼页面。
3. 结构、文案、数字、图标照设计稿的 HTML 搬；class 名可以改成项目的习惯，样式值（间距、字号、颜色、圆角、阴影）一律用设计变量。
4. 每做完一屏：把开发服务器跑起来，调 `compare_design`（screen 填设计文件名，url 填这一屏在开发服务器上的地址），照差异图把不一样的地方改掉，直到差异在 3% 以内，或者剩下的差别说得出理由（比如真实数据、系统字体）。
5. 全部做完：每屏再对一遍；告诉用户做了哪些页面、怎么跑起来（命令和地址）、还有哪里和设计稿不一样。

别做：改设计（配色、文案、布局）、加设计稿里没有的功能、引入新的 UI 组件库（项目已经在用的除外）。
