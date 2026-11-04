import type { List } from '../../src/generated/prisma/client.js';
import { createList, createMembership } from '../factories/list.js';
import { createUser } from '../factories/user.js';
import { asUser, type UserClient } from './as-user.js';

export interface ListScenario {
  list: List;
  owner: UserClient;
  editor: UserClient;
  member: UserClient;
  outsider: UserClient;
  /** `ListMember.id` de cada papel. */
  ids: { owner: string; editor: string; member: string };
}

/** Uma lista com um usuário de cada papel e um não membro, todos autenticados. */
export async function listScenario(): Promise<ListScenario> {
  const [ownerUser, editorUser, memberUser, outsiderUser] = await Promise.all([
    createUser(),
    createUser(),
    createUser(),
    createUser(),
  ]);
  const list = await createList({ owner: ownerUser });
  const editorMember = await createMembership(list, { user: editorUser, role: 'EDITOR' });
  const memberMember = await createMembership(list, { user: memberUser, role: 'MEMBER' });
  return {
    list,
    owner: await asUser(ownerUser),
    editor: await asUser(editorUser),
    member: await asUser(memberUser),
    outsider: await asUser(outsiderUser),
    ids: { owner: list.ownerMember.id, editor: editorMember.id, member: memberMember.id },
  };
}
