import { describe, expect, it } from 'vitest';
import { CARD_DB, CARD_LIST } from '../src/data/cards';
import { STARTER_COINS, classicDeckNos, starterCollection } from '../src/data/starterDeck';
import { validateDeck } from '../src/engine';
import { type SaveDataV1, type SaveDataV2, type SaveDataV3, type SaveDataV4, type SaveDataV6, type SaveDataV7, type SaveDataV8, encodeBody, encodeSave } from '../src/save/binary';
import { applyRateResult } from '../src/online/rate';
import { isUserId } from '../src/save/userId';
import { checkSavedDeck } from '../src/save/collection';
import { openSave, sealBytes } from '../src/save/cookieStore';
import { OLD_STAGE_NAMES, dayStartMs, decodeSave, migrate, newStageNo, upgradeToV6, upgradeToV7, upgradeToV8 } from '../src/save/migrate';
import { STORY, stageByNo } from '../src/story/story';
import { DECK_SLOTS, type SaveData, defaultDeckName, emptyCpuStats, emptyDaily, laterFieldsDefault } from '../src/save/saveData';
import { decodeTransferCode, encodeTransferBytes } from '../src/save/transferCode';
import { makeRandom } from './save.helpers';
import { encodeOldSave, hexToBytes, oldCookie, oldTransferCode, toHex } from './save.oldFormat';

/** 移行で作るユーザーID（ランダムなので形だけ比べる） */
const ANY_USER_ID = expect.stringMatching(/^[1-9]\d{14}$/) as unknown as string;

/**
 * セーブ形式の移行（SPEC §12-3・§12-3b、テスト V05・V06・V07）
 * いちばん大事なこと：今までのプレイヤーの保存デッキが、移行後もすべて使えるままであること。
 */

/** 6〜20個目の空のデッキ */
const emptyRest = (from: number) => Array.from({ length: DECK_SLOTS - from }, (_, i) => ({ name: defaultDeckName(from + i), cards: [] as number[] }));

