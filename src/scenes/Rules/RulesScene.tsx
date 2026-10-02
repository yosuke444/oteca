import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { CARD_DB } from '../../data/cards';
import { DEFAULT_RULES } from '../../engine';
import type { CardDef, OtegeCardDef } from '../../engine/types';
import { useNav } from '../../router';
import { CardMini } from '../../ui/card/CardMini';
import { DiceDoodle, StarDoodle } from '../../ui/common/Doodles';
import { OtegeArt } from '../../ui/common/OtegeArt';
import { turnPage } from '../../ui/common/PageTurn';
import { RoughBox } from '../../ui/rough/RoughBox';
import { RoughButton } from '../../ui/rough/RoughButton';
import { tiltStyle } from '../../ui/rough/seed';
import { type Dict, type Lang, local } from '../../i18n';
import { useLang, useT } from '../../i18n/useT';
import './rules.css';

/**
 * S07 ルールせつめい（SPEC §7。P1）
 * ノートのページをめくる形式で6ページ。§4 の内容を子ども向けの言葉とイラストで。
 * 各ページの下に「もっと くわしく」の小さな注記。
 * ルールの数（15まい・3たい など）は RuleSet から、アイテムの名前と説明は cards.json から読む（コードに直接書かない）。
 */

const R = DEFAULT_RULES;
const cards = Object.values(CARD_DB).sort((a, b) => a.no - b.no);
const otege = cards.filter((c): c is OtegeCardDef => c.kind === 'otege');
const items = cards.filter((c) => c.kind === 'item');
const normalSample = otege.find((c) => c.rarity === 'normal');
const superSample = otege.find((c) => c.rarity === 'super');
/** ダメージを足すアイテム（「名前 +数」の並び。ダメージ計算の説明用） */
function attackItems(tr: Dict): string {
  return items
    .flatMap((c) => (c.kind === 'item' ? c.effects.filter((e) => e.type === 'addAttack').map((e) => `${c.name} +${e.type === 'addAttack' ? e.amount : 0}`) : []))
    .join(tr.rules.itemListJoin);
}
/** 重ねがけ禁止の説明（SPEC §4-7。cards.json の blockedIfUsedThisTurn から作る） */
function stackRules(tr: Dict): string[] {
  return items
    .filter((c) => c.kind === 'item' && (c.blockedIfUsedThisTurn?.length ?? 0) > 0)
    .map((c) => {
      const names = (c.kind === 'item' ? (c.blockedIfUsedThisTurn ?? []) : []).map((id) => cards.find((x) => x.id === id)?.name ?? id);
      return tr.rules.stackRule(names.join(tr.rules.nameJoin), c.name);
    });
}

type Page = { title: string; body: ReactNode; art: ReactNode; more: ReactNode };

const Mark = ({ children }: { children: ReactNode }) => <span className="rules-mark">{children}</span>;

/** 辞書の文 → 段落。**…** は蛍光ペンの強調、改行は <br /> */
function Paragraphs({ lines }: { lines: string[] }) {
  return (
    <>
      {lines.map((line, i) => (
        <p key={i}>
          {line.split('\n').map((row, j) => (
            <span key={j}>
              {j > 0 && <br />}
              {row.split('**').map((part, k) => (k % 2 === 1 ? <Mark key={k}>{part}</Mark> : part))}
            </span>
          ))}
        </p>
      ))}
    </>
  );
}

