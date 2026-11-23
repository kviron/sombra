import type {ReactNode, Ref} from 'react';
import {X} from 'lucide-react';
import {Button} from '@/shared/ui/button';
import type {User} from '@/shared/types';
import type {AccountSection} from '../model/chat-panels';
import {AccountSidebar, type AccountMenuItem} from './account-sidebar';

import './settings-mira.css';

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
    className="account-modal dark settings-mira surface-matte"
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
      <div>
       <h1 id="account-settings-title">{sections.find(item => item.id === section)?.label}</h1>
       {section === 'profile' && <p className="settings-pane-description">Настройте, как вас видят собеседники.</p>}
      </div>
      <Button variant="ghost" size="icon-sm" title="Закрыть настройки" aria-label="Закрыть настройки" onClick={onClose}>
       <X />
      </Button>
     </header>
     <div id="account-panel" ref={panelRef}>
      {children}
     </div>
    </article>
   </section>
  </div>
 );
}
