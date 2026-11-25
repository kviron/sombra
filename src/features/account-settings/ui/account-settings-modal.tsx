import type {ReactNode, Ref} from 'react';
import {LogOut, X} from 'lucide-react';
import {Button} from '@/shared/ui/button';
import {OptionsSelect} from '@/shared/ui/select';
import type {User} from '@/shared/types';
import type {AccountMenuItem, AccountSection} from '../model/sections';
import {AccountSidebar} from './account-sidebar';

/**
 * Окно настроек аккаунта: оболочка без бизнес-логики — подложка, сайдбар разделов
 * и место под содержимое. Содержимое раздела приходит слотом из страницы,
 * которая связывает этот срез с фичами разделов.
 */
export function AccountSettingsModal({
 sections,
 me,
 section,
 onSection,
 onEditProfile,
 onLogout,
 onClose,
 panelRef,
 children
}: {
 sections: readonly AccountMenuItem<AccountSection>[];
 me?: User;
 section: AccountSection;
 onSection: (section: AccountSection) => void;
 onEditProfile: () => void;
 onLogout: () => void;
 onClose: () => void;
 panelRef?: Ref<HTMLDivElement>;
 children: ReactNode;
}) {
 return (
  <div className="modal-backdrop settings-backdrop" onClick={onClose}>
   <section
    role="dialog"
    aria-modal="true"
    aria-labelledby="account-settings-title"
    className="account-modal settings-mira bg-background border"
    data-section={section}
    onClick={e => e.stopPropagation()}
   >
    <AccountSidebar
     sections={sections}
     me={me}
     avatar={me?.avatar}
     name={me?.name || ''}
     section={section}
     onSection={onSection}
     onEditProfile={onEditProfile}
     onLogout={onLogout}
    />
    <article>
     <header>
      <h1 id="account-settings-title">{sections.find(item => item.id === section)?.label}</h1>
      <Button variant="ghost" size="icon-sm" title="Закрыть настройки" aria-label="Закрыть настройки" onClick={onClose}>
       <X />
      </Button>
     </header>
     <nav className="account-settings-compact" aria-label="Разделы настроек">
      <OptionsSelect
       label="Выбрать раздел настроек"
       value={section}
       options={sections.map(item => ({value: item.id, label: item.label}))}
       onValueChange={value => {
        const item = sections.find(item => item.id === value);
        if (item) onSection(item.id);
       }}
      />
      <Button type="button" variant="ghost" size="icon" aria-label="Выйти из аккаунта" onClick={onLogout}>
       <LogOut />
      </Button>
     </nav>
     <div id="account-panel" ref={panelRef}>
      {children}
     </div>
    </article>
   </section>
  </div>
 );
}
