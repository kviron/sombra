// Правила ролей группы: права, назначение, защита ролей по умолчанию и тексты конфликтов.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 canAssignRole,
 canKick,
 canTouchRole,
 defaultRoleDraft,
 editableRole,
 groupMembers,
 isConflictError,
 policySupported,
 roleChoices,
 rolesOwner,
 rolesSupported,
 togglePermission
} from './group-roles-rules.ts';

const roles = [
 {id: 'owner', name: 'Владелец', permissions: []},
 {id: 'member', name: 'Участник', permissions: []},
 {id: 'moder', name: 'Модератор', permissions: ['messages.delete_any']}
];

const group = {
 id: 'g1',
 name: 'Группа',
 owner: 'me',
 invite: 'code',
 members: ['me', 'a', 'b'],
 avatar: '',
 channels: [],
 roles,
 membersCanInvite: true,
 rolesRevision: 4
};

const chat = {
 me: {id: 'me', name: 'Я', bio: '', created_at: 0},
 email: 'me@example.com',
 users: [
  {id: 'me', name: 'Я', bio: '', created_at: 0},
  {id: 'a', name: 'Аня', bio: '', created_at: 0},
  {id: 'b', name: 'Бот', bio: '', created_at: 0, bot: true}
 ],
 groups: [group],
 dialogs: [],
 messages: [],
 stickers: [],
 friends: [],
 bots: []
};

test('поддержка ролей и политики приглашений зависит от снимка группы', () => {
 assert.equal(rolesSupported(group), true);
 assert.equal(rolesSupported({...group, roles: undefined}), false);
 assert.equal(policySupported(group), true);
 assert.equal(policySupported({...group, membersCanInvite: undefined}), false);
});

test('владельцем считается только живой снимок группы', () => {
 assert.equal(rolesOwner(group, chat), true);
 assert.equal(rolesOwner(undefined, chat), false);
 assert.equal(rolesOwner({...group, owner: 'a'}, chat), false);
});

test('править можно только свою роль, не владельца и не участника', () => {
 assert.equal(editableRole('moder', roles[2], true), true);
 assert.equal(editableRole('member', roles[1], true), false);
 assert.equal(editableRole('owner', roles[0], true), false);
 assert.equal(editableRole('__new', undefined, true), true);
 assert.equal(editableRole('moder', roles[2], false), false);
});

test('участники и варианты ролей приходят из снимка', () => {
 assert.deepEqual(
  groupMembers(chat, group).map(user => user.id),
  ['me', 'a', 'b']
 );
 assert.deepEqual(
  roleChoices(roles).map(item => item.value),
  ['owner', 'member', 'moder']
 );
});

test('черновик роли заполняется из выбранной роли', () => {
 assert.deepEqual(defaultRoleDraft(roles[2], 'Участник'), {name: 'Модератор', permissions: ['messages.delete_any']});
 assert.deepEqual(defaultRoleDraft(undefined, 'Участник'), {name: 'Участник', permissions: []});
});

test('право переключается, а не дублируется', () => {
 assert.deepEqual(togglePermission([], 'messages.delete_any'), ['messages.delete_any']);
 assert.deepEqual(togglePermission(['messages.delete_any'], 'messages.delete_any'), []);
});

test('назначить роль можно только человеку из группы и существующей ролью', () => {
 assert.equal(canAssignRole(chat, group, roles, 'a', 'moder'), true);
 assert.equal(canAssignRole(chat, group, roles, 'b', 'moder'), false, 'боту роль не назначается');
 assert.equal(canAssignRole(chat, group, roles, 'me', 'moder'), false, 'владельцу роль не меняется');
 assert.equal(canAssignRole(chat, group, roles, 'a', 'нет-такой'), false);
});

test('удалять и сохранять можно только пользовательские роли', () => {
 assert.equal(canTouchRole(roles, 'moder'), true);
 assert.equal(canTouchRole(roles, 'member'), false);
 assert.equal(canTouchRole(roles, 'owner'), false);
});

test('конфликт ревизии распознаётся по тексту ошибки', () => {
 assert.equal(isConflictError('Роли изменены, revision 5'), true);
 assert.equal(isConflictError('Диалог изменён'), true);
 assert.equal(isConflictError('Нет сети'), false);
});

test('право выгонять участников требует поддержки, живой группы и права', () => {
 assert.equal(canKick(true, true, true), true);
 assert.equal(canKick(true, false, true), false);
 assert.equal(canKick(true, true, false), false);
 assert.equal(canKick(false, true, true), false);
});
