import { maybeSendLowBalanceAlert } from "./alerts.js";

export class BalancePoller {
  constructor({ client, store, config, logger }) {
    this.client = client;
    this.store = store;
    this.config = config;
    this.logger = logger;
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.timer) {
      return;
    }

    this.runOnce().catch((error) => {
      this.logger.error(`Initial polling failed: ${error.message}`);
    });

    this.timer = setInterval(() => {
      this.runOnce().catch((error) => {
        this.logger.error(`Scheduled polling failed: ${error.message}`);
      });
    }, this.config.pollIntervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce(force = false) {
    if (this.running) {
      if (force) {
        throw new Error("Polling is still running, try again later");
      }
      return null;
    }

    this.running = true;
    try {
      const snapshot = await this.client.fetchBalanceSnapshot();

      await this.store.setMeta({
        contractId: snapshot.contractId,
        meterKey: snapshot.meterKey || null,
        meterBrand: snapshot.meterBrand || null,
      });
      await this.store.appendRecord(snapshot);
      await this.store.updateStatus({
        lastSyncAt: snapshot.timestamp,
        lastError: null,
        lastErrorAt: null,
      });

      await maybeSendLowBalanceAlert(this.config, this.store, snapshot, this.logger);
      this.logger.info(`Polling succeeded, current balance ${snapshot.balance} CNY`);
      return snapshot;
    } catch (error) {
      await this.store.updateStatus({
        lastError: error.message,
        lastErrorAt: new Date().toISOString(),
      });
      throw error;
    } finally {
      this.running = false;
    }
  }
}