describe('形式の移行（固定の見本）', () => {
  /**
   * 形式版数1で保存したバイト列（16進）。今後形式を変えても、これが読めなければいけない。
   * 中身：名前「おてか」、BGM 3・効果音 9・はやい・演出をへらす ON・ヒント OFF、
   *      スロット2（index 1）を選択、デッキ1＝No1×3・名前なし、デッキ2＝名前「つよい」No7・No9、
   *      3勝2敗、コイン5、unlockAll、所持 No12×4、ストーリー 1・2 クリア、保存回数 300
   */
  const V1_FIXTURE_HEX =
    '0101ac0209e3818ae381a6e3818b3906010003010101' +
    '09e381a4e38288e38184020709000000000000030205' +
    '01010c04020102';

  /** 形式版数1の中身（cpuStats が無い形） */
  const V1_EXPECTED: SaveDataV1 = {
    saveVersion: 1,
    saveCounter: 300,
    playerName: 'おてか',
    settings: { bgm: 3, se: 9, fxSpeed: 1, reduceFx: true, hints: false },
    decks: [
      { name: 'デッキ1', cards: [1, 1, 1] },
      { name: 'つよい', cards: [7, 9] },
      { name: 'デッキ3', cards: [] },
      { name: 'デッキ4', cards: [] },
      { name: 'デッキ5', cards: [] },
    ],
    selectedDeck: 1,
    stats: { wins: 3, losses: 2 },
    coins: 5,
    collection: [{ no: 12, qty: 4 }],
    unlockAll: true,
    story: { cleared: [1, 2] },
  };

  /** 形式版数2（v1.4）：形式版数1と同じ中身 ＋ CPU対戦 よわい3勝1敗・つよい5勝6敗・さいきょう0勝2敗 */
  const V2_EXPECTED: SaveDataV2 = {
    ...V1_EXPECTED,
    cpuStats: [
      { wins: 3, losses: 1 },
      { wins: 0, losses: 0 },
      { wins: 5, losses: 6 },
      { wins: 0, losses: 2 },
    ],
  };
  const V2_FIXTURE_HEX = '02' + V1_FIXTURE_HEX.slice(2) + '0301000005060002';

  /** 形式版数3（v2.0-A）：形式版数2と同じ中身 ＋ ことば＝日本語 */
  const V3_EXPECTED: SaveDataV3 = { ...V2_EXPECTED, settings: { ...V2_EXPECTED.settings, lang: 'kanji' } };
  const V3_FIXTURE_HEX = '03' + V2_FIXTURE_HEX.slice(2) + '01';

  /**
   * 形式版数1〜3 を今の形（形式版数4）にした時の中身。
   * 所持数：初期カード（おてあげ5・みつめ3・おてさげ2・レボリューション1・くすり2・やいば2）と、
   *   デッキの枚数（No1×3、No7×1・No9×1）と、今までの collection（No12×4）の大きい方。コインは 5 + 200。
   */
  const migrated = (cpuStats: SaveData['cpuStats'], lang: 'hira' | 'kanji'): SaveData => ({
    saveVersion: 1,
    saveCounter: 300,
    playerName: 'おてか',
    settings: { bgm: 3, se: 9, fxSpeed: 1, reduceFx: true, hints: false, lang },
    decks: [{ name: 'デッキ1', cards: [1, 1, 1] }, { name: 'つよい', cards: [7, 9] }, ...emptyRest(2)],
    selectedDeck: 1,
    collection: { 1: 5, 2: 3, 3: 2, 7: 1, 9: 2, 10: 2, 12: 4 },
    unlockAll: false,
    coins: 205,
    stats: { wins: 3, losses: 2 },
    cpuStats,
    story: {
      stages: [
        { no: 1, cleared: true, firstClear: true },
        { no: 2, cleared: true, firstClear: true },
      ],
    },
    updateNoticeSeen: false,
    playerId: '',
    // 形式版数8 への移行でユーザーID を作る（ランダム。まだ登録していない）
    userId: ANY_USER_ID,
    userIdRegistered: false,
    // 形式版数9 への移行でトロフィーの一覧（空）
    trophies: [],
    loginBonus: { claimedAt: 0 },
    dailyReward: { date: 0, count: 0 },
    rate: 100,
    rateStats: { wins: 0, losses: 0, best: 100 },
    lastRateOpponentId: '',
    pendingRateMatch: null,
    trade: { doneIds: [] },
    // 形式版数7 への移行で、名前を載せる設定はオン。レートは初期値なので「かり」ではない
    ranking: { token: '', optIn: true, unsent: [], provisional: false, syncedAt: 0, playedAt: 0, lastMatchId: '' },
    tutorial: { done: false, gachaInviteShown: false, step: 0 },
    daily: emptyDaily(),
  });
  const V1_AS_LATEST = migrated(emptyCpuStats(), 'hira');
  const V2_AS_LATEST = migrated(V2_EXPECTED.cpuStats, 'hira');
  const V3_AS_LATEST = migrated(V2_EXPECTED.cpuStats, 'kanji');

  /**
   * 形式版数4（v2.0-B）：すべての項目に初期値でない値を入れた見本。
   * 形式を黙って変えていないことを、固定のバイト列で確かめる
   */
  const V4_EXPECTED: SaveDataV4 = {
    saveVersion: 1,
    saveCounter: 1234,
    playerName: 'オテカ',
    settings: { bgm: 10, se: 0, fxSpeed: 2, reduceFx: false, hints: true, lang: 'kanji' },
    playerId: '0123456789abcdef',
    decks: [{ name: 'はじめてのデッキ', cards: [1, 1, 2, 3, 7, 9, 10] }, { name: 'デッキ2', cards: [] }, { name: 'B', cards: [12] }, ...emptyRest(3)],
    selectedDeck: 19,
    collection: { 1: 5, 3: 999, 12: 130 },
    unlockAll: true,
    coins: 99999,
    stats: { wins: 7, losses: 8 },
    cpuStats: [
      { wins: 1, losses: 2 },
      { wins: 3, losses: 4 },
      { wins: 5, losses: 6 },
      { wins: 200, losses: 0 },
    ],
    loginBonus: { lastDate: 20261002 },
    dailyReward: { date: 20261001, count: 20 },
    story: {
      stages: [
        { no: 1, cleared: true, firstClear: true },
        { no: 4, cleared: true, firstClear: false },
        { no: 9, cleared: false, firstClear: false },
      ],
    },
    rate: 135,
    rateStats: { wins: 9, losses: 2, best: 150 },
    lastRateOpponentId: 'ffeeddccbbaa9988',
    pendingRateMatch: { opponentId: '1111222233334444', opponentRate: 98 },
    trade: { doneIds: ['aaaaaaaaaaaaaaaa', '0000000000000001'] },
    ranking: { token: 'tok-xyz', optIn: true, unsent: ['r1', '報告'] },
    updateNoticeSeen: true,
    tutorial: { done: true, gachaInviteShown: true },
  };
  /** 形式版数4 を形式版数5 にした時：ログボは受け取った日の0時、tutorial.step 0、daily は空 */
  const V4_AS_V5: SaveDataV6 = {
    ...V4_EXPECTED,
    loginBonus: { claimedAt: new Date(2026, 9, 2).getTime() },
    tutorial: { done: true, gachaInviteShown: true, step: 0 },
    daily: emptyDaily(),
  };
  /**
   * 形式版数5 → 6（v2.1-N）：ステージ番号を敵の名前で付け替える。
   * 見本のステージ 1（らくがき こぞう）・4（おしゃべり ペン）・9（あかペン せんせい）→ 1・4・10
   */
  const renumbered = (d: SaveDataV6): SaveDataV6 => ({
    ...d,
    story: {
      stages: [
        { no: 1, cleared: true, firstClear: true },
        { no: 4, cleared: true, firstClear: false },
        { no: 10, cleared: false, firstClear: false },
      ],
    },
  });
  /**
   * 形式版数6 → 7（v2.0-I）：見本のレートは 135（初期値でない）ので「かり」。名前を載せる設定はオン、受け取った時刻は 0
   */
  const toV7 = (d: SaveDataV6): SaveDataV7 => ({ ...d, ranking: { ...d.ranking, optIn: true, provisional: d.rate !== 100, syncedAt: 0, playedAt: 0 } });
  /**
   * 形式版数7 → 8（v2.0-J）：ユーザーID を作る（ランダムなので形だけ比べる）。直前の相手・送れなかった報告は消す。
   * レート対戦の途中で閉じた印は、ここで負けとして計算する
   */
  const toV8 = (d: SaveDataV7): SaveData => {
    const x = structuredClone(d);
    if (x.pendingRateMatch) applyRateResult(x, x.pendingRateMatch.opponentRate, 'lose');
    return { ...x, userId: ANY_USER_ID, userIdRegistered: false, lastRateOpponentId: '', pendingRateMatch: null, ranking: { ...x.ranking, unsent: [], lastMatchId: '' }, trophies: [] };
  };
  /** 今の形式で書ける形（テスト用：ユーザーID を決まった値に） */
  const asLatest = (d: SaveDataV7): SaveData => ({ ...d, userId: '123456789012345', userIdRegistered: false, lastRateOpponentId: '', pendingRateMatch: null, ranking: { ...d.ranking, lastMatchId: '' }, trophies: [] });
  const V4_AS_LATEST = toV8(toV7(renumbered(V4_AS_V5)));
  /** 形式版数5（v2.1-L）：すべての項目に初期値でない値を入れた見本 */
  const V5_EXPECTED: SaveDataV6 = {
    ...V4_AS_V5,
    loginBonus: { claimedAt: 1791012345678 },
    tutorial: { done: false, gachaInviteShown: true, step: 16 },
    daily: {
      cycleKey: 20261003,
      missions: [
        { id: 'gacha1', progress: 1, claimed: true },
        { id: 'draw20', progress: 300, claimed: false },
        { id: 'onlineWin1', progress: 0, claimed: false },
      ],
      allClearClaimed: true,
    },
  };
  /** 形式版数6（v2.1-N）：並びは5と同じ。ステージは新しい番号 */
  const V6_EXPECTED: SaveDataV6 = renumbered(V5_EXPECTED);
  const V6_AS_V7 = toV7(V6_EXPECTED);
  const V5_AS_LATEST = toV8(V6_AS_V7);
  const V6_AS_LATEST = toV8(V6_AS_V7);
  /** 形式版数7（v2.0-I）：ランキングの項目にも初期値でない値を入れた見本 */
  const V7_EXPECTED: SaveDataV7 = {
    ...V6_AS_V7,
    ranking: { token: 'tok-xyz', optIn: false, unsent: ['r1', '報告'], provisional: true, syncedAt: 1791012345678, playedAt: 1791099999999 },
  };
  const V7_AS_LATEST = toV8(V7_EXPECTED);
  /** 形式版数8（v2.0-J）：ユーザーID・登録の印・相手のユーザーID・最後の試合ID にも値を入れた見本 */
  const V8_EXPECTED: SaveDataV8 = {
    ...V7_EXPECTED,
    userId: '123456789012345',
    userIdRegistered: true,
    lastRateOpponentId: '987654321098765',
    pendingRateMatch: { opponentId: '111112222233333', opponentRate: 98 },
    ranking: { ...V7_EXPECTED.ranking, lastMatchId: 'abcdef0123456789' },
  };
  /** 形式版数9（v2.0-J。今の形式）：トロフィーも入れた見本 */
  const V9_EXPECTED: SaveData = {
    ...V8_EXPECTED,
    trophies: [
      { number: 7, receivedAt: 1791100000000 },
      { number: 9999, receivedAt: 1791100000001 },
    ],
  };
  const V9_FIXTURE_HEX =
    '0901d20909e382aae38386e382aba009016b0123456789abcdef1318e381afe38198e38281e381a6e381aee38387e38383e382ad070101020307090a0000014201' +
    '0c000000000000000000000000000000000000000000000000000000000000000000000c0500e707000000000000000082019f8d060708010203040506c80100ce' +
    'ae9e85903489d1d4091403010304010a008701090296010003824430f8500d010000650e548952f56202aaaaaaaaaaaaaaaa000000000000000107746f6b2d7879' +
    '7a0202723106e5a0b1e5918a108bd1d4090306010100ac020004000001ceae9e859034ffad84af9034f9beb7b088891cabcdef0123456789020780ae84af90348f4e81ae84af9034';
  const V8_FIXTURE_HEX =
    '0801d20909e382aae38386e382aba009016b0123456789abcdef1318e381afe38198e38281e381a6e381aee38387e38383e382ad070101020307090a0000014201' +
    '0c000000000000000000000000000000000000000000000000000000000000000000000c0500e707000000000000000082019f8d060708010203040506c80100ce' +
    'ae9e85903489d1d4091403010304010a008701090296010003824430f8500d010000650e548952f56202aaaaaaaaaaaaaaaa000000000000000107746f6b2d7879' +
    '7a0202723106e5a0b1e5918a108bd1d4090306010100ac020004000001ceae9e859034ffad84af9034f9beb7b088891cabcdef0123456789';
  const V7_FIXTURE_HEX =
    '0701d20909e382aae38386e382aba009012b0123456789abcdef1318e381afe38198e38281e381a6e381aee38387e38383e382ad070101020307090a0000014201' +
    '0c000000000000000000000000000000000000000000000000000000000000000000000c0500e707000000000000000082019f8d060708010203040506c80100ce' +
    'ae9e85903489d1d4091403010304010a00870109029601ffeeddccbbaa99880111112222333344446202aaaaaaaaaaaaaaaa000000000000000107746f6b2d7879' +
    '7a0202723106e5a0b1e5918a108bd1d4090306010100ac020004000001ceae9e859034ffad84af9034';
  const V6_FIXTURE_HEX =
    '0601d20909e382aae38386e382aba009011b0123456789abcdef1318e381afe38198e38281e381a6e381aee38387e38383e382ad070101020307090a00000142010c' +
    '000000000000000000000000000000000000000000000000000000000000000000000c0500e707000000000000000082019f8d060708010203040506c80100ceae9e' +
    '85903489d1d4091403010304010a00870109029601ffeeddccbbaa99880111112222333344446202aaaaaaaaaaaaaaaa000000000000000107746f6b2d78797a0202' +
    '723106e5a0b1e5918a108bd1d4090306010100ac020004000001';
  const V5_FIXTURE_HEX =
    '0501d20909e382aae38386e382aba009011b0123456789abcdef1318e381afe38198e38281e381a6e381aee38387e38383e382ad070101020307090a00000142010c' +
    '000000000000000000000000000000000000000000000000000000000000000000000c0500e707000000000000000082019f8d060708010203040506c80100ceae9e8590' +
    '3489d1d4091403010304010900870109029601ffeeddccbbaa99880111112222333344446202aaaaaaaaaaaaaaaa000000000000000107746f6b2d78797a0202723106e5a0b1e5918a' +
    '108bd1d4090306010100ac020004000001';
  const V4_FIXTURE_HEX = 
    '0401d20909e382aae38386e382aba009011f0123456789abcdef1318e381afe38198e38281e381a6e381aee38387e38383e382ad070101020307090a00000142010c' +
    '000000000000000000000000000000000000000000000000000000000000000000000c0500e707000000000000000082019f8d060708010203040506c801008ad1d409' +
    '89d1d4091403010304010900870109029601ffeeddccbbaa99880111112222333344446202aaaaaaaaaaaaaaaa000000000000000107746f6b2d78797a0202723106e5a0b1e5918a';

  /** 形式版数1の時に作った引き継ぎコード（V1_EXPECTED の中身） */
  const V1_TRANSFER_CODE =
    '4222-2366-6946-5057-1122-1685-0719-9836-2694-5024-2064-0510-0134-4187-0039-8155-1864-8453-3977-0014-8028-1622-2292-4991-0581-1010-8895-9562-2237-7290-2958-7199-8';
  /** 形式版数2（v1.4）で作った引き継ぎコード（V2_FIXTURE_HEX、ソルト57） */
  const V2_TRANSFER_CODE =
    '5726-7570-1068-8805-2679-1170-5334-8252-2485-3465-5194-7515-5633-5254-1342-2085-1230-5340-9709-5959-3105-8946-8054-3566-8271-4770-6883-2664-3260-7408-8591-8731-1303-2630-6989-9598-2426-4';
  /** 形式版数3（v2.0-A）で作った引き継ぎコード（V3_FIXTURE_HEX、ソルト8） */
  const V3_TRANSFER_CODE = 
    '0820-4586-8091-4972-1426-5224-5776-2801-8604-5218-5470-8887-1086-8127-1518-7614-9218-3056-5534-3559-5067-5944-6018-5384-9044-1247-3953-8185-6978-6991-6929-9073-2561-0753-3787-1296-2643-826';

  it('見本：テスト用の古い書き方は、当時の固定のバイト列と同じになる', () => {
    expect(toHex(encodeOldSave(V2_EXPECTED as SaveDataV3, 1))).toBe(V1_FIXTURE_HEX);
    expect(toHex(encodeOldSave(V2_EXPECTED as SaveDataV3, 2))).toBe(V2_FIXTURE_HEX);
    expect(toHex(encodeOldSave(V3_EXPECTED, 3))).toBe(V3_FIXTURE_HEX);
    // 当時の引き継ぎコード（ソルトはコードの先頭2桁）も、同じ書き方で作れる
    expect(oldTransferCode(V2_EXPECTED as SaveDataV3, 1, 42)).toBe(V1_TRANSFER_CODE);
    expect(oldTransferCode(V2_EXPECTED as SaveDataV3, 2, 57)).toBe(V2_TRANSFER_CODE);
    expect(oldTransferCode(V3_EXPECTED, 3, 8)).toBe(V3_TRANSFER_CODE);
  });

  it('V05 形式版数1 → 最新：cpuStats は0、ことばは にほんご、所持カード・コインを配る', () => {
    expect(decodeSave(hexToBytes(V1_FIXTURE_HEX))).toEqual(V1_AS_LATEST);
    expect(migrate(1, V1_EXPECTED)).toEqual(V1_AS_LATEST);
  });

  it('V05 形式版数2 → 最新', () => {
    expect(decodeSave(hexToBytes(V2_FIXTURE_HEX))).toEqual(V2_AS_LATEST);
    expect(migrate(2, V2_EXPECTED)).toEqual(V2_AS_LATEST);
  });

  it('V05 形式版数3 → 最新（ことば は 日本語のまま）', () => {
    expect(decodeSave(hexToBytes(V3_FIXTURE_HEX))).toEqual(V3_AS_LATEST);
    expect(migrate(3, V3_EXPECTED)).toEqual(V3_AS_LATEST);
  });

  it('V05 形式版数4（v2.0-B）→ 最新：ログボの日付はその日の0時の時刻、tutorial.step 0、daily は空', () => {
    // 形式版数4の書き方（テスト用に残した並び）は、当時の固定のバイト列と同じ
    expect(toHex(encodeBody(V4_EXPECTED, 4))).toBe(V4_FIXTURE_HEX);
    expect(decodeSave(hexToBytes(V4_FIXTURE_HEX))).toEqual(V4_AS_LATEST);
    expect(migrate(4, V4_EXPECTED)).toEqual(V4_AS_LATEST);
    // 受け取っていない人（0）は 0 のまま。日付が壊れていれば 0（すぐ受け取れる）
    expect(dayStartMs(0)).toBe(0);
    expect(dayStartMs(20261340)).toBe(0);
    expect(dayStartMs(20260231)).toBe(0); // 2月31日（繰り越さない）
    expect(dayStartMs(20240229)).toBe(new Date(2024, 1, 29).getTime());
    expect(dayStartMs(20261002)).toBe(new Date(2026, 9, 2, 0, 0, 0).getTime());
    expect((migrate(4, { ...V4_EXPECTED, loginBonus: { lastDate: 0 } }) as SaveData).loginBonus.claimedAt).toBe(0);
  });

  it('V05 形式版数5（v2.1-L）→ 最新：ステージ番号を新しい番号へ', () => {
    expect(toHex(encodeBody(V5_EXPECTED, 5))).toBe(V5_FIXTURE_HEX);
    expect(decodeSave(hexToBytes(V5_FIXTURE_HEX))).toEqual(V5_AS_LATEST);
    expect(migrate(5, V5_EXPECTED)).toEqual(V5_AS_LATEST);
  });

  it('V05 形式版数6（v2.1-N）→ 最新：レートが初期値でなければ「かり」、名前を載せる設定はオン', () => {
    expect(toHex(encodeBody(V6_EXPECTED, 6))).toBe(V6_FIXTURE_HEX);
    // 並びは形式版数5と同じ（先頭の版数とステージの番号だけ違う）
    expect(V6_FIXTURE_HEX.slice(2).length).toBe(V5_FIXTURE_HEX.slice(2).length);
    expect(decodeSave(hexToBytes(V6_FIXTURE_HEX))).toEqual(V6_AS_LATEST);
    expect(migrate(6, V6_EXPECTED)).toEqual(V6_AS_LATEST);
    expect(V6_AS_V7.ranking).toEqual({ token: 'tok-xyz', optIn: true, unsent: ['r1', '報告'], provisional: true, syncedAt: 0, playedAt: 0 });
    // レートが初期値（100）なら「かり」にしない
    expect(upgradeToV7({ ...V6_EXPECTED, rate: 100 }).ranking.provisional).toBe(false);
  });

  it('V05 形式版数7（v2.0-I）→ 最新：ユーザーID を作り、途中で閉じたレート対戦は負けに、直前の相手と送れなかった報告は消す', () => {
    expect(toHex(encodeBody(V7_EXPECTED, 7))).toBe(V7_FIXTURE_HEX);
    expect(decodeSave(hexToBytes(V7_FIXTURE_HEX))).toEqual(V7_AS_LATEST);
    const up = upgradeToV8(V7_EXPECTED);
    expect(isUserId(up.userId)).toBe(true);
    // 見本は「レート 135・途中で閉じた試合（相手 98）」：負けとして計算した
    expect(up.rate).toBeLessThan(135);
    expect(up.rateStats.losses).toBe(V7_EXPECTED.rateStats.losses + 1);
    // 乱数を決めれば同じ ID、違えば（ほぼ）違う ID
    expect(upgradeToV8(V7_EXPECTED, (n) => new Uint8Array(n)).userId).toBe('100000000000000');
    expect(upgradeToV8(V7_EXPECTED, (n) => new Uint8Array(n).fill(255)).userId).toMatch(/^[1-9]\d{14}$/);
  });

  it('V05 今の形式（形式版数9）で書いたものは、固定のバイト列と一致する（形式を黙って変えていない）', () => {
    expect(toHex(encodeSave(V9_EXPECTED))).toBe(V9_FIXTURE_HEX);
    expect(decodeSave(hexToBytes(V9_FIXTURE_HEX))).toEqual(V9_EXPECTED);
    expect(migrate(9, V9_EXPECTED)).toEqual(V9_EXPECTED);
    // 並びは形式版数8 と同じ ＋ 末尾にトロフィー（先頭の版数だけ違う）
    expect(V9_FIXTURE_HEX.slice(2).startsWith(V8_FIXTURE_HEX.slice(2))).toBe(true);
    // トロフィーの番号が範囲外ならエラー
    expect(() => encodeSave({ ...V9_EXPECTED, trophies: [{ number: 10000, receivedAt: 0 }] })).toThrow('トロフィー');
  });

  it('V05 形式版数8（v2.0-J）→ 最新：トロフィーの一覧は空', () => {
    expect(toHex(encodeBody(V8_EXPECTED, 8))).toBe(V8_FIXTURE_HEX);
    expect(decodeSave(hexToBytes(V8_FIXTURE_HEX))).toEqual({ ...V8_EXPECTED, trophies: [] });
    expect(migrate(8, V8_EXPECTED)).toEqual({ ...V8_EXPECTED, trophies: [] });
    // 印の1バイトに登録の印（64）
    expect(hexToBytes(V8_FIXTURE_HEX)[17] & 64).toBe(64);
    // 形式版数7 までは、印の 64 は読めない
    const bad7 = hexToBytes(V7_FIXTURE_HEX);
    bad7[17] |= 64;
    expect(() => decodeSave(bad7)).toThrow('印');
  });

  it('V05 形式版数7 の並び（形式版数6 ＋ 末尾に syncedAt・playedAt）', () => {
    // 並びは形式版数6と同じ ＋ 末尾に syncedAt・playedAt（先頭の版数と印の1バイトだけ違う）
    const v6 = toHex(encodeBody({ ...V7_EXPECTED, ranking: { token: 'tok-xyz', optIn: false, unsent: ['r1', '報告'] } }, 6));
    expect(V7_FIXTURE_HEX.startsWith('07' + v6.slice(2, 34) + '2b' + v6.slice(36))).toBe(true);

    // 形式版数6 までは、印の 32 は読めない
    const bad = hexToBytes(V6_FIXTURE_HEX);
    bad[17] |= 32;
    expect(() => decodeSave(bad)).toThrow('印');
  });

  it('V05 読めない形式版数・余分なバイト・壊れた値はエラーになる', () => {
    for (const hex of [V1_FIXTURE_HEX, V2_FIXTURE_HEX, V3_FIXTURE_HEX, V4_FIXTURE_HEX, V5_FIXTURE_HEX, V6_FIXTURE_HEX, V7_FIXTURE_HEX, V8_FIXTURE_HEX, V9_FIXTURE_HEX]) {
      const bytes = hexToBytes(hex);
      const future = bytes.slice();
      future[0] = 99;
      expect(() => decodeSave(future)).toThrow('形式版数 99');
      expect(() => decodeSave(new Uint8Array([...bytes, 0]))).toThrow('余分');
      expect(() => decodeSave(bytes.slice(0, -1))).toThrow();
    }
  });

  it('V05 形式版数5の壊れた値（ミッションの番号・同じ番号・印・件数・tutorial.step）はエラー', () => {
    const base = hexToBytes(V5_FIXTURE_HEX);
    // 末尾の並び：step(10) cycleKey(8bd1d409) 件数(03) [06 01 01] [00 ac02 00] [04 00 00] allClear(01)
    const n = base.length;
    const tail = (patch: (b: Uint8Array) => void) => {
      const b = base.slice();
      patch(b);
      return b;
    };
    expect(() => decodeSave(tail((b) => (b[n - 11] = 7)))).toThrow('種類'); // 1つ目のミッションの番号 7（無い）
    expect(() => decodeSave(tail((b) => (b[n - 4] = 6)))).toThrow('種類'); // 3つ目が1つ目と同じ番号
    expect(() => decodeSave(tail((b) => (b[n - 9] = 2)))).toThrow('印'); // claimed が 2
    expect(() => decodeSave(tail((b) => (b[n - 1] = 2)))).toThrow('印'); // allClearClaimed が 2
    expect(() => decodeSave(tail((b) => (b[n - 12] = 8)))).toThrow('範囲外'); // 件数 8
    // tutorial.step 256（2バイト）
    const step = [...base.slice(0, n - 17), 0x80, 0x02, ...base.slice(n - 16)];
    expect(() => decodeSave(new Uint8Array(step))).toThrow('範囲外');
    // 書く時も同じ範囲で止める
    expect(() => encodeSave(asLatest(toV7({ ...V5_EXPECTED, tutorial: { ...V5_EXPECTED.tutorial, step: 256 } })))).toThrow('tutorial.step');
    const m = V5_EXPECTED.daily.missions[0];
    expect(() => encodeSave(asLatest(toV7({ ...V5_EXPECTED, daily: { ...V5_EXPECTED.daily, missions: [m, m] } })))).toThrow('2つ');
  });

  it('V06 形式版数4（v2.0）の Cookie の中身と引き継ぎコードが、v2.1 でも読める', async () => {
    expect(openSave(sealBytes(hexToBytes(V4_FIXTURE_HEX)))).toEqual(V4_AS_LATEST);
    expect(await decodeTransferCode(encodeTransferBytes(hexToBytes(V4_FIXTURE_HEX), 37))).toEqual({ ok: true, data: V4_AS_LATEST });
    expect(await decodeTransferCode(encodeTransferBytes(hexToBytes(V5_FIXTURE_HEX), 5))).toEqual({ ok: true, data: V5_AS_LATEST });
    expect(openSave(sealBytes(hexToBytes(V5_FIXTURE_HEX)))).toEqual(V5_AS_LATEST);
  });

  it('V06 形式版数1・2・3で作った古い引き継ぎコード（圧縮なし）が、v2.0 でも読める', async () => {
    expect(await decodeTransferCode(V1_TRANSFER_CODE)).toEqual({ ok: true, data: V1_AS_LATEST });
    expect(await decodeTransferCode(V2_TRANSFER_CODE)).toEqual({ ok: true, data: V2_AS_LATEST });
    expect(await decodeTransferCode(V3_TRANSFER_CODE)).toEqual({ ok: true, data: V3_AS_LATEST });
  });

  it('V06 形式版数1・2・3の Cookie の中身（暗号文）が、v2.0 でも読める', () => {
    expect(openSave(sealBytes(hexToBytes(V1_FIXTURE_HEX)))).toEqual(V1_AS_LATEST);
    expect(openSave(sealBytes(hexToBytes(V2_FIXTURE_HEX)))).toEqual(V2_AS_LATEST);
    expect(openSave(sealBytes(hexToBytes(V3_FIXTURE_HEX)))).toEqual(V3_AS_LATEST);
  });
});

