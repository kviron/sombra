import {useEffect,useState,useSyncExternalStore} from 'react';
import {invoke,isTauri} from '@tauri-apps/api/core';
import {getVersion} from '@tauri-apps/api/app';
import {Channel} from '@tauri-apps/api/core';
import {Button} from '@/shared/ui/button';
import {createUpdater} from './update-controller';

import './updates.css';

const updater=createUpdater({
 async check(){
  const info=await invoke<{version:string;body?:string}|null>('check_update');
  return info?{...info,download:async(cb)=>{
   const progress=new Channel<{received:number;total?:number}>();
   let last=0,started=false;
   progress.onmessage=event=>{if(!started){cb({event:'Started',data:{contentLength:event.total}});started=true}cb({event:'Progress',data:{chunkLength:event.received-last}});last=event.received};
   await invoke('download_update',{progress});
  },install:()=>invoke<void>('install_update'),close:async()=>{}}:null;
 },
 relaunch:()=>invoke('restart_app'),
});
const useUpdate=()=>useSyncExternalStore(updater.subscribe,updater.snapshot);
let availability:Promise<boolean>|undefined;
function configured(){return availability??=isTauri()?invoke<boolean>('updater_configured').catch(()=>false):Promise.resolve(false)}
export function UpdateNotice(){
 const state=useUpdate();const [dismissed,setDismissed]=useState(false);
 useEffect(()=>{
  let active=true;
  const poll=()=>{void configured().then(ok=>{if(active&&ok)void updater.check()})};
  const first=setTimeout(poll,10000),timer=setInterval(poll,4*60*60*1000);
  window.addEventListener('online',poll);
  return()=>{active=false;clearTimeout(first);clearInterval(timer);window.removeEventListener('online',poll)};
 },[]);
 if(dismissed||state.phase!=='available')return null;
 return <aside className="update-notice dark" aria-label="Обновление Sombra"><span role="status">Доступна Sombra {state.version}.</span><Button variant="secondary" size="sm" onClick={()=>{window.dispatchEvent(new Event('sombra:open-updates'));void updater.download()}}>Обновить</Button><Button variant="ghost" size="sm" onClick={()=>setDismissed(true)}>Позже</Button></aside>;
}
function message(state:ReturnType<typeof updater.snapshot>){
 switch(state.phase){
  case 'idle':return 'Проверяем автоматически при запуске и каждые 4 часа.';
  case 'checking':return 'Проверяем обновления…';
  case 'current':return 'У вас последняя версия Sombra.';
  case 'available':return 'Доступна Sombra '+state.version;
  case 'downloading':return 'Загружаем обновление'+(state.percent===undefined?'…':': '+state.percent+'%');
  case 'ready':return 'Обновление проверено и готово к установке.';
  case 'installing':return 'Устанавливаем обновление…';
  case 'restart':return 'Обновление установлено. Перезапустите Sombra.';
  case 'error':return state.message;
 }
}
export function UpdateSettings({inCall}:{inCall:boolean}){
 const state=useUpdate();const [enabled,setEnabled]=useState<boolean|null>(null),[version,setVersion]=useState('');
 useEffect(()=>{void configured().then(setEnabled);if(isTauri())void getVersion().then(setVersion).catch(()=>{})},[]);
 const busy=['checking','downloading','installing'].includes(state.phase);
 const action=state.phase==='available'?()=>updater.download():state.phase==='ready'?()=>updater.install():state.phase==='restart'?()=>updater.restart():()=>updater.check();
 return <section className="update-settings"><h2>Обновления Sombra</h2>{version&&<p className="settings-hint">Текущая версия {version}</p>}<p role="status">{enabled===null?'Проверяем настройки…':!enabled?isTauri()?'Канал обновлений ещё не настроен для этой сборки.':'Обновления доступны в установленном приложении.':message(state)}</p>{enabled&&<>{state.message&&state.phase!=='error'&&<p role="alert">{state.message}</p>}{state.phase==='downloading'&&<progress aria-label="Загрузка обновления" max={100} value={state.percent}/>}<p className="settings-hint">Установка закроет приложение. Сначала завершите разговор; черновики сообщений сохраняются.</p>{inCall&&<p className="settings-hint">Завершите звонок перед установкой.</p>}<Button variant="secondary" size="sm" disabled={busy||(inCall&&(state.phase==='ready'||state.phase==='restart'))} onClick={()=>void action()}>{state.phase==='available'?'Скачать обновление':state.phase==='ready'?'Установить и перезапустить':state.phase==='restart'?'Перезапустить':busy?'Подождите…':'Проверить обновления'}</Button>{state.notes&&<><h3>Что нового в {state.version}</h3><p className="update-notes">{state.notes}</p></>}</>}</section>;
}