/** 6ページ（ルールの数は RuleSet、アイテムの名前と説明は cards.json、文言は辞書から） */
function buildPages(tr: Dict, lang: Lang): Page[] {
  const P = tr.rules;
  return [
    {
      title: P.p1.title,
      body: <Paragraphs lines={P.p1.body(R.koToWin)} />,
      art: (
        <div className="rules-art rules-art--vs">
          <OtegeArt width={240} />
          <DiceDoodle seed="rules-p1-dice" size={80} face={6} float />
        </div>
      ),
      more: P.p1.more,
    },
    {
      title: P.p2.title,
      body: <Paragraphs lines={P.p2.body(R.deckSize, R.superMaxPerDeck, R.initialHand, R.mulliganIfNoOtege)} />,
      art: (
        <div className="rules-art rules-art--cards">
          {normalSample && <CardMini def={normalSample} seed="rules-normal" variant="tile" />}
          {superSample && <CardMini def={superSample} seed="rules-super" variant="tile" />}
        </div>
      ),
      more: P.p2.more,
    },
    {
      title: P.p3.title,
      body: <Paragraphs lines={P.p3.body(R.benchPlacePerTurn, R.benchMax, R.swapCooldownTurns, R.drawEveryNTurns)} />,
      art: (
        <div className="rules-art rules-art--turn">
          <div className="rules-slot">{tr.battle.slotBench}</div>
          <div className="rules-slot rules-slot--active">{tr.battle.slotActive}</div>
          <div className="rules-slot">{tr.battle.slotBench}</div>
          <span className="rules-arrow">⇄</span>
        </div>
      ),
      more: P.p3.more(R.drawEveryNTurns, R.drawEveryNTurns * 2, R.drawEveryNTurns * 3),
    },
    {
      title: P.p4.title,
      body: <Paragraphs lines={P.p4.body()} />,
      art: (
        <div className="rules-art rules-art--attack">
          <DiceDoodle seed="rules-p4-dice" size={110} face={4} />
          {normalSample && <CardMini def={normalSample} seed="rules-attack" variant="tile" />}
        </div>
      ),
      more: P.p4.more(attackItems(tr)),
    },
    {
      title: P.p5.title,
      body: (
        <>
          <Paragraphs lines={P.p5.body()} />
          <ul className="rules-items">
            {items.map((c: CardDef) => (
              <li key={c.no}>
                <b>{c.name}</b>
                {tr.rules.itemSep}
                {c.kind === 'item' ? local(c.text, lang) : ''}
              </li>
            ))}
          </ul>
        </>
      ),
      art: (
        <div className="rules-art rules-art--items">
          {items.slice(0, 4).map((c) => (
            <CardMini key={c.no} def={c} seed={`rules-item-${c.no}`} variant="tile" />
          ))}
        </div>
      ),
      more: [P.p5.moreFullHp, ...stackRules(tr).map((x) => x + P.sentenceEnd), P.p5.moreBench].join(''),
    },
    {
      title: P.p6.title,
      body: <Paragraphs lines={P.p6.body(R.koToWin)} />,
      art: (
        <div className="rules-art rules-art--win">
          {Array.from({ length: R.koToWin }, (_, i) => (
            <StarDoodle key={i} seed={`rules-star-${i}`} size={80} float />
          ))}
        </div>
      ),
      more: P.p6.more,
    },
  ];
}

export function RulesScene() {
  const { go } = useNav();
  const tr = useT();
  const lang = useLang();
  const PAGES = useMemo(() => buildPages(tr, lang), [tr, lang]);
  const [page, setPage] = useState(0);
  const last = PAGES.length - 1;

  const turn = (to: number) => {
    if (to < 0 || to > last || to === page) return;
    // ノートの ページを めくる
    turnPage(document.querySelector<HTMLElement>('.stage'));
    setPage(to);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') turn(page + 1);
      if (e.key === 'ArrowLeft') turn(page - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const p = PAGES[page];
  return (
    <div className="rules-scene">
      <RoughBox seed={`rules-page-${page}`} className="rules-page" paper radius={6}>
        <div className="rules-page__head">
          <h1 className="rules-page__title" style={tiltStyle(`rules-title-${page}`)}>
            {p.title}
          </h1>
          <span className="rules-page__num num">
            {page + 1} / {PAGES.length}
          </span>
        </div>
        <div className="rules-page__main">
          <div className="rules-page__body">{p.body}</div>
          {p.art}
        </div>
        <p className="rules-page__more pencil">
          <b>{tr.rules.more}</b>
          {p.more}
        </p>
      </RoughBox>
      <RoughButton seed="rules-prev" className="rules-nav rules-nav--prev" disabled={page === 0} onClick={() => turn(page - 1)}>
        {tr.rules.prev}
      </RoughButton>
      <RoughButton seed="rules-next" className="rules-nav rules-nav--next" highlight={page < last} disabled={page === last} onClick={() => turn(page + 1)}>
        {tr.rules.next}
      </RoughButton>
      {/* いちばん上に「チュートリアルを もういちど」（UPDATE_v2 §6T-1） */}
      <RoughButton seed="rules-tutorial" className="tutorial-again rules-tutorial" onClick={() => go('tutorial')} data-testid="tutorial-again">
        {tr.tutorial.again}
      </RoughButton>
      <RoughButton seed="rules-back" className="rules-back" onClick={() => go('menu')}>
        {tr.common.back}
      </RoughButton>
    </div>
  );
}
