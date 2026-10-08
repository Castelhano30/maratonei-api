import { AppError } from '../../http/app-error.js';
import { prisma } from '../../lib/prisma.js';
import type { MeResponse } from './me.schemas.js';

/** Dados públicos do próprio usuário (`select` explícito: nada além do contrato). */
export async function getMe(userId: string): Promise<MeResponse> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, image: true },
  });
  // A sessão aponta para um usuário que sumiu entre o getSession e aqui.
  if (!user) throw new AppError('UNAUTHENTICATED');
  return user;
}
