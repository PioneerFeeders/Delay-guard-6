/**
 * Send Notification Worker
 *
 * This worker sends delay notification emails to customers via Resend.
 * It processes jobs from the send-notification queue, sends emails,
 * creates notification logs, and updates shipment status.
 */

import type { Job } from "bullmq";
import type { SendNotificationJobData } from "../app/jobs/types";
import { sendAndLogNotification } from "../app/services/notification.service";

/**
 * Process a send notification job
 *
 * 1. Sends the email via Resend
 * 2. Creates a NotificationLog record
 * 3. Updates shipment.notificationSent and notificationSentAt
 *
 * @param job - The BullMQ job containing notification data
 * @throws Error if sending fails after all retries
 */
export async function processSendNotification(
  job: Job<SendNotificationJobData>
): Promise<void> {
  const { shipmentId, recipientEmail, subject, body, sentBy } = job.data;

  console.log(
    `[send-notification] Processing job ${job.id} for shipment ${shipmentId}`
  );
  console.log(`[send-notification] Sending to: ${recipientEmail}`);
  console.log(`[send-notification] Subject: ${subject}`);

  // Send the notification and log the result
  const result = await sendAndLogNotification({
    shipmentId,
    recipientEmail,
    subject,
    body,
    sentBy,
  });

  if (!result.success) {
    // Throw error to trigger retry logic
    console.error(
      `[send-notification] Failed to send email: ${result.error}`
    );
    throw new Error(`Failed to send notification: ${result.error}`);
  }

  console.log(
    `[send-notification] Successfully sent notification to ${recipientEmail}`
  );
  if (result.messageId) {
    console.log(`[send-notification] Resend message ID: ${result.messageId}`);
  }
}
