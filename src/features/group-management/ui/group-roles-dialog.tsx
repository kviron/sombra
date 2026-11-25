import {Button} from '@/shared/ui/button';
import {Input} from '@/shared/ui/input';
import {Dialog as RadixDialog} from 'radix-ui';
import {Checkbox} from '@/shared/ui/checkbox';
import {Switch} from '@/shared/ui/switch';
import {X} from 'lucide-react';
import type {ChatState, Group, GroupPermission} from '@/shared/types';
import {GROUP_PERMISSION_CATALOG} from '@/entities/group';
import {OptionsSelect} from '@/shared/ui/select';
import {cn} from '@/shared/lib';
import {useGroupRoles} from '../model/use-group-roles';
import './group-roles-dialog.css';

export type GroupRolesDialogProps = {
 group: Group;
 state: ChatState;
 onClose: () => void;
 refresh: () => Promise<ChatState>;
 onError?: (message: string) => void;
 onBusyChange?: (busy: boolean) => void;
};

export function GroupRolesPanel({group, state, onClose, refresh, onError, onBusyChange}: GroupRolesDialogProps) {
 const {
  tab,
  setTab,
  selected,
  choose,
  create,
  name,
  setName,
  permissions,
  toggle,
  dirty,
  clearDirty,
  error,
  busy,
  confirmDelete,
  setConfirmDelete,
  confirmOff,
  setConfirmOff,
  kick,
  setKick,
  run,
  policy,
  current,
  live,
  supported,
  policySupported,
  owner,
  roles,
  role,
  roleOptions,
  editable,
  members,
  canKick
 } = useGroupRoles({group, state, refresh, onError, onBusyChange});

 return (
  <section className={cn('group-roles-panel', 'flex min-h-0 flex-1 flex-col overflow-hidden')} aria-busy={busy}>
   <nav className={cn('group-roles-tabs', 'border-border flex gap-2 border-b px-6 pb-3')} aria-label="Разделы ролей">
    <Button
     type="button"
     variant={tab === 'roles' ? 'secondary' : 'ghost'}
     aria-pressed={tab === 'roles'}
     onClick={() => setTab('roles')}
    >
     Роли и права
    </Button>
    <Button
     type="button"
     variant={tab === 'members' ? 'secondary' : 'ghost'}
     aria-pressed={tab === 'members'}
     onClick={() => setTab('members')}
    >
     Участники · {current.members.length}
    </Button>
   </nav>
   <div className={cn('group-roles-body', 'min-h-0 overflow-auto overscroll-contain px-6 pt-4 pb-6')}>
    <section className={cn('gs-policy', 'border-border mt-2 border-t py-5')}>
     <div className={cn('gs-policy-row', 'mb-2 flex items-center justify-between gap-5')}>
      <label className="font-semibold" htmlFor="gs-member-invites">
       Разрешить обычным участникам приглашать людей
      </label>
      <Switch
       id="gs-member-invites"
       checked={current.membersCanInvite === true}
       disabled={busy || !owner || !policySupported}
       onCheckedChange={enabled => {
        if (enabled) policy(true);
        else setConfirmOff(true);
       }}
      />
     </div>
     <p className="gr-note">Участники смогут приглашать по email и делиться кодом. Настройку меняет только владелец.</p>
     {!policySupported && (
      <p role="status" className={cn('gs-upgrade', 'border-border bg-card rounded-[8px] border p-3 text-amber-500')}>
       Для изменения этой настройки требуется обновление сервера. Сейчас доступен только просмотр.
      </p>
     )}
     {confirmOff && owner && policySupported && (
      <div className={cn('gs-confirm', 'border-border bg-card rounded-[8px] border p-3 text-amber-500')} role="alert">
       <p>
        Отключить приглашения для обычных участников? Код приглашения изменится, прежние ссылки перестанут работать.
       </p>
       <Button type="button" variant="destructive" disabled={busy} onClick={() => policy(false)}>
        Отключить и заменить код
       </Button>
       <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirmOff(false)}>
        Отмена
       </Button>
      </div>
     )}
    </section>
    {!live && (
     <p role="alert" className="gr-error">
      Группа недоступна. Изменения запрещены.
     </p>
    )}
    {!supported && (
     <p role="status" className="gr-note">
      Для управления ролями требуется обновление сервера. Сейчас доступен только просмотр.
     </p>
    )}
    <p className="gr-note">
     Обычные действия участника (читать/писать/голос/свои сообщения) не меняются. Приглашение по email и доступ к коду
     требуют права приглашать участников. Назначение ролей — только владелец.
    </p>
    {tab === 'roles' ? (
     <>
      <div className={cn('gr-role-picker', 'mb-4 flex items-end gap-3')}>
       <label>
        Роль
        <OptionsSelect
         value={selected}
         onValueChange={choose}
         label="Выбрать роль"
         disabled={busy}
         options={[
          {value: 'owner', label: 'Владелец'},
          ...roleOptions,
          ...(selected === '__new' ? [{value: '__new', label: 'Новая роль'}] : [])
         ]}
        />
       </label>
       {owner && (
        <Button type="button" variant="outline" disabled={busy || roles.length >= 32} onClick={create}>
         Создать роль
        </Button>
       )}
      </div>
      {selected !== 'owner' && selected !== 'member' && (
       <label className={cn('gr-name', 'mb-4 grid gap-1.5')}>
        Название роли
        <Input
         value={name}
         maxLength={40}
         disabled={!editable || busy}
         onChange={event => setName(event.target.value)}
         placeholder="От 1 до 40 символов"
        />
       </label>
      )}
      {selected === 'member' && (
       <p className="gr-note">Роль «Участник» обязательна: её нельзя изменить или удалить. Управленческих прав нет.</p>
      )}
      {!role && selected !== 'owner' && selected !== '__new' && (
       <p className="gr-error">Эта роль удалена. Выберите другую роль; несохранённые изменения остались в форме.</p>
      )}
      <div
       className={cn('gr-matrix-scroll', 'border-border max-w-full overflow-auto rounded-[10px] border')}
       tabIndex={0}
       aria-label="Таблица прав с горизонтальной прокруткой"
      >
       <table className="gr-matrix">
        <thead>
         <tr>
          <th scope="col">Действие</th>
          <th scope="col">Владелец</th>
          <th scope="col">{selected === 'owner' ? 'Владелец' : name || 'Новая роль'}</th>
          <th scope="col">Участник</th>
         </tr>
        </thead>
        <tbody>
         {GROUP_PERMISSION_CATALOG.map(section => (
          <FragmentRows
           key={section.group}
           section={section}
           selected={selected}
           permissions={permissions}
           editable={editable && !busy}
           membersCanInvite={current.membersCanInvite === true}
           onToggle={toggle}
          />
         ))}
         <tr>
          <th scope="row">
           Управление и назначение ролей<small>Только владелец, не передаётся ролям.</small>
          </th>
          <td>Да</td>
          <td>{selected === 'owner' ? 'Да' : '—'}</td>
          <td>—</td>
         </tr>
        </tbody>
       </table>
      </div>
      {owner && selected !== 'member' && selected !== 'owner' && role && (
       <div className={cn('gr-delete', 'border-border bg-card mt-4 rounded-[8px] border p-3')}>
        {confirmDelete ? (
         <>
          <p>Удалить роль «{role.name}»? Все её участники получат роль «Участник».</p>
          <Button
           type="button"
           variant="destructive"

           disabled={busy}
           onClick={() =>
            void run('delete_group_role', {role: selected}, () => {
             clearDirty();
             choose('member');
            })
           }
          >
           Да, удалить роль
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirmDelete(false)}>
           Отмена
          </Button>
         </>
        ) : (
         <Button type="button" variant="destructive" disabled={busy} onClick={() => setConfirmDelete(true)}>
          Удалить роль
         </Button>
        )}
       </div>
      )}
     </>
    ) : (
     <div className={cn('gr-members', 'grid gap-2')}>
      {members.map(user => {
       const assigned = current.memberRoles?.[user.id] || 'member';
       const protectedRole = !!roles.find(item => item.id === assigned)?.permissions.length;
       return (
        <div className={cn('gr-member', 'bg-muted flex items-center gap-3 rounded-[10px] p-3')} key={user.id}>
         <div>
          <strong>{user.name}</strong>
          <small>
           {user.id === current.owner
            ? 'Владелец · все права'
            : user.bot
              ? 'Бот'
              : roles.find(item => item.id === assigned)?.name || 'Участник'}
          </small>
         </div>
         {owner && user.id !== current.owner && !user.bot && (
          <OptionsSelect
           label={`Роль: ${user.name}`}
           value={assigned}
           options={
            roleOptions.some(item => item.value === assigned)
             ? roleOptions
             : [...roleOptions, {value: assigned, label: 'Удалённая роль'}]
           }
           disabled={busy}
           onValueChange={value => void run('set_group_member_role', {user: user.id, role: value})}
          />
         )}
         {canKick && user.id !== state.me.id && user.id !== current.owner && !user.bot && (owner || !protectedRole) && (
          <Button
           type="button"
           variant="destructive"
           disabled={busy}
           onClick={() => setKick({id: user.id, name: user.name})}
          >
           Исключить
          </Button>
         )}
        </div>
       );
      })}
      {kick && canKick && (
       <div className={cn('gr-delete', 'border-border bg-card mt-4 rounded-[8px] border p-3')}>
        <p>Исключить «{kick.name}» из группы? Для возвращения понадобится приглашение.</p>
        <Button
         type="button"
         variant="destructive"

         disabled={busy}
         onClick={() => {
          const target = state.users.find(user => user.id === kick.id);
          const assigned = current.memberRoles?.[kick.id] || 'member';
          if (
           !target ||
           target.bot ||
           kick.id === state.me.id ||
           kick.id === current.owner ||
           !current.members.includes(kick.id) ||
           !canKick ||
           (!owner && roles.some(item => item.id === assigned && item.permissions.length > 0))
          )
           return;
          void run('kick_group_member', {user: kick.id}, () => setKick(null), false);
         }}
        >
         Да, исключить
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => setKick(null)}>
         Отмена
        </Button>
       </div>
      )}
     </div>
    )}
   </div>
   <footer className={cn('group-roles-footer', 'border-border bg-background shrink-0 border-t px-6 pt-3 pb-4')}>
    {error && (
     <p role="alert" className="gr-error">
      {error}
     </p>
    )}
    <div>
     <span>
      {busy
       ? 'Сохранение…'
       : dirty
         ? 'Есть несохранённые изменения'
         : owner
           ? 'Изменения ролей доступны только владельцу'
           : 'Только просмотр'}
     </span>
     <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
      Закрыть
     </Button>
     {tab === 'roles' && editable && (
      <Button
       type="button"
       variant="default"

       disabled={busy || !dirty || !name.trim() || name.trim().length > 40}
       onClick={() => {
        if (!owner) return;
        void run(
         'save_group_role',
         {...(selected === '__new' ? {} : {role: selected}), name: name.trim(), permissions},
         () => {
          if (selected === '__new') choose('member');
          else clearDirty();
         }
        );
       }}
      >
       Сохранить
      </Button>
     )}
    </div>
   </footer>
  </section>
 );
}
function FragmentRows({
 section,
 selected,
 permissions,
 editable,
 membersCanInvite,
 onToggle
}: {
 section: (typeof GROUP_PERMISSION_CATALOG)[number];
 selected: string;
 permissions: GroupPermission[];
 editable: boolean;
 membersCanInvite: boolean;
 onToggle: (key: GroupPermission) => void;
}) {
 return (
  <>
   {section.items.map((item, index) => (
    <tr key={item.key}>
     <th scope="row">
      {index === 0 && (
       <span className={cn('gr-category', 'text-primary mb-1.5 block text-xs leading-[1.5] font-semibold')}>
        {section.group}
       </span>
      )}
      {item.label}
      <small>
       {item.description}
       {item.key === 'members.invite' &&
        membersCanInvite &&
        ' Включено общей настройкой группы; отдельное право роли не меняется.'}
      </small>
     </th>
     <td>Да</td>
     <td>
      {selected === 'owner' ? (
       'Да'
      ) : (
       <Checkbox
        className="mx-auto"
        aria-label={item.label}
        checked={
         (item.key === 'members.invite' && membersCanInvite) ||
         (selected !== 'member' && permissions.includes(item.key))
        }
        disabled={!editable || (item.key === 'members.invite' && membersCanInvite)}
        onCheckedChange={() => onToggle(item.key)}
       />
      )}
     </td>
     <td>{item.key === 'members.invite' && membersCanInvite ? 'Да' : '—'}</td>
    </tr>
   ))}
  </>
 );
}

