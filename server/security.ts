import { randomBytes } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';

export function createSessionToken(): string {
  return randomBytes(32).toString('hex');
}

export function localRequestGuard(port: number, token: string) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origins = new Set([...hosts].map((host) => `http://${host}`));
  return (req: Request, res: Response, next: NextFunction) => {
    if (!hosts.has(req.headers.host ?? '')) {
      res.status(403).json({ error: '只接受本地控制台请求。' });
      return;
    }
    const origin = req.headers.origin;
    if ((origin && !origins.has(origin)) || req.headers['sec-fetch-site'] === 'cross-site') {
      res.status(403).json({ error: '请求来源不匹配。' });
      return;
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (!origin || !origins.has(origin) || req.headers['x-define-pretty-token'] !== token) {
        res.status(403).json({ error: '会话已失效，请刷新控制台。' });
        return;
      }
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  };
}

export function previewCsp(consolePort: number) {
  return [
      "default-src 'none'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "sandbox allow-scripts",
      `frame-ancestors http://127.0.0.1:${consolePort} http://localhost:${consolePort}`,
    ].join('; ');
}

export function previewHeaders(consolePort: number) {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Content-Security-Policy', previewCsp(consolePort));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    next();
  };
}

export const SAFE_ID = /^[a-zA-Z0-9_-]{1,100}$/;

export function requireSafeId(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw Object.assign(new Error('无效的记录 ID。'), { status: 400 });
  }
  return value;
}

/** Resolve only ordinary files below base; symlinks are never followed. */
export async function safeFilePath(base: string, relative: string): Promise<string> {
  if (!relative || relative.includes('\0') || relative.includes('\\') || path.isAbsolute(relative)) {
    throw Object.assign(new Error('无效的文件路径。'), { status: 400 });
  }
  const segments = relative.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.startsWith('.'))) {
    throw Object.assign(new Error('无效的文件路径。'), { status: 400 });
  }
  const baseInfo = await lstat(base);
  if (!baseInfo.isDirectory() || baseInfo.isSymbolicLink()) {
    throw Object.assign(new Error('产物目录不可用。'), { status: 404 });
  }
  const canonicalBase = await realpath(base);
  let current = canonicalBase;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink() || (index < segments.length - 1 ? !info.isDirectory() : !info.isFile())) {
      throw Object.assign(new Error('不支持此文件类型。'), { status: 403 });
    }
  }
  return current;
}

export function detectImageType(bytes: Buffer): { mimeType: string; extension: string } | undefined {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      bytes.toString('ascii', 12, 16) === 'IHDR' && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0) {
    return { mimeType: 'image/png', extension: '.png' };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: '.jpg' };
  }
  if (bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return { mimeType: 'image/webp', extension: '.webp' };
  }
  return undefined;
}
