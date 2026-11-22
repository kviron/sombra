import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Button} from '@/shared/ui/button';
import {AccountSettingsModal} from '@/app/account-settings-modal';
import {DiagnosticJournal,type DiagnosticEntry} from '@/app/diagnostic-journal';
import type {AccountSection} from '@/app/account-sidebar';
import '@/app/styles/index.css';
import '@/app/chat.css';
import '@/app/glass.css';
import '@/app/settings.css';
import '@/app/chat-extras.css';

const mode=new URLSearchParams(location.search).get('state');
const sample:DiagnosticEntry[]=[
  {time:new Date(2026,10,18,22,48,31).getTime()/1000,source:'desktop',operation:'state',category:'http_error',status:502},
  {time:new Date(2026,10,18,22,48,32).getTime()/1000,source:'desktop',operation:'voice_poll',category:'http_error',status:502},
];
let reads=0;
async function read() {
  reads++;
  if(mode==='loading')await new Promise(()=>{});
  if(mode==='error'&&reads===1||mode==='refresh-error'&&reads===2)throw new Error('Fixture only');
  return mode==='empty'||(mode==='refresh'&&reads>1)?[]:sample;
}
function Fixture() {
  const [open,setOpen]=useState(true);
  const [section,setSection]=useState<AccountSection>('journal');
  return <div className="app-surface chat-shell" style={{minHeight:'100vh'}}>
    {open?<AccountSettingsModal me={{id:'fixture',name:'Тестовый профиль'}} section={section} onSection={setSection} onLogout={()=>setOpen(false)} onClose={()=>setOpen(false)}>
      {section==='journal'?<DiagnosticJournal available={mode!=='unavailable'} read={read}/>:null}
    </AccountSettingsModal>:<Button onClick={()=>{setSection('journal');setOpen(true)}}>Открыть журнал</Button>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
