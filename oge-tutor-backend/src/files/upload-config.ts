import { ConfigService } from '@nestjs/config';
import path from 'node:path';

export function uploadDirectory(config: ConfigService) {
  return path.resolve(process.cwd(), config.get<string>('UPLOAD_DIR') || 'uploads');
}

export function uploadLimit(config: ConfigService) {
  const value = Number(config.get('MAX_UPLOAD_BYTES') ?? 15 * 1024 * 1024);
  if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) {
    throw new Error('MAX_UPLOAD_BYTES must be a positive integer no greater than 2147483647.');
  }
  return value;
}
