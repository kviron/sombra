import {Checkbox, Switch, Dialog as RadixDialog} from 'radix-ui';
import {Check, X} from 'lucide-react';
import type {ChatState, Group, GroupPermission} from '@/shared/types';
import {GROUP_PERMISSION_CATALOG} from '@/entities/group';
import {Select} from '@/shared/ui/select';
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
  <section className="group-roles-panel" aria-busy={busy}>
   <nav className="group-roles-tabs" aria-label="Разделы ролей">
    <button aria-pressed={tab === 'roles'} onClick={() => setTab('roles')}>
     Роли и права
    </button>
    <button aria-pressed={tab === 'members'} onClick={() => setTab('members')}>
     Участники · {current.members.length}
    </button>
   </nav>
   <div className="group-roles-body">
    <section className="gs-policy">
     <div className="gs-policy-row">
      <label htmlFor="gs-member-invites">Разрешить обычным участникам приглашать людей</label>
      <Switch.Root
       id="gs-member-invites"
       className="gs-switch"
       checked={current.membersCanInvite === true}
       disabled={busy || !owner || !policySupported}
       onCheckedChange={enabled => {
        if (enabled) policy(true);
        else setConfirmOff(true);
       }}
      >
       <Switch.Thumb className="gs-switch-thumb" />
      </Switch.Root>
     </div>
     <p className="gr-note">Участники смогут приглашать по email и делиться кодом. Настройку меняет только владелец.</p>
     {!policySupported && (
      <p role="status" className="gs-upgrade">
       Для изменения этой настройки требуется обновление сервера. Сейчас доступен только просмотр.
      </p>
     )}
     {confirmOff && owner && policySupported && (
      <div className="gs-confirm" role="alert">
       <p>
        Отключить приглашения для обычных участников? Код приглашения изменится, прежние ссылки перестанут работать.
       </p>
       <button className="gr-danger" disabled={busy} onClick={() => policy(false)}>
        Отключить и заменить код
       </button>
       <button disabled={busy} onClick={() => setConfirmOff(false)}>
        Отмена
       </button>
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
      <div className="gr-role-picker">
       <label>
        Роль
        <Select
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
        <button disabled={busy || roles.length >= 32} onClick={create}>
         Создать роль
        </button>
       )}
      </div>
      {selected !== 'owner' && selected !== 'member' && (
       <label className="gr-name">
        Название роли
        <input
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
      <div className="gr-matrix-scroll" tabIndex={0} aria-label="Таблица прав с горизонтальной прокруткой">
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
       <div className="gr-delete">
        {confirmDelete ? (
         <>
          <p>Удалить роль «{role.name}»? Все её участники получат роль «Участник».</p>
          <button
           className="gr-danger"
           disabled={busy}
           onClick={() =>
            void run('delete_group_role', {role: selected}, () => {
             clearDirty();
             choose('member');
            })
           }
          >
           Да, удалить роль
          </button>
          <button disabled={busy} onClick={() => setConfirmDelete(false)}>
           Отмена
          </button>
         </>
        ) : (
         <button className="gr-danger" disabled={busy} onClick={() => setConfirmDelete(true)}>
          Удалить роль
         </button>
        )}
       </div>
      )}
     </>
    ) : (
     <div className="gr-members">
      {members.map(user => {
       const assigned = current.memberRoles?.[user.id] || 'member';
       const protectedRole = !!roles.find(item => item.id === assigned)?.permissions.length;
       return (
        <div className="gr-member" key={user.id}>
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
          <Select
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
          <button className="gr-danger" disabled={busy} onClick={() => setKick({id: user.id, name: user.name})}>
           Исключить
          </button>
         )}
        </div>
       );
      })}
      {kick && canKick && (
       <div className="gr-delete">
        <p>Исключить «{kick.name}» из группы? Для возвращения понадобится приглашение.</p>
        <button
         className="gr-danger"
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
        </button>
        <button disabled={busy} onClick={() => setKick(null)}>
         Отмена
        </button>
       </div>
      )}
     </div>
    )}
   </div>
   <footer className="group-roles-footer">
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
     <button disabled={busy} onClick={onClose}>
      Закрыть
     </button>
     {tab === 'roles' && editable && (
      <button
       className="gr-primary"
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
      </button>
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
      {index === 0 && <span className="gr-category">{section.group}</span>}
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
       <Checkbox.Root
        className="gr-checkbox"
        aria-label={item.label}
        checked={
         (item.key === 'members.invite' && membersCanInvite) ||
         (selected !== 'member' && permissions.includes(item.key))
        }
        disabled={!editable || (item.key === 'members.invite' && membersCanInvite)}
        onCheckedChange={() => onToggle(item.key)}
       >
        <Checkbox.Indicator>
         <Check size={16} />
        </Checkbox.Indicator>
       </Checkbox.Root>
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
    <RadixDialog.Content className="group-roles-dialog">
     <header className="group-roles-header">
      <div>
       <RadixDialog.Title>Роли и разрешения</RadixDialog.Title>
       <RadixDialog.Description>{props.group.name}</RadixDialog.Description>
      </div>
      <RadixDialog.Close asChild>
       <button className="gr-icon" aria-label="Закрыть">
        <X size={20} />
       </button>
      </RadixDialog.Close>
     </header>
     <GroupRolesPanel {...props} />
    </RadixDialog.Content>
   </RadixDialog.Portal>
  </RadixDialog.Root>
 );
}
