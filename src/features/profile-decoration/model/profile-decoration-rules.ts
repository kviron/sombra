// Чистые правила выбора украшения профиля: без сети и без DOM, поэтому проверяются тестами.
import type {
 ProfileDecorationDoc,
 ProfileEffect,
 ProfileEffectAsset,
 ProfileEffectDraft,
 ProfileEffectTarget
} from '@/shared/types';

export type DecorationView = 'personal' | 'catalog' | 'create' | 'upload';

/** Вариант в диалоге: пресет, стандартный вид или запись каталога. */
export type DecorationChoice = {
 key: string;
 title: string;
 decoration: ProfileDecorationDoc | null;
 id?: string;
 asset?: ProfileEffectAsset;
};

export type EffectPage = {items: ProfileEffect[]; nextOffset: number | null};

/** Запись каталога становится выбором без потери ссылки на эффект. */
export function asChoice(item: ProfileEffect): DecorationChoice {
 return {key: `effect:${item.id}`, id: item.id, title: item.title, decoration: item.decoration, asset: item.asset};
}

/** Личное: свежие загрузки сверху, дальше страница каталога без повторов. */
export function personalEffects(
 recentUploads: ProfileEffect[],
 pageItems: ProfileEffect[],
 target: ProfileEffectTarget
): ProfileEffect[] {
 const fresh = recentUploads.filter(item => item.target === target);
 return [...fresh, ...pageItems.filter(item => !fresh.some(upload => upload.id === item.id))];
}

/** Следующая страница дополняет уже загруженное и не повторяет эффекты. */
export function appendEffectPage(previous: EffectPage, incoming: EffectPage): EffectPage {
 return {
  nextOffset: incoming.nextOffset,
  items: [...previous.items, ...incoming.items.filter(item => !previous.items.some(old => old.id === item.id))]
 };
}

/** Причина, по которой GIF не принимается; пустая строка — файл подходит. */
export function gifFileProblem(file: {size: number; type: string}, maxBytes: number): string {
 if (file.size > maxBytes) return 'GIF должен быть не больше 2 МиБ.';
 if (file.size < 6 || (file.type && file.type !== 'image/gif')) return 'Выберите файл GIF.';
 return '';
}

/** Подпись GIF в первых шести байтах: 87a и 89a — обе версии формата. */
export function isGifHeader(signature: string): boolean {
 return /^GIF8[79]a$/.test(signature);
}

/** Результат генерации пригоден, только если украшение принимает движок. */
export function draftResult(
 draft: ProfileEffectDraft | undefined,
 accepted: (decoration: ProfileDecorationDoc) => boolean
): ProfileEffectDraft['result'] | undefined {
 if (draft?.status !== 'ready' || !draft.result) return undefined;
 return accepted(draft.result.decoration) ? draft.result : undefined;
}

export function isDraftPending(draft: ProfileEffectDraft | undefined): boolean {
 return draft?.status === 'queued' || draft?.status === 'running';
}

/** Подпись под карточкой: чем именно является эффект. */
export function effectKind(item: DecorationChoice): string {
 return item.asset ? 'GIF-анимация' : item.decoration ? 'Анимированный эффект' : 'Стандартный вид';
}

/** Текущий эффект: идентификатор записи важнее совпадения документа. */
export function isCurrentEffect(
 item: DecorationChoice,
 currentRef: string | undefined,
 currentDoc: ProfileDecorationDoc | null,
 same: (left: ProfileDecorationDoc | null, right: ProfileDecorationDoc | null) => boolean
): boolean {
 return item.id ? item.id === currentRef : !currentRef && same(item.decoration, currentDoc);
}

/** Локальные варианты диалога: пресеты, «без эффекта» и при необходимости текущий документ. */
export function localChoices({
 view,
 target,
 presets,
 currentDoc,
 currentRef,
 same
}: {
 view: DecorationView;
 target: ProfileEffectTarget;
 presets: DecorationChoice[];
 currentDoc: ProfileDecorationDoc | null;
 currentRef: string | undefined;
 same: (left: ProfileDecorationDoc | null, right: ProfileDecorationDoc | null) => boolean;
}): DecorationChoice[] {
 if (view === 'catalog') return [];
 const none: DecorationChoice = {
  key: 'none',
  title: target === 'avatar' ? 'Без рамки' : 'Без эффекта',
  decoration: null
 };
 const options = target === 'avatar' ? [none, ...presets] : [...presets, none];
 const current = (item: DecorationChoice) => isCurrentEffect(item, currentRef, currentDoc, same);
 if (view === 'personal' && currentDoc && !currentRef && !presets.some(current))
  options.splice(1, 0, {key: 'current', title: 'Текущий эффект', decoration: currentDoc});
 return options;
}
