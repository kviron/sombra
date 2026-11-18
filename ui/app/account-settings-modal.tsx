import type {ReactNode,Ref} from 'react';
import {X} from 'lucide-react';
import {Button} from '@/shared/ui/button';
import type {User} from '@/shared/api/backend';
import {AccountSidebar,accountSections,type AccountSection} from './account-sidebar';

export function AccountSettingsModal({me,section,onSection,onLogout,onClose,panelRef,children}:{me?:User;section:AccountSection;onSection:(section:AccountSection)=>void;onLogout:()=>void;onClose:()=>void;panelRef?:Ref<HTMLDivElement>;children:ReactNode}) {
  return <div className="modal-backdrop" onClick={onClose}><section role="dialog" aria-modal="true" aria-label="Учётная запись" className="account-modal dark" onClick={e=>e.stopPropagation()}>
    <AccountSidebar me={me} avatar={me?.avatar} name={me?.name||''} section={section} onSection={onSection} onLogout={onLogout}/>
    <article><header><span>{accountSections.find(item=>item.id===section)?.label}</span><Button variant="ghost" size="icon-sm" title="Закрыть настройки" aria-label="Закрыть настройки" onClick={onClose}><X/></Button></header>
      <div id="account-panel" ref={panelRef}>{children}</div>
    </article>
  </section></div>;
}
