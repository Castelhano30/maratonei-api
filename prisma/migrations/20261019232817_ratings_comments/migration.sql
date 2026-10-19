-- CreateTable
CREATE TABLE "rating" (
    "id" UUID NOT NULL,
    "list_item_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "stars" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment" (
    "id" UUID NOT NULL,
    "list_item_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rating_member_id_idx" ON "rating"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "rating_list_item_id_member_id_key" ON "rating"("list_item_id", "member_id");

-- CreateIndex
CREATE INDEX "comment_list_item_id_created_at_idx" ON "comment"("list_item_id", "created_at");

-- CreateIndex
CREATE INDEX "comment_member_id_idx" ON "comment"("member_id");

-- AddForeignKey
ALTER TABLE "rating" ADD CONSTRAINT "rating_list_item_id_fkey" FOREIGN KEY ("list_item_id") REFERENCES "list_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating" ADD CONSTRAINT "rating_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "list_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment" ADD CONSTRAINT "comment_list_item_id_fkey" FOREIGN KEY ("list_item_id") REFERENCES "list_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment" ADD CONSTRAINT "comment_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "list_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Faixa de estrelas também no banco (o Prisma não expressa checks).
ALTER TABLE "rating" ADD CONSTRAINT "rating_stars_range_check" CHECK ("stars" BETWEEN 1 AND 5);