describe('N04 ストーリーのステージ番号の付け替え（形式版数5 → 6。UPDATE_v2_1 §4-6）', () => {
  it('古い15ステージは、敵の名前どおりの新しい番号へ（旧4 おしゃべり ペン は新4、旧12 ぶあつい じしょ は新5）', () => {
    expect(newStageNo(4)).toBe(4);
    expect(newStageNo(12)).toBe(5);
    expect(newStageNo(99)).toBeUndefined();
    const all = Object.keys(OLD_STAGE_NAMES).map(Number);
    expect(all).toHaveLength(15);
    for (const o of all) expect(stageByNo(newStageNo(o)!)!.name, `旧${o}`).toBe(OLD_STAGE_NAMES[o]);
    // 1対1（2つが同じ番号にならない）
    expect(new Set(all.map(newStageNo)).size).toBe(15);
    expect(all.map(newStageNo)).toEqual([1, 2, 3, 4, 7, 8, 11, 6, 10, 13, 14, 5, 9, 12, 15]);
    expect(STORY.stages).toHaveLength(15);
  });

  it('形式版数1〜3 の古いセーブからも、番号が付け替わる（旧5 まいごの ふせん → 新7、旧12 ぶあつい じしょ → 新5）', () => {
    const old = { ...oldPlayer(5), story: { cleared: [1, 2, 3, 5, 12] } };
    for (const v of [1, 2, 3] as const) {
      const got = decodeSave(encodeOldSave(old, v));
      expect(got.story.stages.map((s) => s.no), `形式版数${v}`).toEqual([1, 2, 3, 5, 7]);
      expect(got.story.stages.every((s) => s.cleared && s.firstClear)).toBe(true);
    }
  });

  it('クリア済み・初クリア報酬済みの印が移る。前のステージが未クリアでもクリア済みのまま。知らない番号は消える', () => {
    const s = createDefault();
    // 旧：ザムライの道（8・9・10・11）を全部クリアした人
    s.story.stages = [1, 2, 3, 8, 9, 10, 11].map((no) => ({ no, cleared: true, firstClear: true }));
    s.story.stages.push({ no: 12, cleared: false, firstClear: true }, { no: 40, cleared: true, firstClear: true });
    const got = upgradeToV6(s);
    expect(got.story.stages).toEqual([
      { no: 1, cleared: true, firstClear: true },
      { no: 2, cleared: true, firstClear: true },
      { no: 3, cleared: true, firstClear: true },
      { no: 5, cleared: false, firstClear: true },
      { no: 6, cleared: true, firstClear: true },
      { no: 10, cleared: true, firstClear: true },
      { no: 13, cleared: true, firstClear: true },
      { no: 14, cleared: true, firstClear: true },
    ]);
    // ほかは変わらない
    expect({ ...got, story: s.story }).toEqual(s);
  });
});

