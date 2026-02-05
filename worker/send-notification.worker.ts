/**
 * Send Notification Worker
 *
 * This worker sends delay notification emails to customers via Resend.
 * It renders the email template with shipment data and logs the notification.
 *
 * Implemented in Phase 5: Notifications & Resolution
 */

import type { Job } from "bullmq";

export interface SendNotificationJobData {
  shipmentId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  sentBy: string;
}

/**
 * Process a send notification job
 *
 * TODO: Implement in Phase 5
 * - Load shipment from DB
 * - Send email via Resend API
 * - Create NotificationLog record
 * - Update shipment.notificationSent and notificationSentAt
 * - Handle failures and log errors
 */
export async function processSendNotification(
  job: Job<SendNotificationJobData>
): Promise<void> {
  const { shipmentId, recipientEmail, subject } = job.data;
  console.log(
    `[send-notification] Processing job ${job.id} for shipment ${shipmentId}`
  );
  console.log(`[send-notification] Would send email to ${recipientEmail}: "${subject}"`);

  // Placeholder implementation
  // Will be implemented in Phase 5: Notifications & Resolution
  console.log(
    `[send-notification] Placeholder: Would send email via Resend to ${recipientEmail}`
  );
}
