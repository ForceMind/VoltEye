import axios from "axios";

export async function maybeSendLowBalanceAlert(config, store, snapshot, logger) {
  if (!config.alertWebhookUrl) {
    return;
  }
  if (snapshot.balance > config.lowBalanceThreshold) {
    return;
  }

  const status = store.getStatus();
  const lastAlertAt = status.lastAlertAt ? new Date(status.lastAlertAt).getTime() : 0;
  if (lastAlertAt && Date.now() - lastAlertAt < config.alertCooldownMs) {
    return;
  }

  const message = [
    "[VoltEye] Low balance alert",
    `Balance: ${snapshot.balance} CNY`,
    `Threshold: ${config.lowBalanceThreshold} CNY`,
    `Contract: ${snapshot.contractId}`,
    `Meter: ${snapshot.meterKey || "-"}`,
    `Time: ${snapshot.timestamp}`,
  ].join("\n");

  try {
    await axios.post(
      config.alertWebhookUrl,
      {
        text: message,
        source: "VoltEye",
      },
      {
        timeout: 10000,
      },
    );
    await store.updateStatus({ lastAlertAt: snapshot.timestamp });
    logger.warn("Low balance alert sent");
  } catch (error) {
    logger.warn(`Failed to send alert: ${error.message}`);
  }
}
