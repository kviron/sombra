import {useEffect,useState} from 'react';
import {invoke,isTauri} from '@tauri-apps/api/core';
import {Badge} from '@/shared/ui/badge';
import {Button} from '@/shared/ui/button';
import './diagnostic-journal.css';

export type DiagnosticEntry={time:number;source:'desktop';operation:string;category:string;status:number|null};
const categories:Record<string,string>={transport:'Ошибка соединения',timeout:'Время ожидания истекло',invalid_response:'Некорректный ответ',session_storage:'Ошибка хранения сеанса',http_error:'Ошибка HTTP',js_error:'Ошибка интерфейса',unhandled_rejection:'Ошибка интерфейса',device_error:'Ошибка устройства',device_permission:'Нет доступа к устройству',autoplay_blocked:'Автовоспроизведение заблокировано',playback_error:'Ошибка воспроизведения'};
const titles:Record<string,string>={voice_poll:'Не удалось обновить состояние голосовой комнаты',state:'Не удалось загрузить состояние приложения'};
const clock=new Intl.DateTimeFormat('ru',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
const fullDate=new Intl.DateTimeFormat('ru',{dateStyle:'medium',timeStyle:'medium'});
const readEntries=()=>invoke<DiagnosticEntry[]>('read_local_diagnostics');

type JournalState={phase:'loading'|'ready'|'failed';entries:DiagnosticEntry[]|null};
export function DiagnosticJournal({read=readEntries,available=isTauri()}:{read?:()=>Promise<DiagnosticEntry[]>;available?:boolean}) {
  const [request,setRequest]=useState(0);
  const [state,setState]=useState<JournalState>({phase:'loading',entries:null});
  useEffect(()=>{
    if(!available)return;
    let active=true;
    void Promise.resolve().then(read).then(entries=>{
      if(active)setState({phase:'ready',entries:[...entries].reverse()});
    },()=>{
      if(active)setState(previous=>({...previous,phase:'failed'}));
    });
    return()=>{active=false};
  },[available,read,request]);
  const {phase,entries}=state;
  const loading=available&&phase==='loading';
  const refresh=()=>{
    setState(previous=>({...previous,phase:'loading'}));
    setRequest(previous=>previous+1);
  };
  return <section className="diagnostic-journal" aria-label="Журнал диагностики">
    <div className="journal-heading"><div><h2>Журнал</h2><p>Диагностика Sombra за последние 48 часов</p></div><Button type="button" variant="outline" disabled={!available||loading} onClick={refresh}>Обновить</Button></div>
    <div className="journal-summary" role="status"><strong className="journal-total">{entries?.length??'—'}</strong><div><strong>Ошибки</strong><p>В сохранённых записях</p></div></div>
    <h3>Последние ошибки</h3>
    {!available?<p role="status">Журнал доступен только в настольном приложении.</p>:loading?<p role="status">Загрузка журнала…</p>:phase==='failed'?<p role="alert">Не удалось прочитать журнал. Нажмите «Обновить», чтобы повторить попытку.{entries?' Ниже показаны ранее загруженные данные.':''}</p>:entries?.length===0?<p role="status">За последние 48 часов ошибок не сохранено.</p>:null}
    {!!entries?.length&&<ul className="journal-entries">{entries.map(({time,operation,category,status},index)=>{
      const date=new Date(time*1000);
      const valid=Number.isFinite(date.getTime());
      const label=categories[category]??'Ошибка приложения';
      return <li key={`${time}-${operation}-${index}`}><div className="journal-entry-heading"><strong>{titles[operation]??label}</strong>{valid&&<time dateTime={date.toISOString()} title={fullDate.format(date)} aria-label={fullDate.format(date)}>{clock.format(date)}</time>}</div><div className="journal-entry-details"><span>Приложение</span><Badge variant="outline">{status===null?label:`HTTP ${status}`}</Badge><code>{operation}</code></div></li>;
    })}</ul>}
    <footer>Звук, сообщения и токены не сохраняются.</footer>
  </section>;
}