/** 新しいセーブ（テスト用） */
function createDefault(): SaveData {
  return structuredClone(migrate(5, { ...laterFieldsDefault(), ...baseForV6() }) as SaveData);
}
function baseForV6() {
  return {
    saveVersion: 1 as const,
    saveCounter: 1,
    playerName: 'a',
    settings: { bgm: 7, se: 7, fxSpeed: 0 as const, reduceFx: false, hints: true, lang: 'hira' as const },
    decks: emptyRest(0),
    selectedDeck: 0,
    collection: {},
    unlockAll: false,
    coins: 0,
    stats: { wins: 0, losses: 0 },
    cpuStats: emptyCpuStats(),
    story: { stages: [] as SaveData['story']['stages'] },
    updateNoticeSeen: true,
  };
}

// ---------------------------------------------------------------- 今までのプレイヤーの見本（V07）

const OTEGE = CARD_LIST.filter((c) => c.kind === 'otege' && c.rarity === 'normal').map((c) => c.no);
const SUPER = CARD_LIST.filter((c) => c.kind === 'otege' && c.rarity === 'super').map((c) => c.no);
const ITEM = CARD_LIST.filter((c) => c.kind === 'item').map((c) => c.no);
const noOf = (id: string) => CARD_LIST.find((c) => c.id === id)!.no;

