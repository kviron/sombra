import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {useStore} from 'zustand';
import type {ChatState} from '@/shared/types';
import {createBotTypingClock} from './bot-typing';
import {
 activeEntries,
 botIdentity,
 earliestUntil,
 expiryDelay,
 followsActivity,
 imageActivityLabel,
 imageDelivered,
 isImageActivity,
 readActivity,
 typingAnnouncement,
 typingKeys,
 typingStage
} from './bot-typing-rules';

type Options = {state: ChatState; channel: string};

/**
 * Такт одного индикатора: окно истекает без нового опроса, поэтому индикатор держит
 * собственный таймер и собственный отсчёт наблюдения.
 */
function useTypingClock(state: ChatState, channel: string) {
 const [clock] = useState(createBotTypingClock);
 const {now, observedStart} = useStore(clock.store);
 const keys = typingKeys(state);
 const earliest = earliestUntil(state, channel);
 const {tick} = clock.actions;

 useEffect(() => {
  if (earliest === undefined) return;
  // Уже прошедшее окно не взводит таймер: строка всё равно не показывается, часы не крутятся.
  const delay = expiryDelay(earliest, Date.now());
  if (delay === undefined) return;
  const timer = setTimeout(() => tick(Date.now() / 1000), delay);
  return () => clearTimeout(timer);
 }, [keys, earliest, now, tick]);

 return {clock, now, observedStart};
}

/**
 * Строка активности над полем ввода: имя бота, этап, подробность и объявление.
 * Компонент только показывает то, что вернула модель.
 */
export function useBotTyping({state, channel}: Options) {
 const {clock, now, observedStart} = useTypingClock(state, channel);
 const entry = activeEntries(state, channel, now)[0];
 const key = entry ? `${channel}:${entry.bot}` : '';
 const {restart} = clock.actions;

 // Новая непрерывная активность начинает отсчёт заново: время прошлого бота не переезжает.
 useEffect(() => {
  restart(key ? Date.now() : 0);
 }, [key, restart]);

 if (!entry) return undefined;
 const activity = readActivity(entry);
 const {name, user} = botIdentity(state, entry.bot);
 return {
  bot: entry.bot,
  name,
  user,
  detail: activity.detail,
  stage: typingStage(activity),
  startedAt: activity.startedAt ?? (observedStart || undefined),
  announcement: typingAnnouncement(name, activity.stage)
 };
}

/**
 * Карточка «изображение ещё не пришло»: живёт, пока жива запись активности, и исчезает,
 * как только бот прислал картинку. Транскрипт следует за карточкой только если читатель
 * был внизу: того, кто читает историю выше, модель не тянет вниз.
 */
export function useBotImageActivity({state, channel}: Options) {
 const {now} = useTypingClock(state, channel);
 const entry = activeEntries(state, channel, now).find(isImageActivity);
 const root = useRef<HTMLDivElement>(null);

 useLayoutEffect(() => {
  const element = root.current;
  if (!entry || !element) return;
  let scroller: HTMLElement | null = element.parentElement;
  while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
  if (!scroller) return;
  if (followsActivity(scroller, element.offsetHeight)) scroller.scrollTop = scroller.scrollHeight;
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [entry?.bot, entry?.until]);

 if (!entry) return undefined;
 if (imageDelivered(state, entry)) return undefined;
 const activity = readActivity(entry);
 const {name, user} = botIdentity(state, entry.bot);
 return {bot: entry.bot, root, name, user, label: imageActivityLabel(activity)};
}
