-- CreateTable
CREATE TABLE "LevelCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LevelCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_LevelToLevelCategory" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_LevelToLevelCategory_AB_unique" ON "_LevelToLevelCategory"("A", "B");

-- CreateIndex
CREATE INDEX "_LevelToLevelCategory_B_index" ON "_LevelToLevelCategory"("B");

-- AddForeignKey
ALTER TABLE "_LevelToLevelCategory" ADD CONSTRAINT "_LevelToLevelCategory_A_fkey" FOREIGN KEY ("A") REFERENCES "Level"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_LevelToLevelCategory" ADD CONSTRAINT "_LevelToLevelCategory_B_fkey" FOREIGN KEY ("B") REFERENCES "LevelCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
