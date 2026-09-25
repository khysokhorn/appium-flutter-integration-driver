import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { JsonStore } from '../storage/jsonStore.js';

const MAX_MEDIA_BYTES = 500 * 1024 * 1024;
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v']);
const DEFAULT_DIR = path.join(os.homedir(), '.farmbridge');

export class Studio {
  constructor({ deviceManager, statePath = process.env.FARMBRIDGE_STUDIO_STATE || path.join(DEFAULT_DIR, 'studio.json'), mediaDir = process.env.FARMBRIDGE_MEDIA_DIR || path.join(DEFAULT_DIR, 'media') }) {
    this.deviceManager = deviceManager;
    this.store = new JsonStore(statePath);
    this.mediaDir = mediaDir;
    this.state = { accounts: [], media: [], reels: [] };
    this.inFlight = new Set();
    this.saveChain = Promise.resolve();
  }

  async start() {
    const state = await this.store.read();
    this.state = { accounts: state.accounts || [], media: state.media || [], reels: state.reels || [] };
    for (const reel of this.state.reels) {
      if (reel.status === 'preparing') reel.status = 'scheduled';
    }
    await this.save();
    this.timer = setInterval(() => this.tick().catch(console.error), 1000);
    this.timer.unref?.();
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  listAccounts() { return this.state.accounts; }
  listMedia() { return this.state.media.map(({ filePath, ...media }) => media); }
  listReels() { return this.state.reels; }

  save() {
    this.saveChain = this.saveChain.catch(() => {}).then(() => this.store.write(this.state));
    return this.saveChain;
  }

  async addAccount({ name, deviceId, appId }) {
    if (typeof name !== 'string' || !name.trim() || typeof appId !== 'string' || !appId.trim()) throw new Error('Account name and app ID are required');
    const { bridge } = this.deviceManager.bridgeFor(deviceId);
    const account = { id: crypto.randomUUID(), name: name.trim(), deviceId, platform: bridge.platform, appId: appId.trim(), createdAt: new Date().toISOString() };
    this.state.accounts.push(account);
    await this.save();
    return account;
  }

  async upload(req, filename) {
    const name = typeof filename === 'string' ? path.basename(filename).trim() : '';
    const ext = path.extname(name).toLowerCase();
    if (!name || !VIDEO_EXTENSIONS.has(ext)) throw new Error('Choose an MP4, MOV, or M4V video');
    const id = crypto.randomUUID();
    const filePath = path.join(this.mediaDir, id + ext);
    let bytes = 0;
    await fs.mkdir(this.mediaDir, { recursive: true });
    try {
      await pipeline(req, new Transform({
        transform(chunk, _encoding, callback) {
          bytes += chunk.length;
          callback(bytes > MAX_MEDIA_BYTES ? new Error('Video exceeds the 500 MB limit') : null, chunk);
        },
      }), createWriteStream(filePath, { flags: 'wx', mode: 0o600 }));
      if (bytes === 0) throw new Error('Video is empty');
      const media = { id, name, size: bytes, filePath, createdAt: new Date().toISOString() };
      this.state.media.push(media);
      await this.save();
      const { filePath: _internal, ...publicMedia } = media;
      return publicMedia;
    } catch (error) {
      await fs.unlink(filePath).catch(() => {});
      throw error;
    }
  }

  async addReel({ accountId, mediaId, caption = '', scheduledAt = null }) {
    if (!this.state.accounts.some(x => x.id === accountId)) throw new Error('Unknown account');
    if (!this.state.media.some(x => x.id === mediaId)) throw new Error('Unknown video');
    if (typeof caption !== 'string' || caption.length > 5000) throw new Error('Caption must be at most 5000 characters');
    const due = scheduledAt ? new Date(scheduledAt) : null;
    if (scheduledAt && (Number.isNaN(due.getTime()) || due.getTime() <= Date.now())) throw new Error('Choose a future schedule time');
    const reel = { id: crypto.randomUUID(), accountId, mediaId, caption, scheduledAt: due?.toISOString() || null, status: due ? 'scheduled' : 'draft', lastError: null, createdAt: new Date().toISOString() };
    this.state.reels.push(reel);
    await this.save();
    return reel;
  }

  async prepare(id) {
    const reel = this.state.reels.find(x => x.id === id);
    if (!reel) throw new Error('Unknown Reel');
    if (this.inFlight.has(id)) throw new Error('Reel is already being prepared');
    if (!['draft', 'scheduled', 'failed'].includes(reel.status)) throw new Error('Reel is already ready');
    const account = this.state.accounts.find(x => x.id === reel.accountId);
    const media = this.state.media.find(x => x.id === reel.mediaId);
    if (!account || !media) throw new Error('Reel account or video is missing');
    this.inFlight.add(id);
    reel.status = 'preparing';
    reel.lastError = null;
    try {
      await this.save();
      const { bridge, rawId } = this.deviceManager.bridgeFor(account.deviceId);
      if (bridge.platform === 'android') {
        const remotePath = `/sdcard/Movies/FarmBridge/${media.id}${path.extname(media.name).toLowerCase()}`;
        await bridge.pushFile(rawId, media.filePath, remotePath);
        await bridge.scanMedia(rawId, remotePath);
        await bridge.launchApp(rawId, account.appId);
        reel.remotePath = remotePath;
        reel.status = 'ready';
      } else {
        // Appium can open the app, but it cannot import an arbitrary local video
        // into Photos on a physical iPhone. Keep this state explicit.
        reel.status = 'needs_ios_import';
      }
      reel.preparedAt = new Date().toISOString();
    } catch (error) {
      reel.status = 'failed';
      reel.lastError = error.message;
    } finally {
      this.inFlight.delete(id);
      await this.save();
    }
    return reel;
  }

  async tick(now = Date.now()) {
    for (const reel of this.state.reels) {
      if (reel.status === 'scheduled' && new Date(reel.scheduledAt).getTime() <= now && !this.inFlight.has(reel.id)) await this.prepare(reel.id);
    }
  }

  async confirmIosImport(id) {
    const reel = this.state.reels.find(x => x.id === id);
    if (!reel || reel.status !== 'needs_ios_import') throw new Error('Reel is not waiting for an iOS video import');
    const account = this.state.accounts.find(x => x.id === reel.accountId);
    if (!account) throw new Error('Reel account is missing');
    const { bridge, rawId } = this.deviceManager.bridgeFor(account.deviceId);
    if (bridge.platform !== 'ios') throw new Error('This account is not on iOS');
    await bridge.launchApp(rawId, account.appId);
    reel.status = 'ready';
    reel.lastError = null;
    await this.save();
    return reel;
  }
}
