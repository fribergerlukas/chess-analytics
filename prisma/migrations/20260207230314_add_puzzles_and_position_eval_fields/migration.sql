-- AlterTable
ALTER TABLE "Position" ADD COLUMN     "bestMoveUci" TEXT,
ADD COLUMN     "pv" TEXT;

-- CreateTable
CREATE TABLE "Puzzle" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "gameId" INTEGER NOT NULL,
    "positionId" INTEGER NOT NULL,
    "fen" TEXT NOT NULL,
    "sideToMove" "Side" NOT NULL,
    "playedMoveUci" TEXT NOT NULL,
    "bestMoveUci" TEXT NOT NULL,
    "pv" TEXT NOT NULL,
    "evalBeforeCp" INTEGER,
    "evalAfterCp" INTEGER,
    "deltaCp" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Puzzle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Puzzle_userId_positionId_key" ON "Puzzle"("userId", "positionId");

-- AddForeignKey
ALTER TABLE "Puzzle" ADD CONSTRAINT "Puzzle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Puzzle" ADD CONSTRAINT "Puzzle_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Puzzle" ADD CONSTRAINT "Puzzle_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
