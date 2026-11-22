import {useEffect, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {AvatarFrame, DECORATION_PRESETS, fxSchedulerState} from '@/shared/ui/avatar-fx';
import type {DecorationInput, PaletteName} from '@/shared/ui/avatar-fx';
import {ProfileDecorationPicker} from '@/features/account-settings'; // The local QA page exercises the real app modal.
import {UserProfile} from '@/pages/chat';
import type {User} from '@/shared/types';
import '@/shared/ui/profile-cover.css';
import '@/entities/user/ui/user.css';
import '@/pages/chat/ui/chat.css';
import '@/app/styles/glass.css';
import './preview.css';

const AVATAR =
 'data:image/svg+xml,' +
 encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8f7bd8"/><stop offset="1" stop-color="#3d2b6b"/>
    </linearGradient></defs>
    <rect width="96" height="96" fill="url(#g)"/>
    <circle cx="48" cy="38" r="17" fill="#f2d9c4"/>
    <path d="M20 96c2-22 14-32 28-32s26 10 28 32z" fill="#d8c6f2"/>
    <circle cx="41" cy="36" r="2.4" fill="#2a2140"/><circle cx="55" cy="36" r="2.4" fill="#2a2140"/>
    <path d="M41 45c4 4 10 4 14 0" stroke="#2a2140" stroke-width="2" fill="none" stroke-linecap="round"/>
  </svg>`
 );

const COVER =
 'data:image/svg+xml,' +
 encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="300">
    <defs><linearGradient id="s" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1b2440"/><stop offset="1" stop-color="#4b2c63"/>
    </linearGradient></defs>
    <rect width="900" height="300" fill="url(#s)"/>
    <path d="M0 220 L140 150 L260 205 L420 110 L560 190 L700 120 L900 210 L900 300 L0 300 Z" fill="#0e1322" opacity=".85"/>
    <circle cx="720" cy="70" r="26" fill="#f7e7c2" opacity=".9"/>
  </svg>`
 );

const RING_PALETTES: PaletteName[] = ['ember', 'fire', 'lava', 'ice', 'arcane'];

const USERS = {
 mira: {id: 'demo_mira', name: 'Мира', avatar: AVATAR, online: true},
 kai: {id: 'demo_kai', name: 'Кай', online: false},
 rook: {id: 'demo_rook', name: 'Рук', avatar: AVATAR, online: true},
 vera: {id: 'demo_vera', name: 'Вера', online: true}
};

declare global {
 interface Window {
  __sombraAvatarFx?: {
   state: typeof fxSchedulerState;
   canvases: () => Array<{
    effect: string | null;
    anchor: string | null;
    width: number;
    height: number;
    cssWidth: number;
    cssHeight: number;
   }>;
  };
 }
}

