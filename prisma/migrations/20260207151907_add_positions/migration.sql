-- CreateEnum
CREATE TYPE "Side" AS ENUM ('WHITE', 'BLACK');

-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "positionsParsed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Position" (
    "id" SERIAL NOT NULL,
    "gameId" INTEGER NOT NULL,
    "ply" INTEGER NOT NULL,
    "fen" TEXT NOT NULL,
    "moveUci" TEXT NOT NULL,
    "san" TEXT NOT NULL,
    "sideToMove" "Side" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Position_gameId_idx" ON "Position"("gameId");

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
