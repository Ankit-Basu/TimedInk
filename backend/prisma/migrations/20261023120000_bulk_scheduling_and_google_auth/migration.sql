-- AlterTable
ALTER TABLE `scheduled_emails` ADD COLUMN `batchId` VARCHAR(191) NULL,
    ADD COLUMN `hourlyLimit` INTEGER NULL;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `avatarUrl` TEXT NULL,
    ADD COLUMN `googleId` VARCHAR(191) NULL,
    MODIFY `passwordHash` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `scheduled_emails_batchId_idx` ON `scheduled_emails`(`batchId`);

-- CreateIndex
CREATE UNIQUE INDEX `users_googleId_key` ON `users`(`googleId`);

