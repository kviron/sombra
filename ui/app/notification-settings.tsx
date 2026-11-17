import {useRef,useState} from 'react';
import {Bell,MessageCircle,Users,LoaderCircle} from 'lucide-react';
import {api,type ChatPreferences} from '@/shared/api/backend';
import {Switch} from '@/shared/ui/switch';
import './notification-settings.css';

export function NotificationSettings({preferences,ready,onSaved}:{preferences?:ChatPreferences;ready:boolean;onSaved:(preferences:ChatPreferences)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const pending=useRef(false);
 async function change(key:'direct'|'groups',enabled:boolean){
  if(pending.current||!ready)return;
  pending.current=true;setBusy(true);setError('');
  try{onSaved(await api<ChatPreferences>('set_notification_preferences',{[key]:enabled}))}
  catch(reason){setError(reason instanceof Error?reason.message:'Не удалось сохранить настройки уведомлений.')}
  finally{pending.current=false;setBusy(false)}
 }
 return <section className="notification-settings" aria-labelledby="notification-settings-heading" aria-busy={busy}>
  <h2 id="notification-settings-heading"><Bell size={22}/>Уведомления</h2>
  <p>Выберите, откуда получать новые сообщения. Настройки сохраняются в вашем аккаунте.</p>
  <div className="notification-option"><MessageCircle size={22}/><label htmlFor="notify-direct"><strong>Личные сообщения</strong><span>Личные и групповые диалоги из списка переписок.</span></label><Switch id="notify-direct" aria-label="Уведомления из личных сообщений" checked={preferences?.notifications.direct!==false} disabled={!ready||busy} onCheckedChange={value=>void change('direct',value)}/></div>
  <div className="notification-option"><Users size={22}/><label htmlFor="notify-groups"><strong>Сообщения в группах</strong><span>Все текстовые каналы и чаты голосовых каналов ваших групп.</span></label><Switch id="notify-groups" aria-label="Уведомления из групп" checked={preferences?.notifications.groups!==false} disabled={!ready||busy} onCheckedChange={value=>void change('groups',value)}/></div>
  <div className="notification-help"><h3>Отдельные чаты</h3><p>Нажмите правой кнопкой на переписку в списке личных сообщений, чтобы отключить или включить её уведомления. Общий переключатель имеет приоритет.</p><p>Когда вы читаете открытый чат, уведомления о нём не дублируются. Старые сообщения не приходят повторно после включения.</p><p>Уведомления работают, пока Sombra запущена. В браузере они показываются внутри приложения.</p></div>
  {busy&&<p className="notification-saving" role="status"><LoaderCircle size={15} className="animate-spin"/>Сохраняем…</p>}
  {error&&<p className="notification-settings-error" role="alert">{error}</p>}
 </section>;
}
