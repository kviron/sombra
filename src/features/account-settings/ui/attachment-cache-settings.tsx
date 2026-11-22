import {HardDrive, RefreshCw, Trash2, LoaderCircle} from 'lucide-react';
import {Button} from '@/shared/ui/button';
import {Select} from '@/shared/ui/select';
import {useAttachmentCache} from '../model/use-attachment-cache';
import './attachment-cache-settings.css';
import './account-approved.css';

export function AttachmentCacheSettings({ready, onChanged}: {ready: boolean; onChanged: () => Promise<unknown>}) {
 const model = useAttachmentCache({ready, onChanged});
 return (
  <section
   className="attachment-cache-settings approved-cache"
   aria-labelledby="cache-settings-heading"
   aria-busy={model.busy}
  >
   <h2 id="cache-settings-heading">
    <HardDrive size={22} />
    Данные и память
   </h2>
   <p>Уже загруженные вложения сохраняются на этом устройстве, чтобы не скачивать их повторно.</p>
   <div className="approved-cache-ledger">
    <h3>Локальное хранение</h3>
    <div className="cache-usage">
     <div>
      <span>Кэш текущего аккаунта</span>
      <small>{model.summary}</small>
     </div>
     <div className="approved-cache-actions">
      <strong>{model.size}</strong>
      <Button
       type="button"
       variant="outline"
       title="Обновить сведения о кэше"
       aria-label="Обновить сведения о кэше"
       disabled={model.disabled}
       onClick={() => void model.refresh()}
      >
       <RefreshCw size={17} />
       Обновить сведения
      </Button>
     </div>
    </div>
    <div className="approved-cache-row">
     <div>
      <h3>Ограничение места</h3>{' '}
      <p className="cache-hint">
       Лимит относится к этому аккаунту на этом устройстве. При заполнении удаляются давно не использованные копии, а не
       сообщения в чате.
      </p>
     </div>{' '}
     <div className="cache-limit">
      <label htmlFor="attachment-cache-limit">Лимит кэша</label>
      <Select
       id="attachment-cache-limit"
       label="Лимит кэша вложений"
       value={model.limit}
       options={model.options}
       disabled={model.disabled || !model.info}
       onValueChange={value => void model.setLimit(value)}
      />
     </div>
    </div>
    <div className="approved-cache-row">
     <div>
      <h3>Очистка копий</h3>
      <p>Сообщения и файлы в «Загрузках» останутся на месте.</p>
     </div>{' '}
     <div className="cache-clear">
      {model.confirm ? (
       <>
        <p>
         Очистить локальные копии этого аккаунта? Файлы, уже очищенные на сервере, после этого не получится открыть из
         кэша.
        </p>
        <div>
         <Button type="button" variant="destructive" disabled={model.busy} onClick={() => void model.clearCache()}>
          Да, очистить кэш
         </Button>
         <Button type="button" variant="outline" disabled={model.busy} onClick={() => model.setConfirm(false)}>
          Отмена
         </Button>
        </div>
       </>
      ) : (
       <Button type="button" variant="outline" disabled={model.clearDisabled} onClick={() => model.setConfirm(true)}>
        <Trash2 size={16} />
        Очистить кэш аккаунта
       </Button>
      )}
     </div>
    </div>
   </div>
   <div className="cache-notes">
    <h3>Как это работает</h3>
    <ul>
     <li>Сохраняются только просмотренные фото и загруженные файлы — не вся история автоматически.</li>
     <li>
      Если срок хранения файла на сервере истёк, доступная локальная копия откроется с отметкой «Локальная копия».
     </li>
     <li>
      Кэш не восстанавливает удалённые сообщения и не даёт доступа к группам, из которых вас исключили. Для проверки
      доступа нужна связь с сервером.
     </li>
     <li>
      Аккаунты разделены. Очистка не затрагивает файлы, которые вы отдельно сохранили в «Загрузки», и копии других
      пользователей.
     </li>
     <li>
      Открытые предпросмотры могут оставаться в памяти. После повторного открытия доступный файл может снова попасть в
      кэш.
     </li>
    </ul>
   </div>
   {model.busy && (
    <p className="cache-operation" role="status">
     <LoaderCircle size={15} className="animate-spin" />
     Обновляем хранилище…
    </p>
   )}
   {model.notice && (
    <p className="cache-notice" role="status">
     {model.notice}
    </p>
   )}
   {model.error && (
    <p className="cache-error" role="alert">
     {model.error}
    </p>
   )}
  </section>
 );
}
