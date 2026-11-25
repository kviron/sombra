import {TooltipLabel} from '@/shared/ui/tooltip';
import {ChevronDown, LogOut, MessageCircle, Plus, Settings, ShieldCheck, UserPlus} from 'lucide-react';
import {Button} from '@/shared/ui/button';
import {
 DropdownMenu,
 DropdownMenuContent,
 DropdownMenuGroup,
 DropdownMenuItem,
 DropdownMenuSeparator,
 DropdownMenuTrigger
} from '@/shared/ui/dropdown-menu';
import type {ChatNavigationModel} from '../model/use-chat-navigation';
import type {ChatPanelsModel} from '../model/use-chat-panels';

export function ChatGroupHeader({
 nav,
 panels,
 userId
}: {
 nav: ChatNavigationModel;
 panels: ChatPanelsModel;
 userId?: string;
}) {
 const {group} = nav;
 const canInvite = !!group && (nav.permits(group, 'members.invite') || nav.permits(group, 'invite.rotate'));
 const canCreateChannel = nav.permits(group, 'channels.create_text') || nav.permits(group, 'channels.create_voice');
 const canLeave = !!userId && group?.rolesRevision !== undefined && group.owner !== userId;
 const invite = () => panels.actions.openModal('invite');

 return (
  <header className="group-header sidebar-header flex shrink-0 items-center gap-1 border-b px-2.5">
   {group ? (
    <DropdownMenu modal={false}>
     <DropdownMenuTrigger asChild>
      <TooltipLabel content={group.name}>
       <Button
        type="button"
        variant="ghost"
        size="sm"
        className="group mr-auto min-w-0 justify-start"
        aria-label={`Меню группы «${group.name}»`}
       >
        <span className="truncate">{group.name}</span>
        <ChevronDown data-icon="inline-end" className="transition-transform group-data-[state=open]:rotate-180" />
       </Button>
      </TooltipLabel>
     </DropdownMenuTrigger>
     <DropdownMenuContent align="start" sideOffset={6} className="w-56 max-w-[calc(100vw-24px)]">
      <DropdownMenuGroup>
       {canInvite && (
        <DropdownMenuItem onSelect={invite}>
         <UserPlus /> Пригласить участников
        </DropdownMenuItem>
       )}
       {nav.canEdit(group) && (
        <DropdownMenuItem onSelect={() => panels.actions.editGroup(group)}>
         <Settings /> Настройки группы
        </DropdownMenuItem>
       )}
       <DropdownMenuItem onSelect={() => panels.actions.openRoles(group.id, 'roles')}>
        <ShieldCheck /> Роли и права
       </DropdownMenuItem>
       {canCreateChannel && (
        <DropdownMenuItem onSelect={() => panels.actions.openModal('channel')}>
         <Plus /> Создать канал
        </DropdownMenuItem>
       )}
       <DropdownMenuItem onSelect={() => panels.actions.openModal('dialog')}>
        <MessageCircle /> Новый диалог
       </DropdownMenuItem>
      </DropdownMenuGroup>
      {canLeave && (
       <>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
         <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => void nav.actions.leaveGroup(group)}
         >
          <LogOut /> Покинуть группу
         </DropdownMenuItem>
        </DropdownMenuGroup>
       </>
      )}
     </DropdownMenuContent>
    </DropdownMenu>
   ) : (
    <strong className="mr-auto truncate px-2">Ваши группы</strong>
   )}
   {canInvite && (
    <Button type="button" variant="ghost" size="icon-sm" aria-label="Пригласить участников" onClick={invite}>
     <UserPlus />
    </Button>
   )}
   {!group && (
    <Button
     type="button"
     variant="ghost"
     size="icon-sm"
     aria-label="Новый диалог"
     onClick={() => panels.actions.openModal('dialog')}
    >
     <Plus />
    </Button>
   )}
  </header>
 );
}
