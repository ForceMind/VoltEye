import crypto from "node:crypto";
import axios from "axios";

function isSuccessCode(payload) {
  return String(payload?.code) === "0";
}

function pickContractIdFromItem(item) {
  return item?.id || item?.contractId || null;
}

function normalizeNumber(value) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return null;
}

export class TcnestClient {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.token = "";
    this.cachedContractId = config.contractId || "";
    this.http = axios.create({
      baseURL: config.siteApiBase,
      timeout: 20000,
    });
  }

  sha256(text) {
    return crypto.createHash("sha256").update(text).digest("hex");
  }

  async login() {
    const payload = {
      mobile: this.config.siteMobile,
      password: this.sha256(this.config.sitePassword),
      type: 2,
    };
    const response = await this.http.post("/customer/loginCusWx/customerLogin", payload);
    if (!isSuccessCode(response.data)) {
      throw new Error(`Login failed: ${response.data?.message || "unknown error"}`);
    }

    this.token = response.data.message;
    if (!this.token) {
      throw new Error("Login failed: empty token");
    }
  }

  async request(method, url, options = {}, canRetry = true) {
    if (!this.token) {
      await this.login();
    }

    try {
      const response = await this.http.request({
        method,
        url,
        params: options.params,
        data: options.data,
        headers: {
          token: this.token,
        },
      });
      const payload = response.data;

      if (isSuccessCode(payload)) {
        return payload.result;
      }

      if (String(payload?.code) === "403" && canRetry) {
        this.logger.warn("Token expired, retrying login");
        this.token = "";
        await this.login();
        return this.request(method, url, options, false);
      }

      throw new Error(payload?.message || `Request failed (${url})`);
    } catch (error) {
      if (error.response && String(error.response?.status) === "403" && canRetry) {
        this.logger.warn("HTTP 403, retrying login");
        this.token = "";
        await this.login();
        return this.request(method, url, options, false);
      }
      throw error;
    }
  }

  async resolveContractId() {
    if (this.cachedContractId) {
      return this.cachedContractId;
    }

    const contracts = await this.request("get", "/tenants/tenantContract/listByTenantId");
    if (!Array.isArray(contracts) || contracts.length === 0) {
      throw new Error("No active contract found");
    }

    const preferred =
      contracts.find((item) => String(item?.contractStatus) === "3") ||
      contracts.find((item) => String(item?.checkStatus) === "3") ||
      contracts[0];

    const contractId = pickContractIdFromItem(preferred);
    if (!contractId) {
      throw new Error("Contract id is missing in API response");
    }

    this.cachedContractId = contractId;
    return contractId;
  }

  pickMeter(meters) {
    if (!Array.isArray(meters) || meters.length === 0) {
      throw new Error("No smart meter data found");
    }

    if (this.config.smartKey) {
      const matched = meters.find(
        (item) => String(item.smartKey) === String(this.config.smartKey) || String(item.smartId) === String(this.config.smartKey),
      );
      if (!matched) {
        throw new Error(`Specified smart meter not found: ${this.config.smartKey}`);
      }
      return matched;
    }

    return meters[0];
  }

  async fetchBalanceSnapshot() {
    const contractId = this.config.contractId || (await this.resolveContractId());
    const meters = await this.request("get", "/tenants/tenantContract/listSmartByContractId", {
      params: { contractId },
    });
    const meter = this.pickMeter(meters);
    const balance = normalizeNumber(meter.eleSmartMoney);

    if (balance === null) {
      throw new Error("Invalid balance value from smart meter API");
    }

    return {
      timestamp: new Date().toISOString(),
      contractId,
      meterKey: meter.smartKey || meter.smartId || "",
      meterBrand: meter.smartBrand || "",
      balance,
      raw: meter,
    };
  }
}
