import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
export const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
