import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cardById } from '../src/data/cards';
import { cardImageUrl, forgetImagesForTest, imageState, isImageReady, loadImage, preloadCards, waitCardImages } from '../src/ui/imageLoader';

/**
 * P01 絵の読み込み係（v2.4）：decode() まで待つ・同じ絵を2回読まない・失敗しても止まらない・待つのは決めた時間まで
 */
type Fake = { src: string; decode: () => Promise<void>; onerror: (() => void) | null; onload: (() => void) | null; complete: boolean; naturalWidth: number; fetchPriority?: string; decoding?: string };
const made: Fake[] = [];
/** decode の終わり方を決める（url → resolve/reject を後で呼ぶ） */
const pending = new Map<string, { ok: () => void; ng: () => void }>();

beforeEach(() => {
  made.length = 0;
  pending.clear();
  forgetImagesForTest();
  class FakeImage {
    src = '';
    onerror: (() => void) | null = null;
    onload: (() => void) | null = null;
    complete = false;
    naturalWidth = 0;
    constructor() {
      made.push(this as unknown as Fake);
    }
    decode() {
      return new Promise<void>((resolve, reject) => {
        pending.set(this.src, {
          ok: () => {
            this.complete = true;
            this.naturalWidth = 10;
            resolve();
          },
          ng: () => {
            reject(new Error('bad'));
            this.onerror?.();
          },
        });
      });
    }
  }
  vi.stubGlobal('Image', FakeImage);
});
afterEach(() => vi.unstubAllGlobals());

describe('P01 絵の読み込み係', () => {
  it('decode() が終わるまで「読んでいる」。終わったら ok。同じ絵は2回読まない', async () => {
    const a = loadImage('/cards/a.webp', 'high');
    const b = loadImage('/cards/a.webp');
    expect(made).toHaveLength(1);
    expect(made[0].src).toBe('/cards/a.webp');
    expect(made[0].fetchPriority).toBe('high');
    expect(imageState('/cards/a.webp')).toBe('loading');
    expect(isImageReady('/cards/a.webp')).toBe(false);
    pending.get('/cards/a.webp')!.ok();
    expect(await a).toBe(true);
    expect(await b).toBe(true);
    expect(imageState('/cards/a.webp')).toBe('ok');
    await loadImage('/cards/a.webp');
    expect(made).toHaveLength(1);
  });

  it('失敗しても止まらない（false・error）。次に頼まれたら読み直す', async () => {
    const p = loadImage('/cards/x.webp');
    pending.get('/cards/x.webp')!.ng();
    expect(await p).toBe(false);
    expect(imageState('/cards/x.webp')).toBe('error');
    const again = loadImage('/cards/x.webp');
    expect(made).toHaveLength(2);
    pending.get('/cards/x.webp')!.ok();
    expect(await again).toBe(true);
  });

  it('カードが決まったら読み始める（置いてある絵だけ）。待つのは決めた時間まで（その後も読み続ける）', async () => {
    const no = cardById('oteage')!.no;
    const url = cardImageUrl(cardById('oteage'))!;
    expect(url).toMatch(/cards\/oteage\.webp$/);
    void preloadCards([no, no]);
    expect(made).toHaveLength(1);
    vi.useFakeTimers();
    const w = waitCardImages([no], 2000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await w).toBe(false);
    vi.useRealTimers();
    pending.get(url)!.ok();
    expect(await waitCardImages([no], 2000)).toBe(true);
    // トロフィーのカードも絵を読む（v2.7）。絵の無いカードは読まない
    expect(cardImageUrl({ ...cardById('oteage')!, trophy: 3, image: 'cards/trophy.webp' } as never)).toBe('/cards/trophy.webp');
    expect(cardImageUrl({ ...cardById('oteage')!, image: '' } as never)).toBeNull();
  });
});
