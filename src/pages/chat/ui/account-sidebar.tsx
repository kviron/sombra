import {useState} from 'react';
import {LogOut, Pencil, Search, type LucideIcon} from 'lucide-react';
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
import {UserAvatar} from '@/shared/ui/user-avatar';
import type {User} from '@/shared/types';

/** Пункт меню настроек: какие разделы и иконки показать, решает страница. */
export type AccountMenuItem<T extends string = string> = {id: T; label: string; icon: LucideIcon};

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
    <button
     type="button"
     className="settings-identity"
     aria-label="Редактировать профиль"
     aria-controls="account-panel"
     onClick={onEditProfile}
    >
     <UserAvatar
      user={me ?? {id: name, name, avatar}}
      size="lg"
      presence={false}
      decorative
      decoration={me?.decorations?.avatar}
     />
     <span className="settings-identity-text">
      <strong title={name}>{name}</strong>
      <span className="settings-edit-profile">
       Редактировать профиль <Pencil size={12} />
      </span>
     </span>
    </button>
   </SidebarHeader>
   <label className="settings-search">
    <Search size={16} aria-hidden="true" />
    <input
     type="search"
     aria-label="Поиск по настройкам"
     placeholder="Поиск по настройкам"
     value={query}
     onChange={event => setQuery(event.target.value)}
    />
   </label>
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
      <SidebarMenuButton onClick={onLogout}>
       <LogOut />
       <span>Выйти из аккаунта</span>
      </SidebarMenuButton>
     </SidebarMenuItem>
    </SidebarMenu>
   </SidebarFooter>
  </Sidebar>
 );
}
