import { describe, expect, it } from 'vitest';
import raw from '../src/data/tutorial.json';
import { POST_DECK_START, POST_STEPS, STEP_FROM_NOTICE, postText, resumeIndex, stepForSave, titleNext } from '../src/tutorial/post';

/** チュートリアルの延長（SPEC §7 S13・§16-2p P01。UPDATE_v2_1 §6-2） */

describe('P01 延長の手順（#16〜#25）', () => {
  it('#16〜#25 がそろい、順番どおり。どの手順にも両方の言語の文がある', () => {
    const nos = [...new Set(POST_STEPS.map((s) => s.no))];
    expect(nos).toEqual([16, 17, 18, 19, 20, 21, 22, 23, 24, 25]);
    for (let i = 1; i < POST_STEPS.length; i++) expect(POST_STEPS[i].no).toBeGreaterThanOrEqual(POST_STEPS[i - 1].no);
    for (const s of POST_STEPS) {
      for (const lang of ['hira', 'kanji'] as const) expect(postText(s.id, lang, {}).trim().length, `${s.id} ${lang}`).toBeGreaterThan(0);
      // 操作の手順は、囲む場所と進む条件がある
      if (s.kind === 'act') {
        expect(s.spot.length, s.id).toBeGreaterThan(0);
        expect(s.until, s.id).toBeTypeOf('function');
      }
    }
    // 文の id はすべて手順か補足（使われない文が無い）
    const ids = new Set([...POST_STEPS.map((s) => s.id), 'noteSample', 'noteSuper', 'noteGuarantee', 'noteGuaranteeOpen']);
    for (const p of (raw as unknown as { post: { id: string }[] }).post) expect(ids.has(p.id), p.id).toBe(true);
  });

  it('数は差し込む（コイン・パック・袋・値段・デッキの枚数・12時）。日本語の辞書は漢字を使う', () => {
    expect(postText('coins', 'hira', { coins: 200 })).toContain('200まい');
    expect(postText('buy', 'kanji', { pack: '元祖パック', bags: 15, price: 200, note: '' })).toContain('15枚 200コイン');
    expect(postText('rules', 'hira', { size: 15, superMax: 1, superNote: '' })).toContain('15まい');
    expect(postText('tourDaily', 'kanji', { hour: 12 })).toContain('12時');
    expect(postText('back15', 'hira', { n: 16, size: 15 })).toContain('16まい');
    expect(postText('coins', 'kanji', { coins: 5 })).toMatch(/[一-鿿]/);
    expect(() => postText('nai', 'hira')).toThrow('nai');
  });

  it('途中で閉じた時の再開位置：16＝ガチャから、20＝デッキ編集から。対戦の途中（0）は再開しない', () => {
    expect(resumeIndex(0)).toBeNull();
    expect(resumeIndex(15)).toBeNull();
    expect(resumeIndex(16)).toBe(0);
    expect(resumeIndex(20)).toBe(POST_DECK_START);
    expect(POST_STEPS[POST_DECK_START].no).toBe(20);
    expect(POST_STEPS[0].no).toBe(16);
    for (let i = 0; i < POST_STEPS.length; i++) expect(stepForSave(i)).toBe(i >= POST_DECK_START ? 20 : 16);
  });
});

describe('P01 タイトルを押した時の行き先（ことば・再開）', () => {
  const t = (done: boolean, step: number) => ({ done, step });
  it('新しい人は ことば から。終えた人・今までのプレイヤー（おしらせ を見ていない）はメニュー', () => {
    expect(titleNext(t(false, 0), true, 200, 200)).toEqual({ go: 'lang' });
    expect(titleNext(t(true, 0), true, 200, 200)).toEqual({ go: 'menu' });
    expect(titleNext(t(false, 0), false, 200, 200)).toEqual({ go: 'menu' });
  });
  it('おしらせ で「やる」を選んで途中で閉じた人は、ことば・なまえ を出さずにチュートリアルから', () => {
    expect(titleNext(t(false, STEP_FROM_NOTICE), true, 0, 200)).toEqual({ go: 'tutorial' });
  });
  it('延長の途中で閉じた人：16 はガチャから（コインが足りなければデッキ編集から）、20 はデッキ編集から', () => {
    expect(titleNext(t(false, 16), true, 200, 200)).toEqual({ go: 'menu', post: 0 });
    expect(titleNext(t(false, 16), true, 199, 200)).toEqual({ go: 'deck', post: POST_DECK_START });
    expect(titleNext(t(false, 20), true, 5000, 200)).toEqual({ go: 'deck', post: POST_DECK_START });
  });
});
