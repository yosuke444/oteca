import { describe, expect, it } from 'vitest';
import { CARD_DB } from '../src/data/cards';
import { STARTER_CARDS, buildDeck } from '../src/data/starterDeck';
import { applyAction, createGame, getLegalActions } from '../src/engine';
import type { Action, GameEvent, GameState } from '../src/engine/types';
import { ME, OPP, TUTORIAL, TutorialDriver, deckNos, matches, toAction, tutorialConfig, tutorialThink } from '../src/tutorial/driver';
import { Match } from '../src/controllers/match';
import { CpuController } from '../src/controllers/cpu';
import { HumanController } from '../src/controllers/types';

/** 1つの手順の間に起きた出来事 */
type Log = { step: string; action: Action; events: GameEvent[]; before: GameState; after: GameState }[];

/**
 * 画面なしで台本を最後まで進める：自分は各手順で決めた操作（見るだけ・タップは そのまま次へ）、相手は台本の操作。
 * 案内が全部終わった（自由に対戦する #15 の前）ところで止める
 */
function runScript(seed = 'tutorial-test'): { log: Log; state: GameState; driver: TutorialDriver } {
  const driver = new TutorialDriver();
  const created = createGame(tutorialConfig(CARD_DB, seed));
  let s = created.state;
  const log: Log = [];
  const apply = (a: Action, step: string) => {
    expect(driver.allows(a, s), `${step}：${JSON.stringify(a)} が許されていない`).toBe(true);
    const r = applyAction(s, a);
    expect(r.rejected, `${step}：${JSON.stringify(a)}`).toBeUndefined();
    log.push({ step, action: a, events: r.events, before: s, after: r.state });
    driver.applied(a, s);
    s = r.state;
  };
  for (let guard = 0; guard < 500 && !driver.free; guard++) {
    const st = driver.step!;
    // 相手が動く番（準備・メイン・くりだし）なら、台本の操作
    const oppTurn = getLegalActions(s, OPP).length > 0 && !(s.phase === 'setup' && st.kind !== 'act');
    if (oppTurn && !driver.holdsCpu(s)) {
      const a = driver.oppAction(s);
      expect(a, `相手の台本が ${st.id} の時に使えない`).not.toBeNull();
      apply(a!, `opp@${st.id}`);
      driver.idle(s);
      continue;
    }
    expect(driver.visible(s), `${st.id} の案内が出ない（${s.phase} ${s.currentPlayer}）`).toBe(true);
    // 案内中にできる操作は、決めた操作だけ（act 以外の手順では何もできない）
    const ok = getLegalActions(s, ME).filter((a) => driver.allows(a, s));
    if (st.kind === 'act') {
      expect(ok.length, `${st.id}：できる操作が無い`).toBeGreaterThan(0);
      for (const a of ok) expect(st.allow!.some((p) => matches(p, a)), `${st.id}：${JSON.stringify(a)}`).toBe(true);
    } else expect(ok, `${st.id}：操作できてしまう`).toEqual([]);
    switch (st.kind) {
      case 'tap':
        expect(driver.tap(s)).toBe(true);
        break;
      case 'dice':
        expect(driver.rollDice()).toBe(true);
        break;
      case 'longPress':
        driver.longPressed(st.spot![0].slice('card:'.length));
        driver.detailClosed();
        break;
      case 'watch':
        driver.idle(s);
        expect(driver.step?.id, `${st.id}：見るだけの手順が、相手の番の前に終わった`).not.toBe(st.id);
        break;
      case 'act': {
        const a = getLegalActions(s, ME).find((x) => driver.allows(x, s));
        expect(a, `${st.id}：決めた操作が合法手に無い`).toBeDefined();
        apply(a!, st.id);
        driver.idle(s);
        break;
      }
    }
  }
  return { log, state: s, driver };
}

const eventsOf = (log: Log, step: string) => log.filter((l) => l.step === step).flatMap((l) => l.events);

