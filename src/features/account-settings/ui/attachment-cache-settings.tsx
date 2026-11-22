import {useEffect,useRef,useState} from 'react';
import {HardDrive,RefreshCw,Trash2,LoaderCircle} from 'lucide-react';
import {attachmentCacheService,type CacheInfo} from '@/shared/api';
import {Button} from '@/shared/ui/button';
import {Select} from '@/shared/ui/select';
import './attachment-cache-settings.css';
import './account-approved.css';
const options=[{value:'0',label:'Не сохранять кэш'},{value:'256',label:'256 МиБ'},{value:'512',label:'512 МиБ'},{value:'1024',label:'1 ГиБ'},{value:'2048',label:'2 ГиБ'},{value:'4096',label:'4 ГиБ'}];
function size(bytes:number){return bytes>=1024**3?`${(bytes/1024**3).toFixed(2)} ГиБ`:bytes>=1024**2?`${(bytes/1024**2).toFixed(1)} МиБ`:`${Math.ceil(bytes/1024)} КиБ`}
export function AttachmentCacheSettings({ready,onChanged}:{ready:boolean;onChanged:()=>Promise<unknown>}){
 const [info,setInfo]=useState<CacheInfo|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[confirm,setConfirm]=useState(false);
 const mounted=useRef(true),pending=useRef(false),request=useRef(0);
 async function load(){
  if(!ready||pending.current)return;
  const sequence=++request.current;
  try{const next=await attachmentCacheService.info();if(mounted.current&&sequence===request.current){setInfo(next);setError('')}}
  catch(reason){if(mounted.current&&sequence===request.current)setError(reason instanceof Error?reason.message:'Не удалось прочитать кэш.')}
 }
 useEffect(()=>{mounted.current=true;void load();const timer=setInterval(()=>void load(),5000);return()=>{mounted.current=false;request.current++;clearInterval(timer)}},[ready]);
 async function change(action:()=>Promise<CacheInfo>,message:string){
  if(pending.current||!ready)return;
  pending.current=true;request.current++;setBusy(true);setError('');setNotice('');
  try{const next=await action();if(mounted.current){setInfo(next);setConfirm(false);setNotice(message)}await onChanged().catch(()=>{})}
  catch(reason){if(mounted.current)setError(reason instanceof Error?reason.message:'Не удалось изменить кэш.')}
  finally{pending.current=false;if(mounted.current)setBusy(false)}
 }
 return <section className="attachment-cache-settings approved-cache" aria-labelledby="cache-settings-heading" aria-busy={busy}>
  <h2 id="cache-settings-heading"><HardDrive size={22}/>Данные и память</h2>
  <p>Уже загруженные вложения сохраняются на этом устройстве, чтобы не скачивать их повторно.</p>
<div className="approved-cache-ledger"><h3>Локальное хранение</h3>
  <div className="cache-usage"><div><span>Кэш текущего аккаунта</span><small>{info?`${info.files} файлов · ${info.enabled?'кэш включён':'кэш выключен'}`:'Получаем сведения о хранилище'}</small></div><div className="approved-cache-actions"><strong>{info?size(info.bytes):'Загружаем…'}</strong><Button type="button" variant="outline" title="Обновить сведения о кэше" aria-label="Обновить сведения о кэше" disabled={busy||!ready} onClick={()=>void load()}><RefreshCw size={17}/>Обновить сведения</Button></div></div>
<div className="approved-cache-row"><div><h3>Ограничение места</h3>  <p className="cache-hint">Лимит относится к этому аккаунту на этом устройстве. При заполнении удаляются давно не использованные копии, а не сообщения в чате.</p></div>  <div className="cache-limit"><label htmlFor="attachment-cache-limit">Лимит кэша</label><Select id="attachment-cache-limit" label="Лимит кэша вложений" value={String(info?.limitMiB??1024)} options={options} disabled={busy||!ready||!info} onValueChange={value=>void change(()=>attachmentCacheService.setLimit(Number(value)),Number(value)?'Лимит кэша сохранён.':'Кэш выключен и очищен.')}/></div></div>
<div className="approved-cache-row"><div><h3>Очистка копий</h3><p>Сообщения и файлы в «Загрузках» останутся на месте.</p></div>  <div className="cache-clear">{confirm?<><p>Очистить локальные копии этого аккаунта? Файлы, уже очищенные на сервере, после этого не получится открыть из кэша.</p><div><Button type="button" variant="destructive" disabled={busy} onClick={()=>void change(attachmentCacheService.clear,'Локальный кэш очищен.')}>Да, очистить кэш</Button><Button type="button" variant="outline" disabled={busy} onClick={()=>setConfirm(false)}>Отмена</Button></div></>:<Button type="button" variant="outline" disabled={busy||!ready||!info||!info.files} onClick={()=>setConfirm(true)}><Trash2 size={16}/>Очистить кэш аккаунта</Button>}</div></div></div>
  <div className="cache-notes"><h3>Как это работает</h3><ul><li>Сохраняются только просмотренные фото и загруженные файлы — не вся история автоматически.</li><li>Если срок хранения файла на сервере истёк, доступная локальная копия откроется с отметкой «Локальная копия».</li><li>Кэш не восстанавливает удалённые сообщения и не даёт доступа к группам, из которых вас исключили. Для проверки доступа нужна связь с сервером.</li><li>Аккаунты разделены. Очистка не затрагивает файлы, которые вы отдельно сохранили в «Загрузки», и копии других пользователей.</li><li>Открытые предпросмотры могут оставаться в памяти. После повторного открытия доступный файл может снова попасть в кэш.</li></ul></div>
  {busy&&<p className="cache-operation" role="status"><LoaderCircle size={15} className="animate-spin"/>Обновляем хранилище…</p>}
  {notice&&<p className="cache-notice" role="status">{notice}</p>}{error&&<p className="cache-error" role="alert">{error}</p>}
 </section>;
}
