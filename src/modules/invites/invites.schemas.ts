import { z } from '../../openapi/registry.js';

export const InviteListParams = z.object({ listId: z.uuid() });

export const InviteTokenParams = z.object({
  token: z.string().min(1).max(128).openapi({ description: 'Token do link de convite.' }),
});

export const Invite = z
  .object({
    token: z.string().openapi({ description: '32 bytes aleatórios em base64url.' }),
    createdAt: z.iso.datetime(),
  })
  .openapi('Invite');

export const InvitePreview = z
  .object({
    listId: z.uuid(),
    listName: z.string(),
    alreadyMember: z.boolean(),
  })
  .openapi('InvitePreview');

export type Invite = z.infer<typeof Invite>;
export type InvitePreview = z.infer<typeof InvitePreview>;