describe('T01 台本どおりの場面が毎回起きる（UPDATE_v2 §6T-5）', () => {
  it('どの種でも、案内の最後まで止まらずに進み、相手の台本とサイコロの目をちょうど使い切る', () => {
    for (const seed of ['a', 'b', 'tutorial-xyz', '12345']) {
      const { state, driver } = runScript(seed);
      expect(driver.free).toBe(true);
      expect(driver.oppScriptLeft).toBe(0);
      expect(state.forcedDice).toEqual([]);
      expect(state.phase).toBe('main');
      expect(state.currentPlayer).toBe(ME);
    }
  });

  it('#2 自分が先攻になる', () => {
    const { log } = runScript();
    expect(log[0].before.firstPlayer).toBe(ME);
  });

  it('#7 相手の攻撃で自分のおてあげのHPが減る', () => {
    const { log } = runScript();
    const firstOppEnd = log.find((l) => l.step.startsWith('opp@') && l.action.type === 'END_TURN')!;
    expect(firstOppEnd.events.some((e) => e.type === 'Damaged' && firstOppEnd.after.cards[e.uid].owner === ME)).toBe(true);
  });

  it('#8 サイコロで6が出て、50ダメージ', () => {
    const ev = eventsOf(runScript().log, 'attack1');
    expect(ev.find((e) => e.type === 'DiceRolled')).toMatchObject({ purpose: 'attack', player: ME, value: 6 });
    expect(ev.find((e) => e.type === 'Damaged')).toMatchObject({ amount: 50 });
  });

  it('#9 やいばで +20 になって攻撃する（6 ではない目の 30 に +20）', () => {
    const { log } = runScript();
    expect(eventsOf(log, 'yaiba').find((e) => e.type === 'BuffChanged')).toMatchObject({ uid: 'p1-0', attackAdd: 20 });
    const ev = eventsOf(log, 'attack2');
    const die = ev.find((e) => e.type === 'DiceRolled');
    expect(die && die.type === 'DiceRolled' && die.value).not.toBe(6);
    expect(ev.find((e) => e.type === 'Damaged')).toMatchObject({ amount: 50 });
  });

  it('#10 くすりで回復する。#11 交代したターンは攻撃しない', () => {
    const { log } = runScript();
    expect(eventsOf(log, 'kusuri').some((e) => e.type === 'Healed')).toBe(true);
    expect(eventsOf(log, 'swapEnd').find((e) => e.type === 'TurnEnded')).toMatchObject({ player: ME, attacked: false });
  });

  it('#12 案内のターンの始めにドローしている', () => {
    const { log } = runScript();
    const before = log.find((l) => l.step === 'ko')!.before;
    // 6ターン目（3の倍数）の始めにドローした
    expect(before.players[ME].turnCount % before.rules[ME].drawEveryNTurns).toBe(0);
    const lastOppEnd = [...log].reverse().find((l) => l.step.startsWith('opp@') && l.action.type === 'END_TURN' && l.after.currentPlayer === ME && l.after.players[ME].turnCount === before.players[ME].turnCount)!;
    expect(lastOppEnd.events.some((e) => e.type === 'Drew' && e.player === ME)).toBe(true);
  });

  it('#13 攻撃して相手のおてあげを倒し、相手がくりだす', () => {
    const { log } = runScript();
    const ev = eventsOf(log, 'ko');
    const faint = ev.find((e) => e.type === 'Fainted');
    expect(faint).toMatchObject({ by: ME, koCount: 1 });
    const promoted = log.find((l) => l.step.startsWith('opp@') && l.action.type === 'PROMOTE');
    expect(promoted).toBeDefined();
  });

  it('#14 自分のおてあげが倒され、ベンチから選んで出す', () => {
    const { log } = runScript();
    const koMe = log.find((l) => l.events.some((e) => e.type === 'Fainted' && e.by === OPP));
    expect(koMe).toBeDefined();
    expect(koMe!.events.some((e) => e.type === 'NeedPromote' && e.player === ME)).toBe(true);
    expect(eventsOf(log, 'promote').find((e) => e.type === 'Promoted')).toMatchObject({ player: ME });
  });
});

