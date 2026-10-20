-- CreateTable
CREATE TABLE "episode_progress" (
    "id" UUID NOT NULL,
    "list_item_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "season" INTEGER NOT NULL,
    "episode" INTEGER NOT NULL,
    "watched_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "episode_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "episode_progress_member_id_idx" ON "episode_progress"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "episode_progress_list_item_id_member_id_season_episode_key" ON "episode_progress"("list_item_id", "member_id", "season", "episode");

-- AddForeignKey
ALTER TABLE "episode_progress" ADD CONSTRAINT "episode_progress_list_item_id_fkey" FOREIGN KEY ("list_item_id") REFERENCES "list_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_progress" ADD CONSTRAINT "episode_progress_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "list_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
