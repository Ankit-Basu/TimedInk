-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mailboxes` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `fromName` VARCHAR(191) NOT NULL,
    `fromEmail` VARCHAR(191) NOT NULL,
    `dailyLimit` INTEGER NOT NULL DEFAULT 10,
    `warmupDay` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `mailboxes_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scheduled_emails` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `mailboxId` VARCHAR(191) NULL,
    `to` VARCHAR(191) NOT NULL,
    `cc` VARCHAR(191) NULL,
    `subject` VARCHAR(998) NOT NULL,
    `bodyHtml` TEXT NOT NULL,
    `bodyText` TEXT NOT NULL,
    `scheduledAt` DATETIME(3) NOT NULL,
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'UTC',
    `status` ENUM('PENDING', 'QUEUED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `lastError` TEXT NULL,
    `bullJobId` VARCHAR(191) NULL,
    `previewUrl` TEXT NULL,
    `deliverabilityScore` INTEGER NULL,
    `deliverabilityFlags` JSON NULL,
    `followUpOfId` VARCHAR(191) NULL,
    `followUpAfterHours` INTEGER NULL,
    `followUpQueuedAt` DATETIME(3) NULL,
    `openedAt` DATETIME(3) NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `scheduled_emails_userId_status_idx`(`userId`, `status`),
    INDEX `scheduled_emails_status_scheduledAt_idx`(`status`, `scheduledAt`),
    INDEX `scheduled_emails_mailboxId_idx`(`mailboxId`),
    INDEX `scheduled_emails_followUpOfId_idx`(`followUpOfId`),
    INDEX `scheduled_emails_status_followUpQueuedAt_idx`(`status`, `followUpQueuedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_events` (
    `id` VARCHAR(191) NOT NULL,
    `scheduledEmailId` VARCHAR(191) NOT NULL,
    `type` ENUM('CREATED', 'QUEUED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED', 'OPENED') NOT NULL,
    `meta` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `email_events_scheduledEmailId_createdAt_idx`(`scheduledEmailId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `mailboxes` ADD CONSTRAINT `mailboxes_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `scheduled_emails` ADD CONSTRAINT `scheduled_emails_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `scheduled_emails` ADD CONSTRAINT `scheduled_emails_mailboxId_fkey` FOREIGN KEY (`mailboxId`) REFERENCES `mailboxes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `scheduled_emails` ADD CONSTRAINT `scheduled_emails_followUpOfId_fkey` FOREIGN KEY (`followUpOfId`) REFERENCES `scheduled_emails`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `email_events` ADD CONSTRAINT `email_events_scheduledEmailId_fkey` FOREIGN KEY (`scheduledEmailId`) REFERENCES `scheduled_emails`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
