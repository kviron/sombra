import {useState} from 'react';
import {
 Search,
 Mic,
 UserRound,
 ShieldCheck,
 Monitor,
 RefreshCw,
 LogOut,
 Pencil,
 Sticker,
 Bell,
 HardDrive,
 BookOpen
} from 'lucide-react';
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

export type AccountSection =
 'profile' | 'security' | 'sessions' | 'voice' | 'updates' | 'stickers' | 'notifications' | 'storage' | 'journal';
export const accountSections = [
 {id: 'updates' as const, label: 'Обновления', icon: RefreshCw},
 {id: 'voice' as const, label: 'Голос и видео', icon: Mic},
 {id: 'notifications' as const, label: 'Уведомления', icon: Bell},
 {id: 'storage' as const, label: 'Данные и память', icon: HardDrive},
 {id: 'profile' as const, label: 'Учётная запись', icon: UserRound},
 {id: 'security' as const, label: 'Пароль и безопасность', icon: ShieldCheck},
 {id: 'sessions' as const, label: 'Активные сеансы', icon: Monitor},
 {id: 'stickers' as const, label: 'Стикеры', icon: Sticker},
 {id: 'journal' as const, label: 'Журнал', icon: BookOpen}
];
export function AccountSidebar({
 me,
 name,
 avatar,
 section,
 onSection,
 onLogout
}: {
 me?: User;
 name: string;
 avatar?: string;
 section: AccountSection;
 onSection: (section: AccountSection) => void;
 onLogout: () => void;
}) {
 const [query, setQuery] = useState('');
 const filtered = accountSections.filter(item =>
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
     onClick={() => onSection('profile')}
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
