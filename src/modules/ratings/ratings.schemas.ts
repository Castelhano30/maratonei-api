import { UserSummary } from '../../openapi/common.js';
import { z } from '../../openapi/registry.js';

export const RatingParams = z.object({ listId: z.uuid(), itemId: z.uuid() });

export const SetRatingBody = z
  .object({ stars: z.number().int().min(1).max(5) })
  .openapi('SetRatingBody');

export const Rating = z
  .object({
    member: UserSummary,
    stars: z.number().int().min(1).max(5),
    updatedAt: z.iso.datetime(),
  })
  .openapi('Rating');

export const RatingList = z
  .object({
    average: z.number().min(1).max(5).nullable().openapi({ description: '`null` sem notas.' }),
    count: z.number().int().min(0),
    data: z.array(Rating),
  })
  .openapi('RatingList');

export type SetRatingBody = z.infer<typeof SetRatingBody>;
export type Rating = z.infer<typeof Rating>;
export type RatingList = z.infer<typeof RatingList>;
