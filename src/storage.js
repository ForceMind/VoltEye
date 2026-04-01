import fs from "node:fs/promises";
import path from "node:path";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createDefaultState() {
  return {
    records: [],
    meta: {
      contractId: null,
      meterKey: null,
      meterBrand: null,
    },
    status: {
      lastSyncAt: null,
      lastError: null,
      lastErrorAt: null,
      lastAlertAt: null,
      updatedAt: null,
    },
  };
}

export class JsonStore {
  constructor(filePath, maxRecords) {
    this.filePath = filePath;
    this.maxRecords = maxRecords;
    this.state = createDefaultState();
    this.queue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const content = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(content);
      this.state = {
        ...createDefaultState(),
        ...parsed,
        meta: {
          ...createDefaultState().meta,
          ...(parsed.meta || {}),
        },
        status: {
          ...createDefaultState().status,
          ...(parsed.status || {}),
        },
        records: Array.isArray(parsed.records) ? parsed.records : [],
      };
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      await this.persist();
    }
  }

  enqueue(task) {
    this.queue = this.queue.then(task, task);
    return this.queue;
  }

  getState() {
    return clone(this.state);
  }

  getRecords() {
    return clone(this.state.records);
  }

  getStatus() {
    return clone(this.state.status);
  }

  getLatestRecord() {
    if (!this.state.records.length) {
      return null;
    }
    return clone(this.state.records[this.state.records.length - 1]);
  }

  async setMeta(patch) {
    await this.enqueue(async () => {
      this.state.meta = {
        ...this.state.meta,
        ...patch,
      };
      await this.persist();
    });
  }

  async appendRecord(record) {
    await this.enqueue(async () => {
      this.state.records.push(record);
      if (this.state.records.length > this.maxRecords) {
        const over = this.state.records.length - this.maxRecords;
        this.state.records.splice(0, over);
      }
      await this.persist();
    });
  }

  async updateStatus(patch) {
    await this.enqueue(async () => {
      this.state.status = {
        ...this.state.status,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      await this.persist();
    });
  }

  async persist() {
    const tmpPath = `${this.filePath}.tmp`;
    await fs.writeFile(tmpPath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
    await fs.rename(tmpPath, this.filePath);
  }
}
