import {Dialog} from 'radix-ui';
import {Settings, ShieldCheck, X} from 'lucide-react';
import {type ChatState, type Group} from '@/shared/types';
import {ImageCropDialog} from '@/shared/ui/image-crop-dialog';
import type {GroupSettingsSection} from '../model/group-settings';
import {useGroupSettings} from '../model/use-group-settings';
import {GroupRolesPanel} from './group-roles-dialog';
import './group-settings-dialog.css';

export type {GroupSettingsSection} from '../model/group-settings';

export type GroupSettingsDialogProps = {
 group: Group;
 state: ChatState;
 initialSection?: GroupSettingsSection;
 onClose: () => void;
 refresh: () => Promise<ChatState>;
 onError?: (message: string) => void;
 onManageStickers: (groupId: string) => void;
};
export function GroupSettingsDialog({
 group,
 state,
 initialSection = 'general',
 onClose,
 refresh,
 onError,
 onManageStickers
}: GroupSettingsDialogProps) {
 const {
  section,
  current,
  member,
  rename,
  avatarAllowed,
  canManageStickers,
  name,
  avatar,
  nameChanged,
  avatarChanged,
  busy,
  rolePending,
  error,
  cropFile,
  cropOrigin,
  canSave,
  isCloseBlocked,
  actions
 } = useGroupSettings({group, state, initialSection, refresh, onError});

 return (
  <Dialog.Root
   open
   onOpenChange={open => {
    if (!open && !isCloseBlocked()) onClose();
   }}
  >
   <Dialog.Portal>
    <Dialog.Overlay className="group-roles-overlay" />
    <Dialog.Content
     className="group-roles-dialog group-settings-dialog"
     onEscapeKeyDown={event => {
      if (isCloseBlocked()) event.preventDefault();
     }}
    >
     {cropFile && (
      <ImageCropDialog file={cropFile} kind="avatar" onConfirm={actions.applyAvatar} onClose={actions.closeCrop} />
     )}
     <aside className="gs-sidebar">
      <div className="gs-group-name">{current.name}</div>
      <nav aria-label="Настройки группы">
       <button
        aria-current={section === 'general' ? 'page' : undefined}
        disabled={rolePending}
        onClick={() => actions.setSection('general')}
       >
        <Settings size={18} />
        Общее
       </button>
       <button
        aria-current={section === 'roles' ? 'page' : undefined}
        disabled={busy}
        onClick={() => actions.setSection('roles')}
       >
        <ShieldCheck size={18} />
        Роли и разрешения
       </button>
      </nav>
     </aside>
     <div className="gs-main">
      <header className="gs-header">
       <div>
        <Dialog.Title>{section === 'general' ? 'Общее' : 'Роли и разрешения'}</Dialog.Title>
        <Dialog.Description>Настройки группы · {current.name}</Dialog.Description>
       </div>
       <Dialog.Close asChild>
        <button className="gr-icon" disabled={busy || rolePending} aria-label="Закрыть настройки группы">
         <X size={20} />
        </button>
       </Dialog.Close>
      </header>
      {section === 'roles' ? (
       <GroupRolesPanel
        group={current}
        state={state}
        onClose={onClose}
        refresh={refresh}
        onError={onError}
        onBusyChange={actions.setRolePending}
       />
      ) : (
       <>
        <div className="gs-content">
         {!member && (
          <p className="gr-error" role="alert">
           Группа недоступна. Изменения запрещены.
          </p>
         )}
         <section className="gs-avatar-field">
          <span className="gs-avatar" aria-hidden="true">
           {avatar ? <img src={avatar} alt="" /> : name.slice(0, 2)}
          </span>
          <div>
           <label htmlFor="gs-avatar">Аватар группы</label>
           <input
            id="gs-avatar"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy || !avatarAllowed}
            aria-describedby="gs-avatar-hint"
            onChange={event => {
             const file = event.target.files?.[0];
             event.target.value = '';
             if (file) {
              cropOrigin.current = event.currentTarget;
              actions.openCrop(file);
             }
            }}
           />
           <p id="gs-avatar-hint" className="gr-note">
            PNG, JPEG или WebP до 20 МБ / 32 Мп. PNG 256 × 256, до 256 КБ.
           </p>
           {avatar && avatarAllowed && (
            <button disabled={busy} onClick={actions.removeAvatar}>
             Удалить аватар
            </button>
           )}
          </div>
         </section>
         <label className="gs-name" htmlFor="gs-name">
          Название группы
          <input
           id="gs-name"
           value={name}
           maxLength={60}
           disabled={busy || !rename}
           onChange={event => actions.setNameDraft(event.target.value)}
          />
         </label>
         {!rename && !avatarAllowed && (
          <p className="gr-note">Только просмотр. Изменение названия и аватара доступно по отдельным разрешениям.</p>
         )}

         {member && canManageStickers && (
          <button disabled={busy} onClick={() => onManageStickers(current.id)}>
           Стикеры группы
          </button>
         )}
        </div>
        <footer className="gs-footer">
         {error && (
          <p role="alert" className="gr-error">
           {error}
          </p>
         )}
         <div>
          <span className="gr-note">
           {busy ? 'Сохранение…' : nameChanged || avatarChanged ? 'Есть несохранённые изменения' : ''}
          </span>
          {(rename || avatarAllowed) && (
           <button className="gr-primary" disabled={busy || !canSave} onClick={actions.save}>
            Сохранить
           </button>
          )}
         </div>
        </footer>
       </>
      )}
     </div>
    </Dialog.Content>
   </Dialog.Portal>
  </Dialog.Root>
 );
}
