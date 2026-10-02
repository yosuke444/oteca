// fflate の deflateSync・inflateSync は「生の deflate」（deflate-raw と同じ。zlib・gzip の頭は付かない）
import { deflateSync, inflateSync } from 'fflate';

/**
 * 引き継ぎコード用の圧縮（deflate-raw。SPEC §12-4・UPDATE_v2 §3-4）
 * ブラウザの CompressionStream を使い、使えない環境では予備の fflate を使う。
 * どちらで圧縮したものも、どちらでも元に戻せる（同じ deflate-raw 形式）。
 */

export type CompressEngine = 'stream' | 'fflate';

/** CompressionStream（deflate-raw）が使えるか */
export function streamAvailable(): boolean {
  try {
    if (typeof CompressionStream === 'undefined' || typeof DecompressionStream === 'undefined') return false;
    new CompressionStream('deflate-raw');
    new DecompressionStream('deflate-raw');
    return true;
  } catch {
    return false;
  }
}

/** 圧縮する。engine を省略すると、使える方（CompressionStream を優先） */
export async function deflateRaw(bytes: Uint8Array, engine: CompressEngine = streamAvailable() ? 'stream' : 'fflate'): Promise<Uint8Array> {
  if (engine === 'stream') return pipe(bytes, new CompressionStream('deflate-raw'));
  return deflateSync(bytes, { level: 9 });
}

/** 元に戻す。壊れていればエラー */
export async function inflateRaw(bytes: Uint8Array, engine: CompressEngine = streamAvailable() ? 'stream' : 'fflate'): Promise<Uint8Array> {
  if (engine === 'stream') return pipe(bytes, new DecompressionStream('deflate-raw'));
  return inflateSync(bytes);
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
