import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.join(__dirname, '..', '.slack-config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export class ConfigManager {
  constructor() {
    this.config = {};
  }

  async ensureConfigDir() {
    try {
      await fs.mkdir(CONFIG_DIR, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  async load() {
    try {
      await this.ensureConfigDir();
      const data = await fs.readFile(CONFIG_FILE, 'utf8');
      this.config = JSON.parse(data);
      return this.config;
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Config file doesn't exist, return empty config
        this.config = {};
        return this.config;
      }
      throw error;
    }
  }

  async save() {
    await this.ensureConfigDir();
    await fs.writeFile(CONFIG_FILE, JSON.stringify(this.config, null, 2));
  }

  get(key, defaultValue = null) {
    return this.config[key] || defaultValue;
  }

  set(key, value) {
    this.config[key] = value;
  }

  setAuth(token, tokenType = 'bot') {
    this.config.auth = {
      token,
      tokenType,
      createdAt: new Date().toISOString()
    };
  }

  getAuth() {
    return this.config.auth || null;
  }

  setWorkspaces(workspaces) {
    this.config.workspaces = workspaces;
  }

  getWorkspaces() {
    return this.config.workspaces || [];
  }

  setSelectedWorkspaces(workspaceIds) {
    this.config.selectedWorkspaces = workspaceIds;
  }

  getSelectedWorkspaces() {
    return this.config.selectedWorkspaces || [];
  }

  setAppInfo(appInfo) {
    this.config.appInfo = appInfo;
  }

  getAppInfo() {
    return this.config.appInfo || null;
  }

  isConfigured() {
    return !!(this.config.auth && this.config.auth.token);
  }

  async reset() {
    this.config = {};
    try {
      await fs.unlink(CONFIG_FILE);
    } catch (error) {
      // Ignore if file doesn't exist
    }
  }

  getConfigPath() {
    return CONFIG_FILE;
  }
}