// Правила настроек группы: черновик, права на правку и тело запроса на сохранение.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 avatarPermissionsChanged,
 canChangeAvatar,
 canSaveGroup,
 groupDraft,
 groupNameValid,
 groupSaveProblem,
 groupUpdatePayload,
 permissionsChanged
} from './group-settings-rules.ts';

const group = {
 id: 'g1',
 name: 'Команда',
 owner: 'me',
 invite: 'code',
 members: ['me', 'a'],
 channels: [],
 avatar: 'старый.png'
};

const fullRights = {member: true, rename: true, avatarAllowed: true};

test('черновик без правок повторяет сохранённую группу', () => {
 const draft = groupDraft(group, undefined, undefined);
 assert.equal(draft.name, 'Команда');
 assert.equal(draft.avatar, 'старый.png');
 assert.equal(draft.nameChanged, false);
 assert.equal(draft.avatarChanged, false);
});

test('пробелы в имени не считаются изменением, а новый аватар — считается', () => {
 assert.equal(groupDraft(group, ' Команда ', undefined).nameChanged, false);
 assert.equal(groupDraft(group, undefined, '').avatarChanged, true);
 assert.equal(groupDraft({...group, avatar: undefined}, undefined, undefined).avatar, '');
});

test('сохранить можно только изменённый черновик с допустимым именем', () => {
 assert.equal(canSaveGroup(groupDraft(group, undefined, undefined), fullRights), false, 'ничего не изменено');
 assert.equal(canSaveGroup(groupDraft(group, 'Новое', undefined), fullRights), true);
 assert.equal(canSaveGroup(groupDraft(group, '   ', undefined), fullRights), false, 'пустое имя');
 assert.equal(groupNameValid('я'.repeat(60)), true);
 assert.equal(groupNameValid('я'.repeat(61)), false);
});

test('без права на название или аватар сохранение запрещено', () => {
 assert.equal(canSaveGroup(groupDraft(group, 'Новое', undefined), {...fullRights, rename: false}), false);
 assert.equal(canSaveGroup(groupDraft(group, undefined, ''), {...fullRights, avatarAllowed: false}), false);
});

test('причина отказа объясняет изменение прав, а не пустое имя', () => {
 assert.equal(groupSaveProblem(groupDraft(group, undefined, undefined), fullRights), '');
 assert.equal(
  groupSaveProblem(groupDraft(group, 'Новое', undefined), {...fullRights, rename: false}),
  permissionsChanged
 );
 assert.equal(groupSaveProblem(groupDraft(group, undefined, ''), fullRights), '');
 assert.equal(
  groupSaveProblem(groupDraft(group, undefined, ''), {...fullRights, avatarAllowed: false}),
  permissionsChanged
 );
 assert.equal(
  groupSaveProblem(groupDraft(group, undefined, undefined), {...fullRights, member: false}),
  permissionsChanged
 );
});

test('в запрос уходят только изменённые поля, имя обрезается', () => {
 assert.deepEqual(groupUpdatePayload('g1', groupDraft(group, 'Новое ', undefined)), {group: 'g1', name: 'Новое'});
 assert.deepEqual(groupUpdatePayload('g1', groupDraft(group, undefined, '')), {group: 'g1', avatar: ''});
 assert.deepEqual(groupUpdatePayload('g1', groupDraft(group, undefined, undefined)), {group: 'g1'});
});

test('аватар меняет только участник с правом на аватар', () => {
 assert.equal(canChangeAvatar(fullRights), true);
 assert.equal(canChangeAvatar({...fullRights, avatarAllowed: false}), false);
 assert.equal(canChangeAvatar({...fullRights, member: false}), false);
 assert.equal(avatarPermissionsChanged, 'Права изменились. Изменение аватара недоступно.');
});