/** v1.4 までのルールで使えたデッキ（所持数は無制限だった）：15枚・おてあげ1枚以上・スーパー1枚まで。同じカードを何枚でも */
function oldValidDeck(r: ReturnType<typeof makeRandom>): number[] {
  const kind = r.int(0, 5);
  if (kind === 0) return Array.from({ length: 15 }, () => r.pick(OTEGE)); // おてあげだけ
  if (kind === 1) return [r.pick(OTEGE), ...Array.from({ length: 14 }, () => r.pick(ITEM))]; // ほぼアイテム
  if (kind === 2) {
    const one = r.pick([...OTEGE, ...ITEM]);
    return [r.pick(OTEGE), ...Array.from({ length: 14 }, () => one)].sort((a, b) => a - b); // 同じカード14枚
  }
  const deck: number[] = [];
  if (r.next() < 0.6) deck.push(r.pick(SUPER));
  deck.push(r.pick(OTEGE));
  while (deck.length < 15) deck.push(r.pick(r.next() < 0.65 ? OTEGE : ITEM));
  return r.next() < 0.5 ? deck.sort((a, b) => a - b) : deck; // 並び順もばらばら（そのまま残ること）
}

/** 今までのプレイヤーの、ありそうなセーブ（v1.3〜v2.0-A） */
function oldPlayer(seed: number): SaveDataV3 {
  const r = makeRandom(seed);
  const decks = Array.from({ length: 5 }, (_, i) => {
    const k = r.int(0, 9);
    // 使えるデッキ・作りかけ・空・枚数オーバー（16枚。v1.4 までも使えなかった）
    const cards = k < 6 ? oldValidDeck(r) : k < 8 ? Array.from({ length: r.int(1, 14) }, () => r.pick([...OTEGE, ...SUPER, ...ITEM])) : k < 9 ? [] : [...oldValidDeck(r), r.pick(ITEM)];
    return { name: r.next() < 0.5 ? defaultDeckName(i) : r.pick(['つよい', 'さいきょう', 'くすりまみれ', 'Ｓなし', 'ぼくの デッキ']), cards };
  });
  return {
    saveVersion: 1,
    saveCounter: r.int(1, 5000),
    playerName: r.pick(['プレイヤー', 'たろう', 'はなこ', 'ABC']),
    settings: { bgm: r.int(0, 10), se: r.int(0, 10), fxSpeed: r.int(0, 2) as 0 | 1 | 2, reduceFx: r.next() < 0.3, hints: r.next() < 0.5, lang: r.next() < 0.3 ? 'kanji' : 'hira' },
    decks,
    selectedDeck: r.int(0, 4),
    stats: { wins: r.int(0, 300), losses: r.int(0, 300) },
    cpuStats: Array.from({ length: 4 }, () => ({ wins: r.int(0, 50), losses: r.int(0, 50) })),
    coins: 0,
    collection: [],
    unlockAll: true,
    story: { cleared: [] },
  };
}

