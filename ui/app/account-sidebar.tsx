import {Mic,UserRound,ShieldCheck,Monitor,RefreshCw,LogOut,Pencil,Sticker} from 'lucide-react';
import {Sidebar,SidebarHeader,SidebarContent,SidebarFooter,SidebarMenu,SidebarMenuItem,SidebarMenuButton} from '@/shared/ui/sidebar';
import {Separator} from '@/shared/ui/separator';

export type AccountSection='profile'|'security'|'sessions'|'voice'|'updates'|'stickers';
export const accountSections=[
  {id:'updates' as const,label:'Обновления',icon:RefreshCw},
  {id:'voice' as const,label:'Голос и видео',icon:Mic},
  {id:'profile' as const,label:'Учётная запись',icon:UserRound},
  {id:'security' as const,label:'Пароль и безопасность',icon:ShieldCheck},
  {id:'sessions' as const,label:'Активные сеансы',icon:Monitor},
  {id:'stickers' as const,label:'Стикеры',icon:Sticker},
];
export function AccountSidebar({name,avatar,section,onSection,onLogout}:{name:string;avatar?:string;section:AccountSection;onSection:(section:AccountSection)=>void;onLogout:()=>void}) {
  return <Sidebar className="settings-sidebar">
    <SidebarHeader><button type="button" className="settings-identity" aria-label="Редактировать профиль" aria-controls="account-panel" onClick={()=>onSection('profile')}><span className="avatar" aria-hidden="true">{avatar?<img src={avatar} alt=""/>:name[0]}</span><span className="settings-identity-text"><strong title={name}>{name}</strong><span className="settings-edit-profile">Редактировать профиль <Pencil size={12}/></span></span></button></SidebarHeader>
    <SidebarContent><nav aria-label="Настройки учётной записи"><SidebarMenu>{accountSections.map(({id,label,icon:Icon})=><SidebarMenuItem key={id}><SidebarMenuButton isActive={section===id} aria-current={section===id?'page':undefined} aria-controls="account-panel" onClick={()=>onSection(id)}><Icon/><span>{label}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></nav></SidebarContent>
    <SidebarFooter><Separator/><SidebarMenu><SidebarMenuItem><SidebarMenuButton onClick={onLogout}><LogOut/><span>Выйти из аккаунта</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarFooter>
  </Sidebar>;
}

