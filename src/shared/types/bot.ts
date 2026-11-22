/** Настройки модели бота: app/BOT-MODEL-SETTINGS.md. */
export type BotReasoning = '' | 'low' | 'medium' | 'high';
export type BotCommand = {command:string;description:string};
/** Безопасная проекция bot.settings (сырой settings сервер не отдаёт); revision независима от settings_revision профиля. `models` — необязательный каталог, который публикует провайдер/плагин, backend его не хранит. */
export type BotModelSettings = {model:string;reasoning:BotReasoning;revision:number;modelDefault:boolean;reasoningDefault:boolean;models?:string[]};
export type Bot = {id:string;name:string;username?:string;channel?:string;group?:string;groups?:string[];owner:string;commands?:BotCommand[];privacy?:string|boolean;last_seen?:number;enabled?:boolean;transportVersion?:number;managementVersion?:number;modelSettings?:BotModelSettings};
