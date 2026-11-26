import {TooltipLabel} from '@/shared/ui/tooltip';
import {useState} from 'react';
import {LogOut, Pencil, Search} from 'lucide-react';
import {
 Sidebar,
 SidebarHeader,
 SidebarContent,
 SidebarFooter,
 SidebarMenu,
 SidebarMenuItem,
 SidebarMenuButton
} from '@/shared/ui/sidebar';
import {Separator} from '@/shared/ui/separator';
import {Input} from '@/shared/ui/input';
import {UserAvatar} from '@/shared/ui/user-avatar';
import type {User} from '@/shared/types';
import type {AccountMenuItem} from '../model/sections';

/** Меню окна настроек: показывает разделы, которые ему передали, и фильтрует их поиском. */
export function AccountSidebar<T extends string>({
 sections,
 me,
 name,
 avatar,
 section,
 onSection,
 onEditProfile,
 onLogout
}: {
 sections: readonly AccountMenuItem<T>[];
 me?: User;
 name: string;
 avatar?: string;
 section: T;
 onSection: (section: T) => void;
 onEditProfile: () => void;
 onLogout: () => void;
}) {
 const [query, setQuery] = useState('');
 const filtered = sections.filter(item =>
  item.label.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'))
 );
 return (
  <Sidebar className="settings-sidebar">
   <SidebarHeader>
    <SidebarMenu>
     <SidebarMenuItem>
      <SidebarMenuButton
       className="settings-identity"
       aria-label="Редактировать профиль"
       aria-controls="account-panel"
       onClick={onEditProfile}
      >
       <UserAvatar
        user={me ?? {id: name, name, avatar}}
        size="md"
        presence={false}
        decorative
        decoration={me?.decorations?.avatar}
       />
       <span className="settings-identity-text">
        <TooltipLabel content={name}>
         <strong>{name}</strong>
        </TooltipLabel>
        <span className="settings-edit-profile">Редактировать профиль</span>
       </span>
       <Pencil aria-hidden="true" className="ml-auto" />
      </SidebarMenuButton>
     </SidebarMenuItem>
    </SidebarMenu>
   </SidebarHeader>
   <div className="relative mb-2">
    <Search
     size={16}
     aria-hidden="true"
     className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
    />
    <Input
     className="pl-9"
     type="search"
     aria-label="Поиск по настройкам"
     placeholder="Поиск по настройкам"
     value={query}
     onChange={event => setQuery(event.target.value)}
    />
   </div>
   <SidebarContent>
    <nav aria-label="Настройки учётной записи">
     {!filtered.length && (
      <p className="settings-search-empty" role="status">
       Ничего не найдено
      </p>
     )}
     <SidebarMenu>
      {filtered.map(({id, label, icon: Icon}) => (
       <SidebarMenuItem key={id}>
        <SidebarMenuButton
         size="lg"
         isActive={section === id}
         aria-current={section === id ? 'page' : undefined}
         aria-controls="account-panel"
         onClick={() => onSection(id)}
        >
         <Icon />
         <span>{label}</span>
        </SidebarMenuButton>
       </SidebarMenuItem>
      ))}
     </SidebarMenu>
    </nav>
   </SidebarContent>
   <SidebarFooter>
    <Separator />
    <SidebarMenu>
     <SidebarMenuItem>
      <SidebarMenuButton size="lg" onClick={onLogout}>
       <LogOut />
       <span>Выйти из аккаунта</span>
      </SidebarMenuButton>
     </SidebarMenuItem>
    </SidebarMenu>
   </SidebarFooter>
  </Sidebar>
 );
}
