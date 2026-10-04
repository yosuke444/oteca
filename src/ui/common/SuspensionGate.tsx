import { useEffect, useState } from 'react';
import { features } from '../../config/features';
import type { Dict } from '../../i18n';
import { useT } from '../../i18n/useT';
import { suspendedUntilOf } from '../../online/status';
import { useNav } from '../../router';
import { useSave } from '../../state/SaveContext';
import { RoughButton } from '../rough/RoughButton';
import { Dialog } from './Dialog';
import './common.css';

/** 「アカウントが ていし されています（○月○日まで）」 */
export function suspensionText(tr: Dict, until: number): string {
  if (until === 0) return tr.suspension.ownForever;
  const d = new Date(until);
  return tr.suspension.own(tr.suspension.date(d.getMonth() + 1, d.getDate()));
}

/** 起動した時の知らせは1回だけ */
let noticeShown = false;

/**
 * アカウント停止の確かめ（v2.0-J。SPEC §7 S20）。
 * - block：オンライン（フレンド・レート）・トレードに入った時。停止中なら知らせて、メニューへ戻す
 * - notice：起動した時（メニューに置く）。停止中なら1回だけ知らせる
 * サーバーにつながらない時は確かめずに遊べる
 */
export function SuspensionGate({ mode = 'block' }: { mode?: 'block' | 'notice' }) {
  const tr = useT();
  const { go } = useNav();
  const { save } = useSave();
  const [until, setUntil] = useState<number | null>(null);
  // block：確かめ終わるまで画面を押せなくする（停止中の人が、確かめの返事の前に部屋へ入れないように。つながらない時は最大4秒）
  const [checking, setChecking] = useState(() => mode === 'block' && features.ranking && !!save.userId);
  useEffect(() => {
    if (!features.ranking || !save.userId) return;
    if (mode === 'notice' && noticeShown) return;
    let alive = true;
    void suspendedUntilOf(save.userId, true).then((u) => {
      if (alive) setChecking(false);
      if (!alive || u === null) return;
      if (mode === 'notice') noticeShown = true;
      setUntil(u);
    });
    return () => {
      alive = false;
    };
  }, []);
  if (until === null) return checking ? <div className="suspension-wait" aria-hidden data-testid="suspension-wait" /> : null;
  const close = () => {
    setUntil(null);
    if (mode === 'block') go('menu');
  };
  return (
    <Dialog
      seed="suspension"
      title={tr.suspension.title}
      actions={
        <RoughButton seed="suspension-ok" highlight onClick={close} data-testid="suspension-ok">
          {tr.suspension.ok}
        </RoughButton>
      }
    >
      <p className="red-pen" data-testid="suspension-text">
        {suspensionText(tr, until)}
      </p>
      <p className="pencil">{tr.suspension.blocked}</p>
    </Dialog>
  );
}
