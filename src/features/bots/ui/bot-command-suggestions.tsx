import type {ChatState} from '@/shared/types';
import './bots.css';
import '@/shared/ui/menu-material.css';

export function BotCommandSuggestions({state,channel,group,draft,onSelect,disabled=false}:{state:ChatState;channel:string;group?:string;draft:string;onSelect:(value:string)=>void;disabled?:boolean}){
 if(disabled||!/^\/[a-zA-Z0-9_@-]*$/.test(draft))return null;
 const dialog=state.dialogs.find(d=>d.id===channel);
 const directBot=!group&&dialog?.members.length===2?dialog.members.find(id=>id!==state.me.id&&state.users.some(u=>u.id===id&&u.bot)):undefined;
 const bots=state.bots.filter(b=>b.enabled!==false&&(directBot?b.id===directBot:group?(b.groups?b.groups.includes(group)||b.channel===channel:b.group===group||b.channel===channel):b.channel===channel));
 const query=draft.slice(1).toLowerCase();
 const suggestions=bots.flatMap(bot=>(bot.commands||[]).map(command=>({bot,command,value:`/${command.command.replace(/^\//,'')}${!directBot&&bot.username?'@'+bot.username:''}`}))).filter(item=>item.value.slice(1).toLowerCase().startsWith(query)).slice(0,12);
 if(!suggestions.length)return null;
 return <section className="bot-command-suggestions sombra-menu-surface" data-slot="command-menu-content" aria-label="Команды ботов"><p>Команды ботов</p><ul>{suggestions.map(({bot,command,value})=><li key={`${bot.id}:${command.command}`}><button type="button" onClick={()=>onSelect(value+' ')}><strong>{value}</strong><span>{command.description}</span><small>{bot.name}</small></button></li>)}</ul></section>;
}
