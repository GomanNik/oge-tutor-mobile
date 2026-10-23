import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import multer from 'multer';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { lastValueFrom, of } from 'rxjs';
import { validationError } from '../common/app-error';
import { uploadDirectory, uploadLimit } from './upload-config';

@Injectable()
export class StreamingUploadInterceptor implements NestInterceptor {
  constructor(private readonly config: ConfigService) {}

  async intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const maxBytes = uploadLimit(this.config);
    const tempRoot = path.join(uploadDirectory(this.config), '.tmp');
    await mkdir(tempRoot, { recursive: true });
    const tempDir = await mkdtemp(path.join(tempRoot, 'upload-'));
    const writes: Promise<void>[] = [];
    const storage: multer.StorageEngine = {
      _handleFile(req, file, callback) {
        const destination = path.join(tempDir, randomUUID());
        const output = createWriteStream(destination, { flags: 'wx', mode: 0o600 });
        file.path = destination;
        const abort = () => output.destroy(new Error('Upload aborted'));
        req.once('aborted', abort);
        if (req.aborted) abort();
        const write = pipeline(file.stream, output).then(
          () => { callback(null, { path: destination, size: output.bytesWritten }); },
          (error) => { callback(error); },
        ).finally(() => { req.off('aborted', abort); });
        writes.push(write);
      },
      _removeFile(_req, file, callback) {
        unlink(file.path).then(() => callback(null), (error) => callback(error.code === 'ENOENT' ? null : error));
      },
    };
    try {
      await new Promise<void>((resolve, reject) => {
        multer({
          storage,
          limits: { fileSize: maxBytes, files: 1, fields: 8, parts: 9, fieldSize: 16 * 1024, fieldNameSize: 100 },
        }).single('file')(request, response, (error: unknown) => error ? reject(error) : resolve());
      });
      return of(await lastValueFrom(next.handle()));
    } catch (error) {
      if (error instanceof multer.MulterError) {
        throw validationError('Upload rejected.', { file: error.code === 'LIMIT_FILE_SIZE' ? 'too_large' : 'invalid_upload' });
      }
      throw error;
    } finally {
      // Wait for disk handles to close, including interrupted multipart requests.
      await Promise.allSettled(writes);
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}