function App() {
 const [palette, setPalette] = useState<PaletteName>('ember');
 const [intensity, setIntensity] = useState(0.9);
 const [showDebug, setShowDebug] = useState(true);
 const [picker, setPicker] = useState<'avatar' | 'cover'>();
 const [showProfile, setShowProfile] = useState(false);
 const [stats, setStats] = useState(() => fxSchedulerState());

 const ringDecoration = useMemo<DecorationInput>(
  () => ({
   v: 1,
   target: 'avatar',
   seed: Number(new URLSearchParams(location.search).get('seed') ?? 19),
   layers: [{effect: 'holy/divine-shield', palette, anchor: 'ring', intensity}]
  }),
  [palette, intensity]
 );
 const slimeDecoration = DECORATION_PRESETS['slime-pet'].decoration;
 const iceSlime = useMemo<DecorationInput>(
  () => ({
   ...slimeDecoration,
   seed: 23,
   layers: [{effect: 'critters/slime', palette: 'ice', anchor: 'bottom-right', intensity: 0.9}]
  }),
  [slimeDecoration]
 );
 const coverDecoration = DECORATION_PRESETS['aurora-cover'].decoration;
 const sceneDecoration = DECORATION_PRESETS['runner-cover'].decoration;
 const runnerOnly = useMemo<DecorationInput>(
  () => ({
   v: 1,
   target: 'cover',
   mode: 'scene',
   loop: true,
   seed: 5,
   layers: [{effect: 'sombra/runner', palette: 'ice', anchor: 'runner', intensity: 0.9}]
  }),
  []
 );

 useEffect(() => {
  window.__sombraAvatarFx = {
   state: fxSchedulerState,
   canvases: () =>
    [...document.querySelectorAll<HTMLCanvasElement>('.avatar-fx__canvas')].map(canvas => {
     const box = canvas.getBoundingClientRect();
     return {
      effect: canvas.dataset.avatarFxEffect ?? null,
      anchor: canvas.dataset.avatarFxAnchor ?? null,
      width: canvas.width,
      height: canvas.height,
      cssWidth: Math.round(box.width * 10) / 10,
      cssHeight: Math.round(box.height * 10) / 10
     };
    })
  };
  const timer = setInterval(() => setStats(fxSchedulerState()), 300);
  return () => {
   clearInterval(timer);
   delete window.__sombraAvatarFx;
  };
 }, []);

 const profileUser: User = {
  ...USERS.mira,
  bio: '',
  created_at: 0,
  decorations: {avatar: DECORATION_PRESETS['ember-crown'].decoration, cover: sceneDecoration}
 };
 return (
  <main className="preview">
   {showProfile && (
    <UserProfile user={profileUser} me={profileUser} groups={[]} onClose={() => setShowProfile(false)} />
   )}
   {picker && (
    <ProfileDecorationPicker
     target={picker}
     user={{...USERS.mira, bio: '', created_at: 0}}
     onSave={async () => {}}
     onClose={() => setPicker(undefined)}
     onRestoreFocus={() => {}}
    />
   )}
   <header className="preview__head">
    <div>
     <p className="preview__eyebrow">Sombra · оформление профиля</p>
     <h1>Рамки аватара на canvas</h1>
     <p className="preview__lead">
      Эффекты pixelfx (MIT) рисуются кодом в низкой сетке и растягиваются nearest-neighbour — без картинок и без потери
      чёткости. Это тестовая страница движка, а не экран приложения.
     </p>
    </div>
    <div className="preview__stats" id="qa-debug">
     <button id="qa-avatar-picker" onClick={() => setPicker('avatar')}>
      Рамки
     </button>
     <button id="qa-cover-picker" onClick={() => setPicker('cover')}>
      Обложки
     </button>
     <button id="qa-profile" onClick={() => setShowProfile(true)}>
      Карточка профиля
     </button>
     <span>
      Активных: {stats.animated}/{stats.visible}
     </span>
     <span>Кадров: {stats.frames}</span>
     <span>Последний: {stats.lastPaintMs.toFixed(2)} мс</span>
     <span>{stats.hidden ? 'hidden' : 'live'}</span>
    </div>
   </header>

   <section className="panel" id="qa-ring">
    <div className="panel__head">
     <h2>Пламенный обод</h2>
     <p>Кольцо идёт по краю аватара: центр замаскирован, лицо и инициал не перекрыты.</p>
    </div>
    <div className="row">
     {(['sm', 'md', 'lg', 'xl'] as const).map(size => (
      <div className="demo" key={size}>
       <UserAvatar user={USERS.mira} size={size} decoration={ringDecoration} />
       <span className="demo__label">{size}</span>
      </div>
     ))}
     <div className="demo">
      <UserAvatar user={USERS.kai} size="xl" decoration={ringDecoration} />
      <span className="demo__label">инициал</span>
     </div>
    </div>
    <div className="controls">
     {RING_PALETTES.map(name => (
      <button
       key={name}
       type="button"
       className={name === palette ? 'chip chip--on' : 'chip'}
       onClick={() => setPalette(name)}
      >
       {name}
      </button>
     ))}
     <label className="range">
      интенсивность
      <input
       type="range"
       min={0}
       max={1}
       step={0.05}
       value={intensity}
       onChange={event => setIntensity(Number(event.target.value))}
      />
      <span>{intensity.toFixed(2)}</span>
     </label>
    </div>
   </section>

   <section className="panel" id="qa-slime">
    <div className="panel__head">
     <h2>Слайм в углу</h2>
     <p>Прыгающий слайм живёт у нижнего края аватара; значок присутствия остаётся поверх.</p>
    </div>
    <div className="row">
     {(['md', 'lg', 'xl'] as const).map(size => (
      <div className="demo" key={size}>
       <UserAvatar user={USERS.vera} size={size} decoration={slimeDecoration} />
       <span className="demo__label">{size}</span>
      </div>
     ))}
     <div className="demo">
      <UserAvatar user={USERS.rook} size="xl" decoration={iceSlime} />
      <span className="demo__label">лёд</span>
     </div>
     <div className="demo">
      <UserAvatar user={USERS.rook} size="xl" decoration={slimeDecoration} presence={false} />
      <span className="demo__label">без статуса</span>
     </div>
    </div>
   </section>

   <section className="panel" id="qa-load">
    <div className="panel__head">
     <h2>Нагрузка</h2>
     <p>Пятнадцать слоёв на экране, но анимируются не больше четырёх — остальные держат статичный кадр.</p>
    </div>
    <div className="row row--dense">
     {Array.from({length: 10}, (_, index) => (
      <UserAvatar
       key={index}
       user={{id: `load_${index}`, name: `U${index}`, online: index % 2 === 0}}
       size="md"
       decoration={index % 2 === 0 ? ringDecoration : slimeDecoration}
      />
     ))}
    </div>
   </section>

   <section className="panel" id="qa-cover">
    <div className="panel__head">
     <h2>Обложка профиля</h2>
     <p>Сияние рисуется на всю обложку и складывается с фоном в режиме screen.</p>
    </div>
    <div className="covers">
     <div className="preview-cover">
      <div className="profile-cover">
       <AvatarFrame decoration={coverDecoration} target="cover" />
      </div>
      <span className="demo__label">градиент</span>
     </div>
     <div className="preview-cover">
      <div className="profile-cover">
       <img src={COVER} alt="" />
       <AvatarFrame decoration={coverDecoration} target="cover" />
      </div>
      <span className="demo__label">поверх картинки</span>
     </div>
    </div>
   </section>

   <section className="panel" id="qa-scene">
    <div className="panel__head">
     <h2>Обложка-сцена</h2>
     <p>
      Вся обложка — зацикленная пиксельная сцена, нарисованная кодом: небо со звёздами, сияние, холмы, бегущая земля и
      маленький бегун. Никаких GIF или PNG.
     </p>
    </div>
    <div className="covers">
     <div className="preview-cover">
      <div className="profile-cover" id="qa-scene-full">
       <AvatarFrame decoration={sceneDecoration} target="cover" />
      </div>
      <span className="demo__label">сияние + бегун</span>
     </div>
     <div className="preview-cover">
      <div className="profile-cover" id="qa-scene-runner">
       <AvatarFrame decoration={runnerOnly} target="cover" />
      </div>
      <span className="demo__label">только бегун</span>
     </div>
    </div>
   </section>

   <section className="panel">
    <div className="panel__head">
     <h2>Документ</h2>
     <p>Ровно это уйдёт в профиль (JSON, версия 1). Рендер ничего не запрашивает.</p>
    </div>
    <pre className="json">
     {JSON.stringify(
      {...ringDecoration, seed: Number(new URLSearchParams(location.search).get('seed') ?? 19)},
      null,
      2
     )}
    </pre>
    <button type="button" className="chip" onClick={() => setShowDebug(value => !value)}>
     {showDebug ? 'скрыть' : 'показать'} отладку
    </button>
    {showDebug && (
     <pre className="json json--small">
      {JSON.stringify({...stats, canvases: window.__sombraAvatarFx?.canvases() ?? []}, null, 2)}
     </pre>
    )}
   </section>

   <div className="qa-spacer" aria-hidden="true" />
  </main>
 );
}

createRoot(document.getElementById('root')!).render(<App />);
