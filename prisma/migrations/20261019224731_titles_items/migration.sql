-- CreateEnum
CREATE TYPE "media_type" AS ENUM ('MOVIE', 'TV');

-- CreateEnum
CREATE TYPE "item_status" AS ENUM ('WANT', 'WATCHING', 'WATCHED');

-- CreateTable
CREATE TABLE "title" (
    "id" UUID NOT NULL,
    "tmdb_id" INTEGER NOT NULL,
    "media_type" "media_type" NOT NULL,
    "name" TEXT NOT NULL,
    "overview" TEXT NOT NULL DEFAULT '',
    "poster_path" TEXT,
    "release_year" INTEGER,
    "genre_ids" INTEGER[],
    "genres" TEXT[],
    "runtime" INTEGER,
    "seasons" JSONB,
    "cached_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "title_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "list_item" (
    "id" UUID NOT NULL,
    "list_id" UUID NOT NULL,
    "title_id" UUID NOT NULL,
    "added_by_id" UUID,
    "status" "item_status" NOT NULL DEFAULT 'WANT',
    "added_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "list_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "title_media_type_tmdb_id_key" ON "title"("media_type", "tmdb_id");

-- CreateIndex
CREATE INDEX "list_item_list_id_added_at_idx" ON "list_item"("list_id", "added_at");

-- CreateIndex
CREATE INDEX "list_item_list_id_status_idx" ON "list_item"("list_id", "status");

-- CreateIndex
CREATE INDEX "list_item_title_id_idx" ON "list_item"("title_id");

-- CreateIndex
CREATE INDEX "list_item_added_by_id_idx" ON "list_item"("added_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "list_item_list_id_title_id_key" ON "list_item"("list_id", "title_id");

-- AddForeignKey
ALTER TABLE "list_item" ADD CONSTRAINT "list_item_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "list"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "list_item" ADD CONSTRAINT "list_item_title_id_fkey" FOREIGN KEY ("title_id") REFERENCES "title"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "list_item" ADD CONSTRAINT "list_item_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
