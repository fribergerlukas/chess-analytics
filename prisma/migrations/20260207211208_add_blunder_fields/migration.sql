-- CreateEnum
CREATE TYPE "MoveClassification" AS ENUM ('BEST', 'GOOD', 'INACCURACY', 'MISTAKE', 'BLUNDER');

-- AlterTable
ALTER TABLE "Position" ADD COLUMN     "classification" "MoveClassification",
ADD COLUMN     "cpLoss" DOUBLE PRECISION;