describe('T02 台本のデータ', () => {
  it('自分のデッキは初期デッキの15枚（並べ方だけ違う）、相手は おてあげ6・みつめ4・むつあし3・くすり2', () => {
    const sort = (a: number[]) => [...a].sort((x, y) => x - y);
    expect(sort(deckNos(TUTORIAL.decks.me))).toEqual(sort(buildDeck(STARTER_CARDS)));
    expect(sort(deckNos(TUTORIAL.decks.opp))).toEqual(sort(buildDeck([['oteage', 6], ['mitsume', 4], ['mutsuashi', 3], ['kusuri', 2]])));
  });

  it('手順は #1〜#15 をすべて含み、どの文にも2つの言語がある', () => {
    const nos = new Set(TUTORIAL.steps.map((s) => s.no));
    for (let i = 1; i <= 15; i++) expect(nos.has(i), `#${i}`).toBe(true);
    for (const s of TUTORIAL.steps) {
      expect(s.text.hira.length, s.id).toBeGreaterThan(0);
      expect(s.text.kanji.length, s.id).toBeGreaterThan(0);
      if (s.kind === 'act') expect(s.allow?.length, s.id).toBeGreaterThan(0);
    }
  });

  it('案内中は決めた操作しかできない（ほかの合法手は弾く）', () => {
    const driver = new TutorialDriver();
    const s = createGame(tutorialConfig(CARD_DB, 'x')).state;
    // あいさつ・サイコロ・長押しの間は、バトル場を決める操作もできない
    for (const a of getLegalActions(s, ME)) expect(driver.allows(a, s)).toBe(false);
    driver.tap(s);
    driver.rollDice();
    driver.tap(s);
    driver.longPressed('p1-0');
    driver.detailClosed();
    const ok = getLegalActions(s, ME).filter((a) => driver.allows(a, s));
    expect(ok).toEqual([{ type: 'SETUP_ACTIVE', player: ME, uid: 'p1-0' }]);
  });

  it('台本の山札の順番は、エンジンに「切らない」と渡すだけ（手札は書いた順の先頭5枚）', () => {
    const s = createGame(tutorialConfig(CARD_DB, 'y')).state;
    expect(s.players[ME].hand).toEqual(['p1-0', 'p1-1', 'p1-2', 'p1-3', 'p1-4']);
    expect(s.players[ME].deck[0]).toBe('p1-5');
    expect(s.players[OPP].hand).toEqual(['p2-0', 'p2-1', 'p2-2', 'p2-3', 'p2-4']);
  });
});

describe('T01b 画面と同じ配線（Match・CpuController・tutorialThink）でも台本どおり', () => {
  it('相手は台本の操作だけをして、ふつうの CPU の考えに切り替わらない。目も台本も使い切る', async () => {
    for (const seed of ['wire-1', 'wire-2']) {
      const driver = new TutorialDriver();
      const fallback: unknown[] = [];
      let match: Match | null = null;
      const cpu = new CpuController(OPP, (fn) => (fn(), null), {
        level: 'weak',
        think: tutorialThink(driver, () => match?.state ?? null, (...args) => {
          fallback.push(args);
          return null;
        }),
      });
      match = new Match(tutorialConfig(CARD_DB, seed), { p1: new HumanController(ME), p2: cpu });
      const m = match;
      let before = m.state;
      const opp: Action[] = [];
      const events: { step: string; events: GameEvent[] }[] = [];
      m.subscribe((st) => {
        driver.applied(st.action!, before);
        if (st.action!.player === OPP) opp.push(st.action!);
        events.push({ step: driver.step?.id ?? 'free', events: st.events });
        before = st.state;
      });
      // 画面と同じ：演出が終わるたびに、台本に知らせてから CPU に考える番を知らせる
      const settle = async () => {
        for (let i = 0; i < 6; i++) {
          driver.idle(m.state);
          m.notifyIdle();
          await new Promise((r) => setTimeout(r, 0));
        }
      };
      for (let guard = 0; guard < 400 && !driver.free; guard++) {
        await settle();
        const st = driver.step!;
        if (!driver.visible(m.state)) continue;
        if (st.kind === 'tap') driver.tap(m.state);
        else if (st.kind === 'dice') driver.rollDice();
        else if (st.kind === 'longPress') {
          driver.longPressed(st.spot![0].slice('card:'.length));
          driver.detailClosed();
        } else if (st.kind === 'act') {
          const a = getLegalActions(m.state, ME).find((x) => driver.allows(x, m.state));
          expect(a, `${seed} ${st.id}`).toBeDefined();
          expect(m.submit(a!)).toBeNull();
        }
      }
      cpu.dispose();
      expect(driver.free, seed).toBe(true);
      expect(fallback, `${seed}：台本の途中で ふつうの CPU に任せた`).toEqual([]);
      expect(opp).toEqual(TUTORIAL.oppScript.map((p) => toAction(p, OPP)));
      expect(m.state.forcedDice).toEqual([]);
      expect(m.rejected).toEqual([]);
      const at = (id: string) => events.filter((e) => e.step === id).flatMap((e) => e.events);
      // 操作が通った時点で手順は次へ進んでいるので、#8 の攻撃は「six」の手順の出来事に入る
      expect(at('six').find((e) => e.type === 'Damaged')).toMatchObject({ amount: 50 });
      expect(events.flatMap((e) => e.events).filter((e) => e.type === 'Fainted').length).toBe(2);
    }
  });
});
