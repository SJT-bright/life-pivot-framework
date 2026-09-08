export class WriteBarrier {
  private activeWrites = 0;
  private backupInProgress = false;
  private drainedWaiters: Array<() => void> = [];

  async runWrite<T>(action: () => Promise<T> | T): Promise<T> {
    if (this.backupInProgress) {
      throw new Error("系统正在备份，请稍后再保存");
    }

    this.activeWrites += 1;
    try {
      return await action();
    } finally {
      this.activeWrites -= 1;
      if (this.activeWrites === 0) {
        const waiters = this.drainedWaiters.splice(0);
        for (const resolve of waiters) resolve();
      }
    }
  }

  async runBackup<T>(action: () => Promise<T> | T): Promise<T> {
    if (this.backupInProgress) {
      throw new Error("已有备份正在进行");
    }

    this.backupInProgress = true;
    try {
      if (this.activeWrites > 0) {
        await new Promise<void>((resolve) => this.drainedWaiters.push(resolve));
      }
      return await action();
    } finally {
      this.backupInProgress = false;
    }
  }
}

export const applicationWriteBarrier = new WriteBarrier();
