import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export class JsonStore {
  constructor(filePath = process.env.FARMBRIDGE_STATE || path.join(os.homedir(), '.farmbridge', 'state.json')) {
    this.filePath = filePath;
  }

  async read() {
    try {
      return JSON.parse(await fs.readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return { jobs: [] };
      throw error;
    }
  }

  async write(data) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    await fs.writeFile(temp, JSON.stringify(data, null, 2));
    await fs.rename(temp, this.filePath);
  }
}