/** 名前の付いた見本（よくある遊び方・極端な遊び方） */
const NAMED_PLAYERS: { label: string; save: SaveDataV3 }[] = (() => {
  const base = oldPlayer(1);
  const C = classicDeckNos();
  const same = (id: string, n: number) => Array.from({ length: n }, () => noOf(id));
  return [
    { label: '初期デッキのまま遊んでいた人', save: { ...base, decks: [{ name: 'デッキ1', cards: C }, ...base.decks.slice(1).map((_, i) => ({ name: defaultDeckName(i + 1), cards: [] as number[] }))] } },
    {
      label: '5つとも作り込んだ人（同じカードをたくさん）',
      save: {
        ...base,
        decks: [
          { name: 'おてあげ15', cards: same('oteage', 15) },
          { name: 'くすり14', cards: [...same('mutsuashi', 1), ...same('kusuri', 14)] },
          { name: 'かみ', cards: [...same('kami', 1), ...same('sanbon', 7), ...same('himitsu_yaiba', 7)] },
          { name: 'レボ', cards: [...same('revolution', 1), ...same('otesage', 10), ...same('kimyou_drink', 4)] },
          { name: 'スポドリ', cards: [...same('yotsuashi', 3), ...same('supodori', 12)] },
        ],
      },
    },
    { label: 'デッキを1つも作らなかった人', save: { ...base, decks: base.decks.map((_, i) => ({ name: defaultDeckName(i), cards: [] })) } },
  ];
})();

