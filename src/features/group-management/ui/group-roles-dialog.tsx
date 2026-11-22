import { useEffect, useRef, useState } from 'react';
import { Checkbox, Switch, Dialog as RadixDialog } from 'radix-ui';
import { Check, X } from 'lucide-react';
import { type ChatState, type Group, type GroupPermission } from '@/shared/types';
import { canGroup, DEFAULT_MEMBER_ROLE, getGroupRoles, GROUP_PERMISSION_CATALOG, groupService } from '@/entities/group';
import { Select } from '@/shared/ui/select';
import './group-roles-dialog.css';

export type GroupRolesDialogProps = {group:Group;state:ChatState;onClose:()=>void;refresh:()=>Promise<ChatState>;onError?:(message:string)=>void;onBusyChange?:(busy:boolean)=>void};
export function GroupRolesPanel({group,state,onClose,refresh,onError,onBusyChange}:GroupRolesDialogProps) {
 const live = state.groups.find(item=>item.id===group.id);
 const current = live ?? group;
 const supported = Array.isArray(current.roles) && typeof current.rolesRevision==='number';
 const policySupported=supported&&typeof current.membersCanInvite==='boolean';
 const actualOwner = !!live && current.owner===state.me.id && current.members.includes(state.me.id);
 const owner = actualOwner && supported;
 const roles=getGroupRoles(current);
 const [tab,setTab]=useState<'roles'|'members'>('roles');
 const [selected,setSelected]=useState('member');
 const [name,setName]=useState('Участник');
 const [permissions,setPermissions]=useState<GroupPermission[]>([]);
 const [dirty,setDirty]=useState(false);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [confirmDelete,setConfirmDelete]=useState(false);
 const [confirmOff,setConfirmOff]=useState(false);
 useEffect(()=>{if(!owner||!policySupported||!current.membersCanInvite)setConfirmOff(false)},[owner,policySupported,current.membersCanInvite]);
 const [kick,setKick]=useState<{id:string;name:string}|null>(null);
 const locks=useRef(new Set<string>());
 const latest=useRef({current,owner,live,state,supported});latest.current={current,owner,live,state,supported};
 const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const role=roles.find(item=>item.id===selected);
 const signature=JSON.stringify(role);
 useEffect(()=>{
  if(dirty || selected==='__new')return;
  setName(role?.name??DEFAULT_MEMBER_ROLE.name);setPermissions(role?.permissions??[]);
 },[signature,selected,dirty]);
 useEffect(()=>{setSelected('member');setDirty(false);setConfirmDelete(false);setKick(null);setError('');},[group.id]);
 const editable=owner && selected!=='member' && selected!=='owner' && (selected==='__new'||!!role);
 const members=state.users.filter(user=>current.members.includes(user.id));
 function choose(value:string){if(dirty&&!window.confirm('Отменить несохранённые изменения роли?'))return;setSelected(value);setDirty(false);setConfirmDelete(false);setError('');}
 function create(){if(dirty&&!window.confirm('Отменить несохранённые изменения роли?'))return;setSelected('__new');setName('');setPermissions([]);setDirty(true);setError('');}
 async function run(op:string,data:Record<string,unknown>,after?:()=>void,ownerOnly=true){
  const actions={
   set_group_member_invites:groupService.setMemberInvites,
   set_group_member_role:groupService.setMemberRole,
   kick_group_member:groupService.kickMember,
   delete_group_role:groupService.deleteRole,
   save_group_role:groupService.saveRole
  };
  const snapshot=latest.current;
  if(locks.current.size || !snapshot.live || !snapshot.supported || (ownerOnly&&!snapshot.owner))return;
  if(op==='set_group_member_invites'&&typeof snapshot.current.membersCanInvite!=='boolean')return;
  if(op==='set_group_member_role'){
   const target=snapshot.state.users.find(user=>user.id===data.user);
   if(!target||target.bot||target.id===snapshot.current.owner||!snapshot.current.members.includes(target.id)||!getGroupRoles(snapshot.current).some(role=>role.id===data.role))return;
  }
  if((op==='delete_group_role'||op==='save_group_role')&&data.role&&!getGroupRoles(snapshot.current).some(role=>role.id===data.role&&role.id!=='member'&&role.id!=='owner'))return;
  const groupId=snapshot.current.id;
  locks.current.add(op);setBusy(true);onBusyChange?.(true);setError('');
  try{
   await actions[op as keyof typeof actions]({...data,group:groupId,...(op==='kick_group_member'?{}:{revision:snapshot.current.rolesRevision||0})});
   await refresh();
   if(mounted.current&&latest.current.current.id===groupId)after?.();
  }catch(cause){
   if(!mounted.current||latest.current.current.id!==groupId)return;
   const raw=cause instanceof Error?cause.message:String(cause);
   const conflict=/revision|conflict|верси|изменен|изменён/i.test(raw);
   const message=conflict?'Роли уже изменены другим запросом. Данные обновлены; ваши изменения сохранены в форме. Проверьте их и повторите сохранение.':raw;
   setError(message);onError?.(message);
   if(conflict){try{await refresh();}catch{ /* Keep the actionable conflict and unsaved draft. */ }}
  }finally{locks.current.delete(op);onBusyChange?.(false);if(mounted.current&&latest.current.current.id===groupId)setBusy(false);}
 }
 function policy(enabled:boolean){void run('set_group_member_invites',{enabled},()=>setConfirmOff(false))}
 const canKick=supported&&!!live&&canGroup(current,state.me.id,'members.kick');
 const roleOptions=roles.map(item=>({value:item.id,label:item.name}));
 return <section className="group-roles-panel" aria-busy={busy}><nav className="group-roles-tabs" aria-label="Разделы ролей"><button aria-pressed={tab==='roles'} onClick={()=>setTab('roles')}>Роли и права</button><button aria-pressed={tab==='members'} onClick={()=>setTab('members')}>Участники · {current.members.length}</button></nav>
   <div className="group-roles-body">
   <section className="gs-policy"><div className="gs-policy-row"><label htmlFor="gs-member-invites">Разрешить обычным участникам приглашать людей</label><Switch.Root id="gs-member-invites" className="gs-switch" checked={current.membersCanInvite===true} disabled={busy||!owner||!policySupported} onCheckedChange={enabled=>{if(enabled)policy(true);else setConfirmOff(true)}}><Switch.Thumb className="gs-switch-thumb"/></Switch.Root></div><p className="gr-note">Участники смогут приглашать по email и делиться кодом. Настройку меняет только владелец.</p>{!policySupported&&<p role="status" className="gs-upgrade">Для изменения этой настройки требуется обновление сервера. Сейчас доступен только просмотр.</p>}{confirmOff&&owner&&policySupported&&<div className="gs-confirm" role="alert"><p>Отключить приглашения для обычных участников? Код приглашения изменится, прежние ссылки перестанут работать.</p><button className="gr-danger" disabled={busy} onClick={()=>policy(false)}>Отключить и заменить код</button><button disabled={busy} onClick={()=>setConfirmOff(false)}>Отмена</button></div>}</section>
    {!live&&<p role="alert" className="gr-error">Группа недоступна. Изменения запрещены.</p>}
    {!supported&&<p role="status" className="gr-note">Для управления ролями требуется обновление сервера. Сейчас доступен только просмотр.</p>}
    <p className="gr-note">Обычные действия участника (читать/писать/голос/свои сообщения) не меняются. Приглашение по email и доступ к коду требуют права приглашать участников. Назначение ролей — только владелец.</p>
    {tab==='roles'?<>
     <div className="gr-role-picker"><label>Роль<Select value={selected} onValueChange={choose} label="Выбрать роль" disabled={busy} options={[{value:'owner',label:'Владелец'},...roleOptions,...(selected==='__new'?[{value:'__new',label:'Новая роль'}]:[])]}/></label>{owner&&<button disabled={busy||roles.length>=32} onClick={create}>Создать роль</button>}</div>
     {selected!=='owner'&&selected!=='member'&&<label className="gr-name">Название роли<input value={name} maxLength={40} disabled={!editable||busy} onChange={event=>{setName(event.target.value);setDirty(true);}} placeholder="От 1 до 40 символов"/></label>}
     {selected==='member'&&<p className="gr-note">Роль «Участник» обязательна: её нельзя изменить или удалить. Управленческих прав нет.</p>}
     {!role&&selected!=='owner'&&selected!=='__new'&&<p className="gr-error">Эта роль удалена. Выберите другую роль; несохранённые изменения остались в форме.</p>}
     <div className="gr-matrix-scroll" tabIndex={0} aria-label="Таблица прав с горизонтальной прокруткой"><table className="gr-matrix"><thead><tr><th scope="col">Действие</th><th scope="col">Владелец</th><th scope="col">{selected==='owner'?'Владелец':name||'Новая роль'}</th><th scope="col">Участник</th></tr></thead><tbody>
      {GROUP_PERMISSION_CATALOG.map(section=><FragmentRows key={section.group} section={section} selected={selected} permissions={permissions} editable={editable&&!busy} membersCanInvite={current.membersCanInvite===true} onToggle={key=>{setPermissions(values=>values.includes(key)?values.filter(value=>value!==key):[...values,key]);setDirty(true);}}/>)}
      <tr><th scope="row">Управление и назначение ролей<small>Только владелец, не передаётся ролям.</small></th><td>Да</td><td>{selected==='owner'?'Да':'—'}</td><td>—</td></tr>
     </tbody></table></div>
     {owner&&selected!=='member'&&selected!=='owner'&&role&&<div className="gr-delete">{confirmDelete?<><p>Удалить роль «{role.name}»? Все её участники получат роль «Участник».</p><button className="gr-danger" disabled={busy} onClick={()=>void run('delete_group_role',{role:selected},()=>{setSelected('member');setDirty(false);setConfirmDelete(false);})}>Да, удалить роль</button><button disabled={busy} onClick={()=>setConfirmDelete(false)}>Отмена</button></>:<button className="gr-danger" disabled={busy} onClick={()=>setConfirmDelete(true)}>Удалить роль</button>}</div>}
    </>:<div className="gr-members">{members.map(user=>{const assigned=current.memberRoles?.[user.id]||'member';const protectedRole=!!roles.find(item=>item.id===assigned)?.permissions.length;return <div className="gr-member" key={user.id}><div><strong>{user.name}</strong><small>{user.id===current.owner?'Владелец · все права':user.bot?'Бот':roles.find(item=>item.id===assigned)?.name||'Участник'}</small></div>{owner&&user.id!==current.owner&&!user.bot&&<Select label={`Роль: ${user.name}`} value={assigned} options={roleOptions.some(item=>item.value===assigned)?roleOptions:[...roleOptions,{value:assigned,label:'Удалённая роль'}]} disabled={busy} onValueChange={value=>void run('set_group_member_role',{user:user.id,role:value})}/ >}{canKick&&user.id!==state.me.id&&user.id!==current.owner&&!user.bot&&(owner||!protectedRole)&&<button className="gr-danger" disabled={busy} onClick={()=>setKick({id:user.id,name:user.name})}>Исключить</button>}</div>;})}{kick&&canKick&&<div className="gr-delete"><p>Исключить «{kick.name}» из группы? Для возвращения понадобится приглашение.</p><button className="gr-danger" disabled={busy} onClick={()=>{const fresh=latest.current;const target=fresh.state.users.find(user=>user.id===kick.id);const assigned=fresh.current.memberRoles?.[kick.id]||'member';if(!target||target.bot||kick.id===fresh.state.me.id||kick.id===fresh.current.owner||!fresh.current.members.includes(kick.id)||!canGroup(fresh.current,fresh.state.me.id,'members.kick')||(!fresh.owner&&getGroupRoles(fresh.current).some(role=>role.id===assigned&&role.permissions.length>0)))return;void run('kick_group_member',{user:kick.id},()=>setKick(null),false);}}>Да, исключить</button><button disabled={busy} onClick={()=>setKick(null)}>Отмена</button></div>}</div>}
   </div>
   <footer className="group-roles-footer">{error&&<p role="alert" className="gr-error">{error}</p>}<div><span>{busy?'Сохранение…':dirty?'Есть несохранённые изменения':owner?'Изменения ролей доступны только владельцу':'Только просмотр'}</span><button disabled={busy} onClick={onClose}>Закрыть</button>{tab==='roles'&&editable&&<button className="gr-primary" disabled={busy||!dirty||!name.trim()||name.trim().length>40} onClick={()=>{if(!latest.current.owner)return;void run('save_group_role',{...(selected==='__new'?{}:{role:selected}),name:name.trim(),permissions},()=>{setDirty(false);if(selected==='__new')setSelected('member');});}}>Сохранить</button>}</div></footer>
  </section>;
}
function FragmentRows({section,selected,permissions,editable,membersCanInvite,onToggle}:{section:typeof GROUP_PERMISSION_CATALOG[number];selected:string;permissions:GroupPermission[];editable:boolean;membersCanInvite:boolean;onToggle:(key:GroupPermission)=>void}) {
 return <>{section.items.map((item,index)=><tr key={item.key}><th scope="row">{index===0&&<span className="gr-category">{section.group}</span>}{item.label}<small>{item.description}{item.key==='members.invite'&&membersCanInvite&&' Включено общей настройкой группы; отдельное право роли не меняется.'}</small></th><td>Да</td><td>{selected==='owner'?'Да':<Checkbox.Root className="gr-checkbox" aria-label={item.label} checked={(item.key==='members.invite'&&membersCanInvite)||(selected!=='member'&&permissions.includes(item.key))} disabled={!editable||(item.key==='members.invite'&&membersCanInvite)} onCheckedChange={()=>onToggle(item.key)}><Checkbox.Indicator><Check size={16}/></Checkbox.Indicator></Checkbox.Root>}</td><td>{item.key==='members.invite'&&membersCanInvite?'Да':'—'}</td></tr>)}</>;
}

/** Compatibility wrapper. Settings embeds the panel in its own single dialog root. */
export function GroupRolesDialog(props:GroupRolesDialogProps) {
 return <RadixDialog.Root open onOpenChange={open=>{if(!open)props.onClose();}}><RadixDialog.Portal><RadixDialog.Overlay className="group-roles-overlay"/><RadixDialog.Content className="group-roles-dialog"><header className="group-roles-header"><div><RadixDialog.Title>Роли и разрешения</RadixDialog.Title><RadixDialog.Description>{props.group.name}</RadixDialog.Description></div><RadixDialog.Close asChild><button className="gr-icon" aria-label="Закрыть"><X size={20}/></button></RadixDialog.Close></header><GroupRolesPanel {...props}/></RadixDialog.Content></RadixDialog.Portal></RadixDialog.Root>;
}
