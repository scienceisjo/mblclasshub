"use strict";
var ezonBle = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/index.ts
  var index_exports = {};
  __export(index_exports, {
    ezonBle: () => ezonBle,
    install: () => install
  });

  // src/protocol/constants.ts
  var SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
  var RX_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
  var TX_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
  var PROTOCOL_VERSION = 17;
  var MAX_CONNECTIONS = 6;
  var SOP = 192;
  var EOP = 193;
  var ESC = 219;
  var ESC_SOP = 220;
  var ESC_EOP = 221;
  var ESC_ESC = 222;
  var FRAME_TIMEOUT_MS = 2e3;
  var MAX_FRAME_LEN = 1024;
  var CMD = {
    SET_NAME: 1,
    SET_SENSOR: 2,
    TIME_SYNC: 3,
    START: 4,
    STOP: 5,
    NOTIFY_START: 6,
    NOTIFY_STOP: 7,
    SET_LED: 8,
    SAMPLE: 8,
    BURST: 9,
    SENSOR_ERROR: 134,
    SENSOR_RESET: 10,
    GET_DEVICE_INFO: 11,
    SCHEDULE_START: 12,
    SCHEDULE_CANCEL: 13,
    TIME_SYNC_RTT: 15,
    RESPONSE_BASE: 128,
    RESP_SET_NAME: 129,
    RESP_SET_SENSOR: 130,
    RESP_TIME_SYNC_MAC: 131,
    RESP_START: 132,
    RESP_STOP: 133,
    RESP_SET_LED: 136,
    RESP_SENSOR_RESET: 138,
    RESP_DEVICE_INFO: 139,
    RESP_SCHEDULE_START: 140,
    RESP_SCHEDULE_CANCEL: 141,
    RESP_TIME_SYNC_RTT: 143
  };
  var RESPONSE_COMMANDS = /* @__PURE__ */ new Set([
    CMD.RESP_SET_NAME,
    CMD.RESP_SET_SENSOR,
    CMD.RESP_TIME_SYNC_MAC,
    CMD.RESP_START,
    CMD.RESP_STOP,
    CMD.RESP_SET_LED,
    CMD.RESP_SENSOR_RESET,
    CMD.RESP_DEVICE_INFO,
    CMD.RESP_SCHEDULE_START,
    CMD.RESP_SCHEDULE_CANCEL,
    CMD.RESP_TIME_SYNC_RTT
  ]);
  var isResponseCommand = (cmd) => RESPONSE_COMMANDS.has(cmd);

  // src/protocol/internals.ts
  var CRC_MODE = "msb31";

  // src/protocol/codec.ts
  var crc8Msb31 = (bytes) => {
    let crc = 0;
    for (const b of bytes) {
      crc ^= b;
      for (let i = 0; i < 8; i += 1) {
        if (crc & 128) crc = (crc << 1 ^ 49) & 255;
        else crc = crc << 1 & 255;
      }
    }
    return crc;
  };
  var crc8 = (bytes) => {
    if (CRC_MODE !== "msb31") {
      throw new Error(`Unsupported CRC mode: ${CRC_MODE}`);
    }
    return crc8Msb31(bytes);
  };
  var concat = (a, b) => {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  };
  var stuffData = (bytes) => {
    const out = [];
    for (const b of bytes) {
      if (b === SOP) out.push(ESC, ESC_SOP);
      else if (b === EOP) out.push(ESC, ESC_EOP);
      else if (b === ESC) out.push(ESC, ESC_ESC);
      else out.push(b);
    }
    return new Uint8Array(out);
  };
  var buildRequest = (cmd, payload) => {
    const data = payload ?? new Uint8Array(0);
    const header = new Uint8Array([
      PROTOCOL_VERSION,
      cmd & 255,
      data.length & 255,
      data.length >> 8 & 255
    ]);
    const framed = concat(concat(header, data), new Uint8Array([crc8(concat(header, data))]));
    const stuffedFrame = stuffData(framed);
    const out = new Uint8Array(1 + stuffedFrame.length + 1);
    let p = 0;
    out[p++] = SOP;
    out.set(stuffedFrame, p);
    p += stuffedFrame.length;
    out[p] = EOP;
    return out;
  };
  var u16le = (n) => new Uint8Array([n & 255, n >> 8 & 255]);
  var u32le = (n) => new Uint8Array([
    n & 255,
    n >> 8 & 255,
    n >> 16 & 255,
    n >> 24 & 255
  ]);
  var u64le = (n) => {
    const out = new Uint8Array(8);
    let value = n;
    for (let i = 0; i < 8; i += 1) {
      out[i] = Number(value & 0xffn);
      value >>= 8n;
    }
    return out;
  };
  var readU32LE = (view, offset) => view.getUint32(offset, true);
  var readU64LE = (view, offset) => {
    let value = 0n;
    for (let i = 7; i >= 0; i -= 1) {
      value = value << 8n | BigInt(view.getUint8(offset + i));
    }
    return value;
  };
  var recoverTime32 = (t32, lastTs) => {
    if (!Number.isFinite(t32)) return Date.now();
    if (lastTs === null || !Number.isFinite(lastTs)) {
      const now = Date.now();
      const nowHigh = Math.floor(now / 4294967296);
      return nowHigh * 4294967296 + t32;
    }
    const lastHigh = Math.floor(lastTs / 4294967296);
    const lastLow = lastTs % 4294967296;
    let high = lastHigh;
    if (t32 < lastLow && lastLow - t32 > 2147483648) {
      high += 1;
    }
    return high * 4294967296 + t32;
  };
  var buildTimeSyncPayload = (date = /* @__PURE__ */ new Date()) => {
    const payload = new Uint8Array(9);
    payload.set(u16le(date.getUTCFullYear()), 0);
    payload[2] = date.getUTCMonth() + 1;
    payload[3] = date.getUTCDate();
    payload[4] = date.getUTCHours();
    payload[5] = date.getUTCMinutes();
    payload[6] = date.getUTCSeconds();
    payload.set(u16le(date.getUTCMilliseconds()), 7);
    return payload;
  };

  // src/protocol/parser.ts
  var createState = () => ({
    state: "wait-sop",
    header: [],
    headerLen: 0,
    expectedDataLen: 0,
    data: [],
    escapeNext: false,
    crcByte: null,
    frameStartAt: 0,
    frameBytes: 0
  });
  var resetState = (state) => {
    state.state = "wait-sop";
    state.header = [];
    state.headerLen = 0;
    state.expectedDataLen = 0;
    state.data = [];
    state.escapeNext = false;
    state.crcByte = null;
    state.frameStartAt = 0;
    state.frameBytes = 0;
  };
  var startFrame = (state) => {
    resetState(state);
    state.state = "read-header";
    state.frameStartAt = Date.now();
  };
  var concat2 = (a, b) => {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  };
  var unstuff = (bytes) => {
    const out = [];
    for (let i = 0; i < bytes.length; i += 1) {
      const value = bytes[i];
      if (value !== ESC) {
        out.push(value);
        continue;
      }
      if (i + 1 >= bytes.length) return null;
      const escaped = bytes[++i];
      if (escaped === ESC_SOP) out.push(SOP);
      else if (escaped === ESC_EOP) out.push(EOP);
      else if (escaped === ESC_ESC) out.push(ESC);
      else return null;
    }
    return new Uint8Array(out);
  };
  var toPacket = (header, data) => {
    if (header.length === 5) {
      return {
        kind: "response",
        pv: header[0],
        cmd: header[1],
        result: header[2],
        len: data.length,
        data
      };
    }
    return {
      kind: "notify",
      pv: header[0],
      cmd: header[1],
      len: data.length,
      data
    };
  };
  var FrameParser = class {
    constructor() {
      this.state = createState();
    }
    feed(bytes, onPacket) {
      const state = this.state;
      for (const b of bytes) {
        if (state.state !== "wait-sop" && Date.now() - state.frameStartAt > FRAME_TIMEOUT_MS) {
          resetState(state);
        }
        if (state.state === "wait-sop") {
          if (b === SOP) startFrame(state);
          continue;
        }
        state.frameBytes += 1;
        if (state.frameBytes > MAX_FRAME_LEN) {
          resetState(state);
          continue;
        }
        if (b === SOP) {
          startFrame(state);
          continue;
        }
        if (b !== EOP) {
          state.data.push(b);
          continue;
        }
        const frame = unstuff(state.data);
        if (!frame || frame.length < 5) {
          resetState(state);
          continue;
        }
        const cmd = frame[1];
        const headerLen = isResponseCommand(cmd) ? 5 : 4;
        if (frame.length < headerLen + 1) {
          resetState(state);
          continue;
        }
        const dataLen = headerLen === 5 ? frame[3] | frame[4] << 8 : frame[2] | frame[3] << 8;
        const expectedLen = headerLen + dataLen + 1;
        if (frame.length !== expectedLen) {
          resetState(state);
          continue;
        }
        const header = frame.slice(0, headerLen);
        const data = frame.slice(headerLen, frame.length - 1);
        const crcByte = frame[frame.length - 1];
        if (crc8(concat2(header, data)) === crcByte) {
          onPacket(toPacket(header, data));
        }
        resetState(state);
      }
    }
  };

  // src/runtime/bucketizer.ts
  var sanitizeDisplayMs = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return 1;
    return Math.max(1, Math.floor(num));
  };
  var sanitizeRowLimit = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return 2;
    return Math.max(2, Math.floor(num));
  };
  var buildColumnKey = (deviceKey, sensorId, channelIndex) => `${deviceKey}:S${Number.isFinite(sensorId) ? sensorId : "NA"}:CH${channelIndex + 1}`;
  var Bucketizer = class {
    constructor(displayMs, rowLimit) {
      this.baseTimeMs = null;
      this.lastBucketIndex = null;
      this.bucketOrder = [];
      this.bucketMap = /* @__PURE__ */ new Map();
      this.columnOrder = [];
      this.columnSet = /* @__PURE__ */ new Set();
      this.seriesState = /* @__PURE__ */ new Map();
      this.displayMs = sanitizeDisplayMs(displayMs);
      this.rowLimit = sanitizeRowLimit(rowLimit);
    }
    getDisplayMs() {
      return this.displayMs;
    }
    setDisplayMs(nextDisplayMs) {
      const sanitized = sanitizeDisplayMs(nextDisplayMs);
      if (sanitized === this.displayMs) return;
      this.displayMs = sanitized;
      this.reset();
    }
    reset() {
      this.baseTimeMs = null;
      this.lastBucketIndex = null;
      this.bucketOrder.length = 0;
      this.bucketMap.clear();
      this.columnOrder.length = 0;
      this.columnSet.clear();
      this.seriesState.clear();
    }
    ingest(deviceKey, sample) {
      if (!Number.isFinite(sample.timestampMs)) return;
      if (this.baseTimeMs === null) this.baseTimeMs = sample.timestampMs;
      const bucketIndex = Math.floor((sample.timestampMs - this.baseTimeMs) / this.displayMs);
      if (this.lastBucketIndex === null) this.lastBucketIndex = bucketIndex - 1;
      if (bucketIndex > this.lastBucketIndex) {
        for (let i = this.lastBucketIndex + 1; i < bucketIndex; i += 1) {
          this.ensureBucket(i);
        }
        this.lastBucketIndex = bucketIndex;
      }
      const row = this.ensureBucket(bucketIndex);
      for (let i = 0; i < sample.values.length; i += 1) {
        const key = buildColumnKey(deviceKey, sample.sensorId, i);
        if (!this.columnSet.has(key)) {
          this.columnSet.add(key);
          this.columnOrder.push(key);
        }
        const value = Number(sample.values[i]);
        const normalized = Number.isFinite(value) ? value : null;
        this.seriesState.set(key, { value: normalized, timestampMs: sample.timestampMs });
        row.cells[key] = { value: normalized, timestampMs: sample.timestampMs };
      }
      this.trimRows();
    }
    snapshot() {
      const rows = this.bucketOrder.map((index) => this.bucketMap.get(index)).filter((row) => Boolean(row));
      return {
        baseTimeMs: this.baseTimeMs,
        displayMs: this.displayMs,
        columns: [...this.columnOrder],
        rows
      };
    }
    ensureBucket(bucketIndex) {
      const existing = this.bucketMap.get(bucketIndex);
      if (existing) return existing;
      const timestampMs = (this.baseTimeMs ?? Date.now()) + bucketIndex * this.displayMs;
      const cells = {};
      for (const key of this.columnOrder) {
        const prev = this.findPreviousCell(key, bucketIndex) ?? { value: null, timestampMs: null };
        cells[key] = { value: prev.value, timestampMs: prev.timestampMs };
      }
      const row = { bucketIndex, timestampMs, cells };
      this.bucketMap.set(bucketIndex, row);
      this.insertBucketIndex(bucketIndex);
      this.trimRows();
      return row;
    }
    findPreviousCell(key, bucketIndex) {
      for (let i = this.bucketOrder.length - 1; i >= 0; i -= 1) {
        const previousIndex = this.bucketOrder[i];
        if (previousIndex >= bucketIndex) continue;
        const cell = this.bucketMap.get(previousIndex)?.cells[key];
        if (cell) return cell;
      }
      return null;
    }
    insertBucketIndex(bucketIndex) {
      if (this.bucketOrder.length === 0) {
        this.bucketOrder.push(bucketIndex);
        return;
      }
      const idx = this.bucketOrder.findIndex((value) => value > bucketIndex);
      if (idx === -1) this.bucketOrder.push(bucketIndex);
      else this.bucketOrder.splice(idx, 0, bucketIndex);
    }
    trimRows() {
      const excess = this.bucketOrder.length - this.rowLimit;
      if (excess <= 0) return;
      const removed = this.bucketOrder.splice(0, excess);
      for (const index of removed) {
        this.bucketMap.delete(index);
      }
    }
  };

  // src/runtime/deviceKey.ts
  var normalizeKey = (value) => {
    if (typeof value !== "string") return "";
    return value.trim();
  };
  var resolveStableDeviceKey = (source) => {
    const macTail = normalizeKey(source.macTail);
    if (macTail) return macTail;
    const id = normalizeKey(source.id);
    if (id) return id;
    return "unknown-device";
  };

  // src/runtime/sampleDecode.ts
  var truncate2 = (value) => Math.trunc(value * 100) / 100;
  var toMacTail = (macBytes) => Array.from(macBytes).map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(":");
  var decodeSamplePayload = (data, lastTimestampMs) => {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const len = data.length;
    if (len >= 5 && len % 4 === 1) {
      const sensorId = view.getUint8(0);
      const t32 = readU32LE(view, 1);
      const ts = recoverTime32(t32, lastTimestampMs);
      const count = (len - 5) / 4;
      const values = [];
      for (let i = 0; i < count; i += 1) {
        values.push(truncate2(view.getFloat32(5 + i * 4, true)));
      }
      return {
        samples: [{ sensorId, timestampMs: ts, values, macTail: null }],
        lastTimestampMs: ts
      };
    }
    if (len >= 12 && len % 4 === 0) {
      const sensorId = view.getUint8(3);
      const ts = Number(readU64LE(view, 4));
      const count = (len - 12) / 4;
      const values = [];
      for (let i = 0; i < count; i += 1) {
        values.push(truncate2(view.getFloat32(12 + i * 4, true)));
      }
      return {
        samples: [{ sensorId, timestampMs: ts, values, macTail: toMacTail(data.slice(0, 3)) }],
        lastTimestampMs: ts
      };
    }
    return { samples: [], lastTimestampMs };
  };
  var decodeBurstPayload = (data, lastTimestampMs, fallbackIntervalMs) => {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (data.length === 13) {
      const sensorId2 = view.getUint8(0);
      const baseTs2 = recoverTime32(readU32LE(view, 1), lastTimestampMs);
      const fallbackInterval = fallbackIntervalMs == null ? Number.NaN : Number(fallbackIntervalMs);
      const interval = Number.isFinite(fallbackInterval) && fallbackInterval > 0 ? fallbackInterval : 10;
      const samples2 = [
        {
          sensorId: sensorId2,
          timestampMs: baseTs2,
          values: [truncate2(view.getFloat32(5, true))],
          macTail: null
        },
        {
          sensorId: sensorId2,
          timestampMs: baseTs2 + interval,
          values: [truncate2(view.getFloat32(9, true))],
          macTail: null
        }
      ];
      return { samples: samples2, lastTimestampMs: samples2[1].timestampMs };
    }
    if (data.length < 20) {
      return { samples: [], lastTimestampMs };
    }
    const sensorId = view.getUint8(3);
    const baseTs = Number(readU64LE(view, 6));
    const intervalMs = readU32LE(view, 14);
    const sampleCount = view.getUint8(18);
    const channelCount = view.getUint8(19);
    const expected = 20 + 4 * sampleCount * channelCount;
    if (expected !== data.length) {
      return { samples: [], lastTimestampMs };
    }
    const macTail = toMacTail(data.slice(0, 3));
    const samples = [];
    let offset = 20;
    for (let i = 0; i < sampleCount; i += 1) {
      const values = [];
      for (let c = 0; c < channelCount; c += 1) {
        values.push(truncate2(view.getFloat32(offset + c * 4, true)));
      }
      offset += channelCount * 4;
      samples.push({
        sensorId,
        timestampMs: baseTs + i * intervalMs,
        values,
        macTail
      });
    }
    return {
      samples,
      lastTimestampMs: samples.length > 0 ? samples[samples.length - 1].timestampMs : lastTimestampMs
    };
  };
  var decodeSetSensorPayload = (data) => {
    if (data.length < 5) return null;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return {
      sensorId: data[0],
      intervalMs: readU32LE(view, 1)
    };
  };

  // src/runtime/deviceInfo.ts
  var textDecoder = new TextDecoder();
  var toMacTail2 = (macBytes) => Array.from(macBytes).map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(":");
  var readU32LE2 = (view, offset) => view.getUint32(offset, true);
  var readU64LE2 = (view, offset) => {
    let value = 0n;
    for (let i = 7; i >= 0; i -= 1) {
      value = value << 8n | BigInt(view.getUint8(offset + i));
    }
    return value;
  };
  var isLikelyFirmwareVersion = (major, minor, patch) => major >= 0 && major <= 9 && minor >= 0 && minor <= 20 && patch >= 0 && patch <= 99;
  var isLikelySensorId = (sensorId) => sensorId >= 1 && sensorId <= 39;
  var isPreExtendedFirmwareVersion = (major, minor, patch) => major === 1 && minor === 0 && patch < 4;
  var isExtendedLayoutFirmwareVersion = (major, minor, patch) => major === 1 && (minor === 0 && patch >= 4 || minor === 1);
  var hasPrintableDeviceName = (nameBytes) => {
    if (nameBytes.length === 0) return false;
    const decoded = textDecoder.decode(nameBytes).replace(/\0+$/, "").trim();
    return decoded.length > 0 && !/[\u0000-\u001f\u007f]/u.test(decoded);
  };
  var hasPlausibleLegacyDeviceInfoLayout = (data, options = {}) => {
    if (data.length >= 8) {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const intervalMs = readU32LE2(view, 4);
      if (intervalMs > 0 && intervalMs <= 24 * 60 * 60 * 1e3) {
        if (options.embeddedExtendedCandidate) {
          const legacyName = data.length > 11 && hasPrintableDeviceName(data.slice(11));
          const extendedName = data.length > 14 && hasPrintableDeviceName(data.slice(14));
          if (!legacyName && extendedName) return false;
        }
        return true;
      }
    }
    if (options.includeNameEvidence === false) return false;
    return data.length > 11 && hasPrintableDeviceName(data.slice(11));
  };
  var isExtendedDeviceInfoPayload = (data) => {
    if (!data || data.length < 14) return false;
    const leadingFw = isLikelyFirmwareVersion(data[0], data[1], data[2]);
    const embeddedFw = isLikelyFirmwareVersion(data[3], data[4], data[5]);
    const leadingSensor = isLikelySensorId(data[3]);
    const embeddedSensor = isLikelySensorId(data[6]);
    const leadingPreExtended = leadingFw && leadingSensor && isPreExtendedFirmwareVersion(data[0], data[1], data[2]);
    const embeddedExtended = embeddedFw && embeddedSensor && isExtendedLayoutFirmwareVersion(data[3], data[4], data[5]);
    if (leadingPreExtended) {
      return embeddedExtended && !hasPlausibleLegacyDeviceInfoLayout(data, {
        embeddedExtendedCandidate: true,
        includeNameEvidence: false
      });
    }
    if (embeddedExtended) return true;
    if (embeddedFw && embeddedSensor) return true;
    if (leadingFw && !embeddedFw) return false;
    if (!leadingFw && embeddedFw) return true;
    if (embeddedSensor && !leadingSensor) return true;
    if (!embeddedSensor && leadingSensor) return false;
    return embeddedFw && !leadingFw;
  };
  var decodeLedPayload = (data) => {
    if (!data || data.length < 3) return null;
    return { r: data[0], g: data[1], b: data[2] };
  };
  var decodeDeviceInfoPayload = (data) => {
    if (!data || data.length < 4) return null;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (isExtendedDeviceInfoPayload(data)) {
      const payload2 = {
        macTail: toMacTail2(data.slice(0, 3)),
        fwVersion: {
          major: data[3],
          minor: data[4],
          patch: data[5]
        },
        sensorId: data[6],
        intervalMs: readU32LE2(view, 7),
        led: {
          r: data[11],
          g: data[12],
          b: data[13]
        }
      };
      if (data.length > 14) {
        const deviceName = textDecoder.decode(data.slice(14)).replace(/\0+$/, "").trim();
        if (deviceName) {
          payload2.deviceName = deviceName;
        }
      }
      return payload2;
    }
    const payload = {
      macTail: null,
      fwVersion: {
        major: data[0],
        minor: data[1],
        patch: data[2]
      },
      sensorId: data[3],
      intervalMs: null,
      led: null
    };
    if (data.length >= 8) {
      payload.intervalMs = readU32LE2(view, 4);
    }
    if (data.length >= 11) {
      payload.led = {
        r: data[8],
        g: data[9],
        b: data[10]
      };
    }
    if (data.length > 11) {
      const deviceName = textDecoder.decode(data.slice(11)).replace(/\0+$/, "").trim();
      if (deviceName) {
        payload.deviceName = deviceName;
      }
    }
    return payload;
  };
  var decodeTimeSyncRttPayload = (data, receivedAtMs) => {
    if (!data || data.length !== 24) return null;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const t1 = Number(readU64LE2(view, 0));
    const t2 = Number(readU64LE2(view, 8));
    const t3 = Number(readU64LE2(view, 16));
    const t4 = Number(receivedAtMs);
    const roundTripMs = t4 - t1;
    const processingMs = t3 - t2;
    const delayMs = roundTripMs - processingMs;
    const offsetMs = (t2 - t1 + t3 - t4) / 2;
    return {
      t1,
      t2,
      t3,
      t4,
      roundTripMs,
      processingMs,
      delayMs,
      offsetMs
    };
  };

  // src/runtime/hubRuntime.ts
  var DEFAULT_DISPLAY_MS = 10;
  var DEFAULT_ROW_LIMIT = 3e3;
  var FLUSH_INTERVAL_MS = 30;
  var DEFAULT_RESPONSE_TIMEOUT_MS = 1200;
  var HubRuntime = class {
    constructor(options, writeLine) {
      this.devices = /* @__PURE__ */ new Map();
      this.usedDeviceLabels = /* @__PURE__ */ new Set();
      this.pendingResponses = /* @__PURE__ */ new Map();
      this.responseCommandLocks = /* @__PURE__ */ new Map();
      this.flushTimer = null;
      this.schemaEmitted = false;
      this.lastEmittedBucketIndex = Number.NEGATIVE_INFINITY;
      this.openState = false;
      this.openGeneration = 0;
      this.activeSensorConfig = null;
      this.options = options ?? {};
      this.writeLine = writeLine;
      this.bucketizer = new Bucketizer(this.options.displayMs ?? DEFAULT_DISPLAY_MS, this.options.rowLimit ?? DEFAULT_ROW_LIMIT);
      const defaultColumns = this.normalizeDefaultColumns(this.options.defaultColumns);
      this.schema = {
        columns: defaultColumns,
        version: defaultColumns.length > 0 ? 1 : 0,
        updatedAt: Date.now()
      };
    }
    async open() {
      if (this.openState) return;
      this.openState = true;
      const openGeneration = this.openGeneration;
      try {
        await this.connectMoreForGeneration(openGeneration);
      } catch (error) {
        this.openState = false;
        throw error;
      }
    }
    async connectMore() {
      await this.connectMoreForGeneration(this.openGeneration);
    }
    async connectMoreForGeneration(openGeneration) {
      this.assertSupported();
      if (this.devices.size >= MAX_CONNECTIONS) {
        throw new Error(`Maximum BLE connections reached (${MAX_CONNECTIONS}).`);
      }
      const filters = Array.isArray(this.options.filters) ? this.options.filters : [];
      const hasCustomFilters = filters.length > 0;
      const optionalServices = this.buildOptionalServices(filters);
      const requestOptions = hasCustomFilters ? {
        filters,
        ...optionalServices.length > 0 ? { optionalServices } : {}
      } : { acceptAllDevices: true, optionalServices };
      const device = await navigator.bluetooth.requestDevice(requestOptions);
      if (!this.openState || this.openGeneration !== openGeneration) {
        try {
          if (device.gatt?.connected) device.gatt.disconnect();
        } catch {
        }
        throw new Error("BLE open was closed before device attachment.");
      }
      if (this.devices.has(device.id)) return;
      await this.attachDevice(device, openGeneration);
    }
    async close() {
      this.openState = false;
      this.openGeneration += 1;
      this.clearFlushTimer();
      this.flushRows({ includeActive: true });
      const ids = Array.from(this.devices.keys());
      await Promise.all(ids.map((id) => this.detachDevice(id)));
      this.clearFlushTimer();
      this.flushRows({ includeActive: true });
    }
    async startAll() {
      await this.sendAll(CMD.START);
    }
    async setSensorAll(sensorId, intervalMs) {
      const { sid, itv, payload } = this.buildSetSensorPayload(sensorId, intervalMs);
      const results = await Promise.allSettled(
        Array.from(this.devices.values()).map(
          (ctx) => this.sendCmdAndWait(ctx, CMD.SET_SENSOR, CMD.RESP_SET_SENSOR, payload)
        )
      );
      const failed = results.find((result) => result.status === "rejected");
      if (failed) {
        if (results.some((result) => result.status === "fulfilled")) {
          this.flushBeforeOutputReset();
          this.resetOutputState();
          this.recomputeDisplayMs();
        }
        throw failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason));
      }
      this.activeSensorConfig = { sensorId: sid, intervalMs: itv };
      this.flushBeforeOutputReset();
      this.resetOutputState();
      this.recomputeDisplayMs();
    }
    async setSensor(deviceId, sensorId, intervalMs) {
      const ctx = this.devices.get(deviceId);
      if (!ctx) {
        throw new Error(`Unknown device id: ${deviceId}`);
      }
      const { payload } = this.buildSetSensorPayload(sensorId, intervalMs);
      await this.sendCmdAndWait(ctx, CMD.SET_SENSOR, CMD.RESP_SET_SENSOR, payload);
      this.flushBeforeOutputReset();
      this.resetOutputState();
      this.recomputeDisplayMs();
    }
    async setDeviceName(deviceId, name) {
      const ctx = this.devices.get(deviceId);
      if (!ctx) {
        throw new Error(`Unknown device id: ${deviceId}`);
      }
      const nextName = (name || "").trim();
      if (!nextName) {
        throw new Error("Device name is empty.");
      }
      const encoded = new TextEncoder().encode(nextName);
      if (encoded.length > 64) {
        throw new Error("Device name is too long (max 64 bytes UTF-8).");
      }
      await this.sendCmdAndWait(ctx, CMD.SET_NAME, CMD.RESP_SET_NAME, encoded);
      const updated = await this.requestDeviceInfo(deviceId);
      if (!updated || !updated.deviceName) {
        this.renameDeviceLabel(ctx, nextName);
        ctx.deviceName = nextName;
      }
    }
    async stopAll() {
      await this.sendAll(CMD.STOP);
      this.clearFlushTimer();
      this.flushRows({ includeActive: true });
    }
    async syncTimeAll() {
      await Promise.all(
        Array.from(this.devices.values()).map((ctx) => this.sendCmd(ctx, CMD.TIME_SYNC, buildTimeSyncPayload()))
      );
    }
    async requestDeviceInfo(deviceId) {
      const ctx = this.devices.get(deviceId);
      if (!ctx) {
        throw new Error(`Unknown device id: ${deviceId}`);
      }
      await this.sendCmdAndWait(ctx, CMD.GET_DEVICE_INFO, CMD.RESP_DEVICE_INFO);
      return this.toPublicDeviceInfo(ctx);
    }
    async setLed(deviceId, r, g, b) {
      const ctx = this.devices.get(deviceId);
      if (!ctx) {
        throw new Error(`Unknown device id: ${deviceId}`);
      }
      const payload = new Uint8Array([
        Math.max(0, Math.min(255, Math.round(Number(r) || 0))),
        Math.max(0, Math.min(255, Math.round(Number(g) || 0))),
        Math.max(0, Math.min(255, Math.round(Number(b) || 0)))
      ]);
      await this.sendCmdAndWait(ctx, CMD.SET_LED, CMD.RESP_SET_LED, payload);
    }
    async syncTimeAllWithRTT(options = {}) {
      const timeoutMs = Math.max(1, Number(options.timeoutMs) || DEFAULT_RESPONSE_TIMEOUT_MS);
      await Promise.all(
        Array.from(this.devices.values()).map((ctx) => {
          const sentAt = BigInt(Date.now());
          return this.sendCmdAndWait(
            ctx,
            CMD.TIME_SYNC_RTT,
            CMD.RESP_TIME_SYNC_RTT,
            u64le(sentAt),
            timeoutMs
          );
        })
      );
      return this.getDevices();
    }
    async scheduleStartAll(delayMs) {
      const delay = Number(delayMs);
      if (!Number.isFinite(delay)) {
        throw new Error("Invalid delay value.");
      }
      const target = BigInt(Date.now() + Math.max(0, Math.trunc(delay)));
      const payload = u64le(target);
      await Promise.all(
        Array.from(this.devices.values()).map(
          (ctx) => this.sendCmdAndWait(ctx, CMD.SCHEDULE_START, CMD.RESP_SCHEDULE_START, payload)
        )
      );
    }
    async scheduleCancelAll() {
      await Promise.all(
        Array.from(this.devices.values()).map(
          (ctx) => this.sendCmdAndWait(
            ctx,
            CMD.SCHEDULE_CANCEL,
            CMD.RESP_SCHEDULE_CANCEL,
            new Uint8Array(0)
          )
        )
      );
    }
    getSchema() {
      return {
        columns: [...this.schema.columns],
        version: this.schema.version,
        updatedAt: this.schema.updatedAt
      };
    }
    getDevices() {
      return Array.from(this.devices.values()).map((ctx) => this.toPublicDeviceInfo(ctx));
    }
    assertSupported() {
      if (typeof navigator === "undefined" || !navigator.bluetooth) {
        throw new Error("Web Bluetooth is not supported in this environment.");
      }
    }
    async attachDevice(device, openGeneration) {
      const server = await device.gatt?.connect();
      if (!server) {
        throw new Error("Failed to connect to BLE GATT server.");
      }
      const service = await server.getPrimaryService(SERVICE_UUID);
      const rxChar = await service.getCharacteristic(RX_UUID);
      const txChar = await service.getCharacteristic(TX_UUID);
      const parser = new FrameParser();
      const id = device.id || `${Date.now()}`;
      const deviceLabel = this.acquireDeviceLabel(device);
      const notifyHandler = (event) => {
        const value = event.target?.value;
        if (!value) return;
        const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        const ctx = this.devices.get(id);
        if (!ctx) return;
        parser.feed(bytes, (packet) => this.handlePacket(ctx, packet));
      };
      const disconnectHandler = () => {
        void this.detachDevice(id);
      };
      let notificationsStarted = false;
      let notifyListenerAttached = false;
      let disconnectListenerAttached = false;
      const cleanupUnregisteredDevice = async () => {
        if (notifyListenerAttached) {
          txChar.removeEventListener("characteristicvaluechanged", notifyHandler);
        }
        if (disconnectListenerAttached) {
          device.removeEventListener("gattserverdisconnected", disconnectHandler);
        }
        if (notificationsStarted) {
          const stoppableTxChar = txChar;
          try {
            if (typeof stoppableTxChar.stopNotifications === "function") {
              await stoppableTxChar.stopNotifications();
            }
          } catch {
          }
        }
        this.usedDeviceLabels.delete(deviceLabel);
        try {
          if (device.gatt?.connected) device.gatt.disconnect();
        } catch {
        }
      };
      try {
        await txChar.startNotifications();
        notificationsStarted = true;
        txChar.addEventListener("characteristicvaluechanged", notifyHandler);
        notifyListenerAttached = true;
        device.addEventListener("gattserverdisconnected", disconnectHandler);
        disconnectListenerAttached = true;
      } catch (error) {
        await cleanupUnregisteredDevice();
        throw error;
      }
      if (openGeneration !== void 0 && (!this.openState || this.openGeneration !== openGeneration)) {
        await cleanupUnregisteredDevice();
        throw new Error("BLE open was closed before device attachment.");
      }
      if (this.devices.has(id)) {
        await cleanupUnregisteredDevice();
        return;
      }
      if (this.devices.size >= MAX_CONNECTIONS) {
        await cleanupUnregisteredDevice();
        throw new Error(`Maximum BLE connections reached (${MAX_CONNECTIONS}).`);
      }
      const context = {
        id,
        deviceLabel,
        device,
        parser,
        rxChar,
        txChar,
        notifyHandler,
        disconnectHandler,
        lastSampleTimestampMs: null,
        macTail: null,
        intervalMs: null,
        sensorId: null,
        fwVersion: null,
        led: null,
        deviceName: null,
        sensorFault: null,
        lastTimeSyncRtt: null
      };
      this.devices.set(id, context);
      try {
        await this.sendCmd(context, CMD.TIME_SYNC, buildTimeSyncPayload());
        await this.requestDeviceInfo(id);
        if (this.activeSensorConfig) {
          const { payload } = this.buildSetSensorPayload(
            this.activeSensorConfig.sensorId,
            this.activeSensorConfig.intervalMs
          );
          await this.sendCmdAndWait(context, CMD.SET_SENSOR, CMD.RESP_SET_SENSOR, payload);
        }
      } catch (error) {
        await this.detachDevice(id);
        throw error;
      }
    }
    async detachDevice(id) {
      const ctx = this.devices.get(id);
      if (!ctx) return;
      this.devices.delete(id);
      this.usedDeviceLabels.delete(ctx.deviceLabel);
      this.rejectPendingResponsesForDevice(id, new Error(`Device disconnected: ${id}`));
      try {
        ctx.txChar.removeEventListener("characteristicvaluechanged", ctx.notifyHandler);
        ctx.device.removeEventListener("gattserverdisconnected", ctx.disconnectHandler);
        if (ctx.device.gatt?.connected) {
          ctx.device.gatt.disconnect();
        }
      } catch {
      }
      this.recomputeDisplayMs();
    }
    async sendAll(cmd, payload) {
      await Promise.all(Array.from(this.devices.values()).map((ctx) => this.sendCmd(ctx, cmd, payload)));
    }
    responseKey(deviceId, responseCmd) {
      return `${deviceId}:${responseCmd}`;
    }
    waitForResponse(deviceId, responseCmd, timeoutMs = DEFAULT_RESPONSE_TIMEOUT_MS, waitId = Symbol(`wait:${deviceId}:${responseCmd}`)) {
      return new Promise((resolve, reject) => {
        const key = this.responseKey(deviceId, responseCmd);
        const wrappedResolve = (packet) => resolve(packet);
        const timer = window.setTimeout(() => {
          const queue2 = this.pendingResponses.get(key) || [];
          const filtered = queue2.filter((entry) => entry.resolve !== wrappedResolve);
          if (filtered.length > 0) this.pendingResponses.set(key, filtered);
          else this.pendingResponses.delete(key);
          reject(new Error(`Timeout waiting for response 0x${responseCmd.toString(16)} from ${deviceId}`));
        }, timeoutMs);
        const queue = this.pendingResponses.get(key) || [];
        queue.push({
          waitId,
          resolve: wrappedResolve,
          reject,
          timer
        });
        this.pendingResponses.set(key, queue);
      });
    }
    resolvePendingResponse(deviceId, packet) {
      const key = this.responseKey(deviceId, packet.cmd);
      const queue = this.pendingResponses.get(key);
      if (!queue || queue.length === 0) return;
      const entry = queue.shift();
      if (queue.length > 0) this.pendingResponses.set(key, queue);
      else this.pendingResponses.delete(key);
      if (!entry) return;
      window.clearTimeout(entry.timer);
      if (packet.result !== 0) {
        entry.reject(
          new Error(
            `BLE response 0x${packet.cmd.toString(16)} from ${deviceId} failed with result 0x${packet.result.toString(16)}.`
          )
        );
        return;
      }
      entry.resolve(packet);
    }
    cancelPendingResponse(deviceId, responseCmd, waitId) {
      const key = this.responseKey(deviceId, responseCmd);
      const queue = this.pendingResponses.get(key);
      if (!queue || queue.length === 0) return;
      const filtered = queue.filter((entry) => entry.waitId !== waitId);
      queue.filter((entry) => entry.waitId === waitId).forEach((entry) => window.clearTimeout(entry.timer));
      if (filtered.length > 0) this.pendingResponses.set(key, filtered);
      else this.pendingResponses.delete(key);
    }
    rejectPendingResponsesForDevice(deviceId, error) {
      const prefix = `${deviceId}:`;
      for (const [key, queue] of this.pendingResponses.entries()) {
        if (!key.startsWith(prefix)) continue;
        this.pendingResponses.delete(key);
        queue.forEach((entry) => {
          window.clearTimeout(entry.timer);
          entry.reject(error);
        });
      }
    }
    async withResponseCommandLock(deviceId, responseCmd, run) {
      const key = this.responseKey(deviceId, responseCmd);
      const previous = this.responseCommandLocks.get(key) ?? Promise.resolve();
      let release = () => {
      };
      const current = previous.catch(() => {
      }).then(
        () => new Promise((resolve) => {
          release = resolve;
        })
      );
      this.responseCommandLocks.set(key, current);
      await previous.catch(() => {
      });
      try {
        return await run();
      } finally {
        release();
        if (this.responseCommandLocks.get(key) === current) {
          this.responseCommandLocks.delete(key);
        }
      }
    }
    async sendCmd(ctx, cmd, payload) {
      const packet = buildRequest(cmd, payload);
      const bytes = new Uint8Array(packet.byteLength);
      bytes.set(packet);
      if (ctx.rxChar.writeValueWithoutResponse) {
        await ctx.rxChar.writeValueWithoutResponse(bytes);
        return;
      }
      await ctx.rxChar.writeValue(bytes);
    }
    async sendCmdAndWait(ctx, cmd, responseCmd, payload, timeoutMs = DEFAULT_RESPONSE_TIMEOUT_MS) {
      return await this.withResponseCommandLock(ctx.id, responseCmd, async () => {
        const waitId = Symbol(`wait:${ctx.id}:${responseCmd}`);
        const wait = this.waitForResponse(ctx.id, responseCmd, timeoutMs, waitId);
        wait.catch(() => {
        });
        try {
          await this.sendCmd(ctx, cmd, payload);
        } catch (error) {
          this.cancelPendingResponse(ctx.id, responseCmd, waitId);
          throw error;
        }
        return await wait;
      });
    }
    handlePacket(ctx, packet) {
      if (packet.pv !== PROTOCOL_VERSION) return;
      if (packet.kind === "response") {
        this.resolvePendingResponse(ctx.id, packet);
        if (packet.result === 0) {
          this.handleResponse(ctx, packet);
        }
        return;
      }
      if (packet.cmd === CMD.SAMPLE) {
        const decoded = decodeSamplePayload(packet.data, ctx.lastSampleTimestampMs);
        ctx.lastSampleTimestampMs = decoded.lastTimestampMs;
        decoded.samples.forEach((sample) => this.onSample(ctx, sample));
        return;
      }
      if (packet.cmd === CMD.BURST) {
        const decoded = decodeBurstPayload(packet.data, ctx.lastSampleTimestampMs, ctx.intervalMs);
        ctx.lastSampleTimestampMs = decoded.lastTimestampMs;
        decoded.samples.forEach((sample) => this.onSample(ctx, sample));
        return;
      }
      if (packet.cmd === CMD.SENSOR_ERROR) {
        ctx.sensorFault = {
          sensorId: packet.data?.[0] ?? null,
          at: Date.now()
        };
      }
    }
    handleResponse(ctx, packet) {
      const { cmd, data } = packet;
      if (cmd === CMD.RESP_DEVICE_INFO) {
        const info = decodeDeviceInfoPayload(data);
        if (!info) return;
        this.applyDeviceInfo(ctx, info);
        if (Number.isFinite(info.intervalMs)) {
          ctx.intervalMs = Number(info.intervalMs);
          this.recomputeDisplayMs();
        }
        return;
      }
      if (cmd === CMD.RESP_SET_SENSOR) {
        const sensor = decodeSetSensorPayload(data);
        if (!sensor) return;
        ctx.intervalMs = sensor.intervalMs;
        this.recomputeDisplayMs();
        ctx.sensorId = sensor.sensorId;
        return;
      }
      if (cmd === CMD.RESP_SET_LED) {
        const led = decodeLedPayload(data);
        if (led) {
          ctx.led = led;
        }
        return;
      }
      if (cmd === CMD.RESP_TIME_SYNC_RTT) {
        const rtt = decodeTimeSyncRttPayload(data, Date.now());
        if (rtt) {
          ctx.lastTimeSyncRtt = rtt;
        }
      }
    }
    onSample(ctx, sample) {
      if (ctx.sensorFault) {
        ctx.sensorFault = null;
      }
      const deviceKey = resolveStableDeviceKey({
        id: ctx.id,
        macTail: sample.macTail ?? ctx.macTail
      });
      this.bucketizer.ingest(deviceKey, sample);
      this.scheduleFlush();
    }
    applyDeviceInfo(ctx, info) {
      ctx.macTail = info.macTail;
      ctx.fwVersion = info.fwVersion;
      ctx.sensorId = info.sensorId;
      ctx.led = info.led;
      ctx.deviceName = info.deviceName ?? ctx.deviceName;
      if (info.deviceName) {
        this.renameDeviceLabel(ctx, info.deviceName);
      }
    }
    toPublicDeviceInfo(ctx) {
      return {
        id: ctx.id,
        label: ctx.deviceLabel,
        bluetoothName: ctx.device.name ?? null,
        macTail: ctx.macTail,
        deviceName: ctx.deviceName,
        fwVersion: ctx.fwVersion,
        sensorId: ctx.sensorId,
        intervalMs: Number.isFinite(ctx.intervalMs) ? ctx.intervalMs : null,
        led: ctx.led,
        sensorFault: ctx.sensorFault,
        lastTimeSyncRtt: ctx.lastTimeSyncRtt
      };
    }
    acquireDeviceLabel(device) {
      const rawName = typeof device.name === "string" ? device.name : "";
      const sanitized = this.sanitizeDeviceLabel(rawName);
      const fallback = `Device-${this.devices.size + 1}`;
      const base = sanitized.length > 0 ? sanitized : fallback;
      return this.claimUniqueLabel(base);
    }
    sanitizeDeviceLabel(label) {
      return label.replace(/[\r\n,]+/g, " ").replace(/:+/g, "-").replace(/\s+/g, " ").trim();
    }
    renameDeviceLabel(ctx, requestedName) {
      const sanitized = this.sanitizeDeviceLabel(requestedName);
      if (!sanitized) return;
      if (ctx.deviceLabel === sanitized) return;
      this.usedDeviceLabels.delete(ctx.deviceLabel);
      ctx.deviceLabel = this.claimUniqueLabel(sanitized);
    }
    claimUniqueLabel(base) {
      let candidate = base;
      let suffix = 2;
      while (this.usedDeviceLabels.has(candidate)) {
        candidate = `${base}#${suffix}`;
        suffix += 1;
      }
      this.usedDeviceLabels.add(candidate);
      return candidate;
    }
    recomputeDisplayMs() {
      const intervals = Array.from(this.devices.values()).map((ctx) => ctx.intervalMs).filter((interval) => Number.isFinite(interval) && Number(interval) > 0);
      const next = intervals.length > 0 ? Math.max(...intervals) : DEFAULT_DISPLAY_MS;
      const current = this.bucketizer.getDisplayMs();
      if (next !== current) {
        this.clearFlushTimer();
        this.flushRows({ includeActive: true });
        this.bucketizer.setDisplayMs(next);
        this.lastEmittedBucketIndex = Number.NEGATIVE_INFINITY;
      }
    }
    scheduleFlush() {
      if (this.flushTimer !== null) return;
      this.flushTimer = window.setTimeout(() => {
        this.flushTimer = null;
        this.flushRows();
      }, FLUSH_INTERVAL_MS);
    }
    clearFlushTimer() {
      if (this.flushTimer === null) return;
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    flushRows(options = {}) {
      const snapshot = this.bucketizer.snapshot();
      if (snapshot.columns.length === 0 || snapshot.rows.length === 0) return;
      const rows = options.includeActive ? snapshot.rows : snapshot.rows.slice(0, -1);
      const columnsChanged = !this.sameColumns(snapshot.columns, this.schema.columns);
      if (columnsChanged) {
        this.schema.columns = [...snapshot.columns];
        this.schema.version += 1;
        this.schema.updatedAt = Date.now();
        const replayRow = rows[rows.length - 1];
        if (replayRow && options.includeActive) {
          this.lastEmittedBucketIndex = Math.min(this.lastEmittedBucketIndex, replayRow.bucketIndex - 1);
        }
      }
      if (!this.schemaEmitted || columnsChanged) {
        this.writeLine(`@schema,${this.schema.version},${this.schema.columns.join(",")}
`);
        this.schemaEmitted = true;
      }
      for (const row of rows) {
        if (row.bucketIndex <= this.lastEmittedBucketIndex) continue;
        const values = snapshot.columns.map((column) => {
          const value = row.cells[column]?.value;
          return Number.isFinite(value) ? String(value) : "NaN";
        });
        this.writeLine(`${row.timestampMs},${values.join(",")}
`);
        this.lastEmittedBucketIndex = row.bucketIndex;
      }
    }
    resetOutputState() {
      this.bucketizer.reset();
      this.schema.columns = [];
      this.schema.updatedAt = Date.now();
      this.schemaEmitted = false;
      this.lastEmittedBucketIndex = Number.NEGATIVE_INFINITY;
    }
    flushBeforeOutputReset() {
      this.clearFlushTimer();
      this.flushRows({ includeActive: true });
    }
    sameColumns(next, current) {
      if (next.length !== current.length) return false;
      return next.every((column, index) => column === current[index]);
    }
    normalizeDefaultColumns(columns) {
      if (!Array.isArray(columns)) return [];
      const seen = /* @__PURE__ */ new Set();
      const normalized = [];
      for (const column of columns) {
        const value = String(column ?? "").trim();
        if (!value || seen.has(value)) continue;
        seen.add(value);
        normalized.push(value);
      }
      return normalized;
    }
    buildOptionalServices(filters) {
      const customOptionalServices = Array.isArray(this.options.optionalServices) ? this.options.optionalServices : [];
      const optionalServices = [...customOptionalServices];
      const filterServices = filters.flatMap(
        (filter) => Array.isArray(filter.services) ? filter.services : []
      );
      if (!this.includesService(filterServices, SERVICE_UUID) && !this.includesService(optionalServices, SERVICE_UUID)) {
        optionalServices.push(SERVICE_UUID);
      }
      return optionalServices;
    }
    includesService(services, serviceUuid) {
      return services.some((service) => String(service).toLowerCase() === String(serviceUuid).toLowerCase());
    }
    buildSetSensorPayload(sensorId, intervalMs) {
      const sid = Number(sensorId);
      const itv = Number(intervalMs);
      if (!Number.isInteger(sid) || sid < 0 || sid > 255) {
        throw new Error("Invalid sensorId value.");
      }
      if (!Number.isInteger(itv) || itv < 0 || itv > 4294967295) {
        throw new Error("Invalid intervalMs value.");
      }
      const payload = new Uint8Array(5);
      payload[0] = sid;
      payload.set(u32le(itv), 1);
      return { sid, itv, payload };
    }
  };

  // src/index.ts
  var HubPort = class {
    constructor(options) {
      this.controller = null;
      this.opened = false;
      this.closed = false;
      this.openPromise = null;
      this.readable = new ReadableStream({
        start: (controller) => {
          this.controller = controller;
        },
        cancel: () => {
          this.controller = null;
        }
      });
      this.runtime = new HubRuntime(options, (line) => this.controller?.enqueue(line));
    }
    async open(_options) {
      if (this.closed) {
        throw new Error("Hub port is closed and cannot be reopened.");
      }
      if (this.opened) return;
      if (this.openPromise) {
        await this.openPromise;
        return;
      }
      const openPromise = this.runtime.open().then(() => {
        this.opened = true;
      }).finally(() => {
        if (this.openPromise === openPromise) {
          this.openPromise = null;
        }
      });
      this.openPromise = openPromise;
      await openPromise;
    }
    async connectMore(_options) {
      this.ensureOpen();
      await this.runtime.connectMore();
    }
    async close() {
      if (this.closed) return;
      this.closed = true;
      this.opened = false;
      await this.runtime.close();
      this.controller?.close();
      this.controller = null;
    }
    async startAll() {
      this.ensureOpen();
      await this.runtime.startAll();
    }
    async setDeviceName(deviceId, name) {
      this.ensureOpen();
      await this.runtime.setDeviceName(deviceId, name);
    }
    async requestDeviceInfo(deviceId) {
      this.ensureOpen();
      return await this.runtime.requestDeviceInfo(deviceId);
    }
    async setSensorAll(sensorId, intervalMs) {
      this.ensureOpen();
      await this.runtime.setSensorAll(sensorId, intervalMs);
    }
    async setSensor(deviceId, sensorId, intervalMs) {
      this.ensureOpen();
      await this.runtime.setSensor(deviceId, sensorId, intervalMs);
    }
    async setLed(deviceId, r, g, b) {
      this.ensureOpen();
      await this.runtime.setLed(deviceId, r, g, b);
    }
    async stopAll() {
      this.ensureOpen();
      await this.runtime.stopAll();
    }
    async syncTimeAll() {
      this.ensureOpen();
      await this.runtime.syncTimeAll();
    }
    async syncTimeAllWithRTT(options) {
      this.ensureOpen();
      return await this.runtime.syncTimeAllWithRTT(options);
    }
    async scheduleStartAll(delayMs) {
      this.ensureOpen();
      await this.runtime.scheduleStartAll(delayMs);
    }
    async scheduleCancelAll() {
      this.ensureOpen();
      await this.runtime.scheduleCancelAll();
    }
    getDevices() {
      return this.runtime.getDevices();
    }
    getSchema() {
      return this.runtime.getSchema();
    }
    ensureOpen() {
      if (!this.opened || this.closed) {
        throw new Error("Hub port is not open. Call open() first.");
      }
    }
  };
  var EzonBleNamespace = class {
    constructor(options) {
      this.defaultRequestOptions = {
        displayMs: 10,
        rowLimit: 3e3,
        defaultColumns: options?.defaultColumns
      };
    }
    async requestPort(options) {
      const merged = {
        ...this.defaultRequestOptions,
        ...options
      };
      return new HubPort(merged);
    }
  };
  var resolveNavigator = () => {
    if (typeof navigator === "undefined") {
      throw new Error("navigator is not available in this environment.");
    }
    return navigator;
  };
  var install = (options) => {
    const nav = resolveNavigator();
    if (nav.ezonBle) return nav.ezonBle;
    const namespace = new EzonBleNamespace(options);
    Object.defineProperty(nav, "ezonBle", {
      configurable: true,
      enumerable: false,
      writable: false,
      value: namespace
    });
    return namespace;
  };
  var ezonBle = { install };
  return __toCommonJS(index_exports);
})();