/** 移行後のセーブが、元のセーブの「すべて使えるまま」を満たしているか */
function expectMigrated(old: SaveDataV3, got: SaveData, where: string) {
  expect(got.decks.length, where).toBe(DECK_SLOTS);
  // デッキ1〜5は名前・中身・並び順まで同じ、6〜20は空
  expect(got.decks.slice(0, 5), where).toEqual(old.decks);
  expect(got.decks.slice(5), where).toEqual(emptyRest(5));
  for (let i = 0; i < 5; i++) {
    const check = checkSavedDeck(got, i);
    // 所持数が足りないカードは1枚も無い（作りかけ・枚数オーバーのデッキも、カードは全部持っている）
    expect(check.shortages, `${where} デッキ${i + 1}`).toEqual([]);
    // v1.4 までのルールで使えたデッキは、今も使える
    if (validateDeck(old.decks[i].cards, CARD_DB).length === 0) expect(check.usable, `${where} デッキ${i + 1}`).toBe(true);
  }
  // 初期カード15枚（以上）とコイン200枚
  for (const [no, n] of Object.entries(starterCollection())) expect(got.collection[Number(no)], where).toBeGreaterThanOrEqual(n);
  expect(got.coins, where).toBe(old.coins + STARTER_COINS);
  // そのほかは そのまま
  expect(got.selectedDeck, where).toBe(old.selectedDeck);
  expect(got.playerName, where).toBe(old.playerName);
  expect(got.settings, where).toEqual(old.settings);
  expect(got.stats, where).toEqual(old.stats);
  expect(got.cpuStats, where).toEqual(old.cpuStats);
  expect(got.unlockAll, where).toBe(false);
  expect(got.updateNoticeSeen, where).toBe(false);
  expect(got.tutorial, where).toEqual({ done: false, gachaInviteShown: false, step: 0 });
  const { playerId, userId: _u, ...later } = laterFieldsDefault();
  expect(got.playerId).toBe(playerId);
  // ユーザーID は移行で1回だけ作る（ランダム）
  expect(got.userId, where).toMatch(/^[1-9][0-9]{14}$/);
  for (const [k, v] of Object.entries(later)) if (k !== 'tutorial') expect(got[k as keyof SaveData], `${where} ${k}`).toEqual(v);
}

