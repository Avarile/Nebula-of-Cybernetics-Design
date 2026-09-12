import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HealthIndicatorService,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { Client } from 'minio';
import type { StorageConfig } from '../../config/configurations/storage.config';
import { MINIO_CLIENT } from '../file-manage/minio.constants';

/**
 * Terminus health indicator that checks the app bucket exists on MinIO.
 * Mirrors the Database / Redis indicators.
 */
@Injectable()
export class MinioHealthIndicator {
  private readonly bucket: string;

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(MINIO_CLIENT) private readonly client: Client,
    config: ConfigService,
  ) {
    this.bucket = config.getOrThrow<StorageConfig>('storage').bucket;
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    try {
      const exists = await this.client.bucketExists(this.bucket);
      return exists
        ? indicator.up()
        : indicator.down({ message: `bucket "${this.bucket}" not found` });
    } catch (error) {
      return indicator.down({ message: (error as Error).message });
    }
  }
}
