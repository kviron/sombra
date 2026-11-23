import {LoaderCircle} from 'lucide-react';
import {type ChatPreferences} from '@/shared/types';
import {useNotificationSettings} from '../model/use-notification-settings';
import {Switch} from '@/shared/ui/switch';
import './notification-settings.css';
import '@/shared/ui/account-media-settings.css';

export function NotificationSettings({
 preferences,
 ready,
 onSaved
}: {
 preferences?: ChatPreferences;
 ready: boolean;
 onSaved: (preferences: ChatPreferences) => void;
}) {
 const model = useNotificationSettings({preferences, ready, onSaved});
 return (
  <section
   className="notification-settings account-media-notifications"
   aria-label="Настройки уведомлений"
   aria-busy={model.busy}
  >
   <p>Выберите, откуда получать новые сообщения. Настройки сохраняются в вашем аккаунте.</p>
   <div className="notification-option [&>svg]:shrink-0 [&>svg]:text-[#aeb8c9]">
    <label htmlFor="notify-direct">
     <strong className="text-[15px] leading-[1.5] font-semibold text-[#e4e8f0]">Личные сообщения</strong>
     <span>Личные и групповые диалоги из списка переписок.</span>
    </label>
    <Switch
     id="notify-direct"
     aria-label="Уведомления из личных сообщений"
     checked={model.checked('direct')}
     disabled={model.disabled}
     onCheckedChange={value => void model.change('direct', value)}
    />
   </div>
   <div className="notification-option [&>svg]:shrink-0 [&>svg]:text-[#aeb8c9]">
    <label htmlFor="notify-groups">
     <strong className="text-[15px] leading-[1.5] font-semibold text-[#e4e8f0]">Сообщения в группах</strong>
     <span>Все текстовые каналы и чаты голосовых каналов ваших групп.</span>
    </label>
    <Switch
     id="notify-groups"
     aria-label="Уведомления из групп"
     checked={model.checked('groups')}
     disabled={model.disabled}
     onCheckedChange={value => void model.change('groups', value)}
    />
   </div>
   <div className="notification-help mt-7">
    <h2 className="flex items-center gap-2.5">Отдельные чаты</h2>
    <p>
     Нажмите правой кнопкой на переписку в списке личных сообщений, чтобы отключить или включить её уведомления. Общий
     переключатель имеет приоритет.
    </p>
    <p>
     Когда вы читаете открытый чат, уведомления о нём не дублируются. Старые сообщения не приходят повторно после
     включения.
    </p>
    <p>Уведомления работают, пока Sombra запущена. В браузере они показываются внутри приложения.</p>
   </div>
   {model.busy && (
    <p className="notification-saving flex items-center gap-2" role="status">
     <LoaderCircle size={15} className="animate-spin" />
     Сохраняем…
    </p>
   )}
   {model.error && (
    <p className="notification-settings-error" role="alert">
     {model.error}
    </p>
   )}
  </section>
 );
}