/** 移行後の所持数は、ちょうど「初期カード」と「いちばん多く入れているデッキ」の大きい方（多すぎもしない） */
function expectedCollection(old: SaveDataV3): Record<number, number> {
  const out: Record<number, number> = { ...starterCollection() };
  for (const d of old.decks) {
    const counts = new Map<number, number>();
    for (const no of d.cards) counts.set(no, (counts.get(no) ?? 0) + 1);
    for (const [no, n] of counts) out[no] = Math.max(out[no] ?? 0, n);
  }
  return out;
}

describe('V07 今までのプレイヤーの移行（保存していたデッキがすべて使えるまま）', () => {
  const versions = [1, 2, 3] as const;
  /** 形式版数1・2 は cpuStats・lang を持たないので、その版で読める中身にそろえる */
  const asVersion = (s: SaveDataV3, v: 1 | 2 | 3): SaveDataV3 => ({
    ...s,
    cpuStats: v >= 2 ? s.cpuStats : emptyCpuStats(),
    settings: { ...s.settings, lang: v >= 3 ? s.settings.lang : 'hira' },
  });

  it('名前の付いた見本：Cookie・引き継ぎコード・バイト列のどれから移行しても使えるまま', async () => {
    for (const { label, save } of NAMED_PLAYERS) {
      for (const v of versions) {
        const old = asVersion(save, v);
        const where = `${label}（形式版数${v}）`;
        const fromBytes = decodeSave(encodeOldSave(old, v));
        const fromCookie = openSave(oldCookie(old, v));
        const code = await decodeTransferCode(oldTransferCode(old, v, 31));
        expect(code.ok, where).toBe(true);
        for (const got of [fromBytes, fromCookie, code.ok ? code.data : fromBytes]) {
          expectMigrated(old, got, where);
          expect(got.collection, where).toEqual(expectedCollection(old));
        }
      }
    }
    // 5つとも作り込んだ人：おてあげ15枚・くすり14枚などもそのまま持てる
    const heavy = decodeSave(encodeOldSave(NAMED_PLAYERS[1].save, 3));
    expect(heavy.collection[noOf('oteage')]).toBe(15);
    expect(heavy.collection[noOf('kusuri')]).toBe(14);
    expect(heavy.collection[noOf('supodori')]).toBe(12);
    expect(heavy.decks.slice(0, 5).every((_, i) => checkSavedDeck(heavy, i).usable)).toBe(true);
  });

  it('ランダムな見本 300人分：Cookie・引き継ぎコード・バイト列のどれから移行しても使えるまま', async () => {
    let usableBefore = 0;
    for (let seed = 0; seed < 300; seed++) {
      const v = versions[seed % 3];
      const old = asVersion(oldPlayer(1000 + seed), v);
      const where = `seed ${seed}（形式版数${v}）`;
      usableBefore += old.decks.filter((d) => validateDeck(d.cards, CARD_DB).length === 0).length;
      expectMigrated(old, decodeSave(encodeOldSave(old, v)), where);
      expectMigrated(old, openSave(oldCookie(old, v)), where);
      const code = await decodeTransferCode(oldTransferCode(old, v, seed % 100));
      expect(code.ok, where).toBe(true);
      if (code.ok) {
        expectMigrated(old, code.data, where);
        expect(code.data.collection, where).toEqual(expectedCollection(old));
      }
    }
    // 見本の中に、使えるデッキが十分にある（テストが空回りしていない）
    expect(usableBefore).toBeGreaterThan(500);
  });

  it('今までの collection（使っていなかった枠）の枚数も残る。上限は999', () => {
    const old = { ...oldPlayer(7), collection: [{ no: 5, qty: 40 }, { no: 2, qty: 5000 }] };
    const got = decodeSave(encodeOldSave(old, 3));
    expect(got.collection[5]).toBeGreaterThanOrEqual(40);
    expect(got.collection[2]).toBe(999);
  });

  it('移行して保存し直したデータ（形式版数6）を読んでも同じ', () => {
    for (const { save } of NAMED_PLAYERS) {
      const got = decodeSave(encodeOldSave(save, 3));
      expect(decodeSave(encodeSave(got))).toEqual(got);
    }
  });
});