/** Compatibility wrapper. Settings embeds the panel in its own single dialog root. */
export function GroupRolesDialog(props: GroupRolesDialogProps) {
 return (
  <RadixDialog.Root
   open
   onOpenChange={open => {
    if (!open) props.onClose();
   }}
  >
   <RadixDialog.Portal>
    <RadixDialog.Overlay className="group-roles-overlay" />
    <RadixDialog.Content
     className={cn(
      'group-roles-dialog',
      'fixed top-1/2 left-1/2 z-[110] flex max-h-[calc(100dvh_-_32px)] w-[min(840px,calc(100vw_-_32px))] [transform:translate(-50%,-50%)] flex-col overflow-hidden rounded-[16px]'
     )}
    >
     <header className={cn('group-roles-header', 'flex shrink-0 items-center justify-between gap-4 px-6 pt-5 pb-4')}>
      <div>
       <RadixDialog.Title>Роли и разрешения</RadixDialog.Title>
       <RadixDialog.Description>{props.group.name}</RadixDialog.Description>
      </div>
      <RadixDialog.Close asChild>
       <Button type="button" variant="ghost" size="icon" aria-label="Закрыть">
        <X size={20} />
       </Button>
      </RadixDialog.Close>
     </header>
     <GroupRolesPanel {...props} />
    </RadixDialog.Content>
   </RadixDialog.Portal>
  </RadixDialog.Root>
 );
}
