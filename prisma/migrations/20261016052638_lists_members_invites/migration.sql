-- CreateEnum
CREATE TYPE "list_role" AS ENUM ('OWNER', 'EDITOR', 'MEMBER');

-- CreateTable
CREATE TABLE "list" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "owner_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "list_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "list_member" (
    "id" UUID NOT NULL,
    "list_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "list_role" NOT NULL DEFAULT 'MEMBER',
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "list_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invite" (
    "id" UUID NOT NULL,
    "list_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "invite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "list_owner_id_idx" ON "list"("owner_id");

-- CreateIndex
CREATE INDEX "list_member_user_id_idx" ON "list_member"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "list_member_list_id_user_id_key" ON "list_member"("list_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invite_token_key" ON "invite"("token");

-- CreateIndex
CREATE INDEX "invite_list_id_idx" ON "invite"("list_id");

-- AddForeignKey
ALTER TABLE "list" ADD CONSTRAINT "list_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "list_member" ADD CONSTRAINT "list_member_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "list"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "list_member" ADD CONSTRAINT "list_member_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite" ADD CONSTRAINT "invite_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "list"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite" ADD CONSTRAINT "invite_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Índices únicos parciais (o Prisma não os expressa): um OWNER por lista e no
-- máximo um convite ativo por lista.
CREATE UNIQUE INDEX "list_member_one_owner_key" ON "list_member"("list_id") WHERE "role" = 'OWNER';

CREATE UNIQUE INDEX "invite_one_active_per_list_key" ON "invite"("list_id") WHERE "revoked_at" IS NULL;
