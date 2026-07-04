import { Logger } from '@nestjs/common';
import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import IORedis, { Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

// Socket.IO adapter backed by Redis pub/sub, so a channel-room broadcast emitted
// on one API instance reaches sockets connected to OTHER instances. Without this
// every realtime broadcast would be confined to the process that handled the
// write. Built from REDIS_URL (the same env the BullMQ connection uses).
//
// Connecting is OPT-IN at boot (see main.ts): if connectToRedis() is never
// called, createIOServer falls back to the default in-memory adapter, which is
// fine for a single instance / local dev.
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;

  constructor(app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const url = process.env.REDIS_URL;
    if (!url) {
      // Caller guards on this too, but be defensive: no URL => no Redis adapter.
      throw new Error('REDIS_URL is not set');
    }
    const pubClient = new IORedis(url);
    const subClient = pubClient.duplicate();
    // Surface connection errors instead of letting them go unhandled.
    pubClient.on('error', (err) =>
      this.logger.error(`Redis pub error: ${err.message}`),
    );
    subClient.on('error', (err) =>
      this.logger.error(`Redis sub error: ${err.message}`),
    );
    this.pubClient = pubClient;
    this.subClient = subClient;
    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server: Server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
