import { useT } from '../../i18n/useT';

/** 「かり」の印（v2.0-I。端末で計算したレート。赤ペンの小さな丸） */
export function KariMark() {
  const tr = useT();
  return (
    <span className="rate-kari" title={tr.rate.provisionalHint} data-testid="rate-kari">
      {tr.rate.provisional}
    </span>
  );
}

/**
 * レートの表示（v2.0-I）。端末で計算した「かりのレート」の時は、横に「かり」の印を付ける（SPEC §7 S15）
 */
export function RateValue({ value, provisional, format }: { value: number; provisional: boolean; format: (n: number) => string }) {
  return (
    <>
      {format(value)}
      {provisional && <KariMark />}
    </>
  );
}
