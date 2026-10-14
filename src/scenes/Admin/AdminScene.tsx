import { useEffect, useState, type ReactNode } from 'react';
import { type AdminFn, adminCodeList, findAdminCode } from '../../admin/codes';
import { TROPHY, trophyDef } from '../../data/cards';
import type { Dict } from '../../i18n';
import { useT } from '../../i18n/useT';
import { adminCall, isAdmin, logoutAdmin } from '../../online/adminApi';
import { safeName } from '../../online/names';
import { useNav } from '../../router';
import { formatUserId, parseUserIdInput } from '../../save/userId';
import { CardDetail } from '../../ui/card/CardDetail';
import { copyText } from '../../ui/common/copyText';
import { RoughBox } from '../../ui/rough/RoughBox';
import { RoughButton } from '../../ui/rough/RoughButton';
import './admin.css';

/** 管理者メニュー（S20）に渡すもの：最初に開く機能と、ユーザーID（検索の行から移った時） */
export type AdminPayload = { fn?: AdminFn; userId?: string } | null;

type User = { id: string; name: string; rate: number; wins: number; losses: number };

/**
 * S20 管理者メニュー（v2.0-J。企画者の指示「管理者メニュー（チートコード）」）
 * コードを入れて機能を選ぶ：大会閲覧・ギフトトロフィあげ・アカウント停止・停止解除・検索・かんりログ
 */
export function AdminScene() {
  const tr = useT();
  const { go, payload } = useNav();
  const p = (payload as AdminPayload) ?? null;
  const [fn, setFn] = useState<AdminFn | null>(p?.fn ?? null);
  const [presetId, setPresetId] = useState(p?.userId ?? '');
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [, setTick] = useState(0);
  const open = (f: AdminFn, userId = '') => {
    setPresetId(userId);
    setFn(f);
    setTick((n) => n + 1);
  };

  if (!isAdmin()) {
    return (
      <div className="admin-scene" data-testid="admin-scene">
        <h1 className="admin-scene__title">{tr.admin.title}</h1>
        <p className="admin-scene__expired red-pen">{tr.admin.expired}</p>
        <RoughButton seed="admin-back" className="admin-scene__back" onClick={() => go('settings')}>
          {tr.common.back}
        </RoughButton>
      </div>
    );
  }

  return (
    <div className="admin-scene" data-testid="admin-scene">
      <h1 className="admin-scene__title">{tr.admin.title}</h1>
      <div className="admin-scene__top">
        <RoughButton
          seed="admin-logout"
          className="admin-scene__small"
          onClick={() => {
            logoutAdmin();
            go('settings');
          }}
        >
          {tr.admin.logout}
        </RoughButton>
        <RoughButton seed="admin-menu" className="admin-scene__small" onClick={() => go('menu')}>
          {tr.admin.menuBack}
        </RoughButton>
      </div>
      <div className="admin-code">
        <label className="admin-field admin-field--row">
          <span>{tr.admin.codeLabel}</span>
          <input
            className="pen-input admin-field__input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.currentTarget.nextElementSibling as HTMLElement | null)?.click();
            }}
            data-testid="admin-code"
          />
          <RoughButton
            seed="admin-code-go"
            className="admin-code__go"
            highlight
            onClick={() => {
              const f = findAdminCode(code, tr.admin.codeWords);
              if (!f) return setNote(tr.admin.unknownCode);
              setNote('');
              setCode('');
              open(f);
            }}
            data-testid="admin-code-go"
          >
            {tr.admin.codeGo}
          </RoughButton>
        </label>
        <p className="admin-code__list pencil">{tr.admin.codes(adminCodeList(tr.admin.codeWords).join(tr.admin.codeSep))}</p>
        {note && <p className="admin-note red-pen">{note}</p>}
      </div>
      <RoughBox seed={`admin-panel-${fn ?? 'none'}`} className="admin-panel" paper radius={10}>
        <div className="admin-panel__inner" data-testid={`admin-panel-${fn ?? 'none'}`}>
          {fn === 'watch' && <WatchPanel />}
          {fn === 'trophy' && <TrophyPanel key={`t-${presetId}`} initialId={presetId} />}
          {fn === 'suspend' && <SuspendPanel key={`s-${presetId}`} initialId={presetId} />}
          {fn === 'unsuspend' && <UnsuspendPanel key={`u-${presetId}`} initialId={presetId} />}
          {fn === 'search' && <SearchPanel onTrophy={(id) => open('trophy', id)} onSuspend={(id) => open('suspend', id)} />}
          {fn === 'log' && <LogPanel />}
          {fn === 'ranking' && <RankingPanel />}
        </div>
      </RoughBox>
    </div>
  );
}

// ---------------------------------------------------------------- 共通

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="admin-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

/** ユーザーID を入れて、相手を調べる（トロフィー・停止・停止解除で共通） */
function useUserLookup(initialId: string) {
  const tr = useT();
  const [idText, setIdText] = useState(initialId ? formatUserId(initialId) : '');
  const [user, setUser] = useState<User | null>(null);
  const [suspendedUntil, setSuspendedUntil] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const lookup = async (): Promise<boolean> => {
    const id = parseUserIdInput(idText);
    if (!id) {
      setNote(tr.admin.badId);
      return false;
    }
    setNote(tr.admin.working);
    const r = await adminCall<{ user: User; suspendedUntil: number | null }>('/admin/user', { userId: id });
    if (!r.ok) {
      setNote(r.status === 404 ? tr.admin.noUser : r.status === 401 ? tr.admin.expired : tr.admin.failed);
      return false;
    }
    setNote('');
    setUser(r.data.user);
    setSuspendedUntil(r.data.suspendedUntil);
    return true;
  };
  const who = user ? `${formatUserId(user.id)} ${tr.admin.userLine(safeName(user.name, '') || tr.admin.search.dash, user.rate)}` : '';
  return { idText, setIdText, user, suspendedUntil, note, setNote, lookup, who };
}

function untilText(tr: ReturnType<typeof useT>, until: number): string {
  if (until === 0) return tr.admin.suspend.forever;
  const d = new Date(until);
  return tr.admin.suspend.until(tr.admin.date(d.getFullYear(), d.getMonth() + 1, d.getDate()));
}

// ---------------------------------------------------------------- 大会閲覧

function WatchPanel() {
  const tr = useT();
  const { go } = useNav();
  const [room, setRoom] = useState('');
  const [note, setNote] = useState('');
  const ok = /^[0-9]{4,8}$/.test(room);
  return (
    <div className="admin-form">
      <Field label={tr.admin.watch.room}>
        <input className="pen-input admin-field__input" inputMode="numeric" value={room} onChange={(e) => setRoom(e.target.value.replace(/[^0-9]/g, '').slice(0, 8))} data-testid="admin-watch-room" />
      </Field>
      <RoughButton
        seed="admin-watch-go"
        className="admin-form__go"
        highlight={ok}
        disabled={!ok}
        onClick={async () => {
          // 管理者か Worker で確かめて（記録も残して）から観戦する
          setNote(tr.admin.working);
          const r = await adminCall('/admin/watch', { room });
          if (!r.ok) return setNote(r.status === 401 ? tr.admin.expired : tr.admin.failed);
          go('spectate', { room });
        }}
        data-testid="admin-watch-go"
      >
        {tr.admin.watch.go}
      </RoughButton>
      {note && <p className="admin-note pencil">{note}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- ギフトトロフィあげ

function TrophyPanel({ initialId }: { initialId: string }) {
  const tr = useT();
  const u = useUserLookup(initialId);
  const [step, setStep] = useState<'id' | 'number' | 'confirm' | 'done'>('id');
  const [numText, setNumText] = useState('');
  const num = Number(numText);
  const numOk = /^[0-9]{1,6}$/.test(numText) && num >= 1 && num <= TROPHY.numberMax;
  const send = async () => {
    u.setNote(tr.admin.working);
    const r = await adminCall('/admin/trophy', { userId: u.user!.id, number: num });
    if (r.ok) {
      u.setNote('');
      setStep('done');
      return;
    }
    u.setNote(r.status === 409 ? tr.admin.trophy.used : r.status === 404 ? tr.admin.noUser : r.status === 401 ? tr.admin.expired : tr.admin.failed);
    if (r.status === 409) setStep('number');
  };
  return (
    <div className="admin-form">
      {step === 'id' && (
        <>
          <Field label={tr.admin.trophy.userId}>
            <input className="pen-input admin-field__input" value={u.idText} onChange={(e) => u.setIdText(e.target.value)} data-testid="admin-userid" />
          </Field>
          <RoughButton seed="admin-trophy-id" className="admin-form__go" highlight onClick={() => void u.lookup().then((ok) => ok && setStep('number'))} data-testid="admin-next">
            {tr.admin.next}
          </RoughButton>
        </>
      )}
      {step === 'number' && (
        <>
          <p className="admin-form__who">{tr.admin.trophy.to(u.who)}</p>
          <Field label={tr.admin.trophy.number}>
            <input className="pen-input admin-field__input" inputMode="numeric" value={numText} onChange={(e) => setNumText(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))} data-testid="admin-trophy-number" />
          </Field>
          <RoughButton
            seed="admin-trophy-num"
            className="admin-form__go"
            highlight={numOk}
            onClick={() => (numOk ? (u.setNote(''), setStep('confirm')) : u.setNote(tr.admin.trophy.badNumber))}
            data-testid="admin-next"
          >
            {tr.admin.next}
          </RoughButton>
        </>
      )}
      {step === 'confirm' && (
        <div className="admin-confirm">
          <div className="admin-confirm__card" data-testid="admin-trophy-preview">
            <CardDetail def={trophyDef(num)} seed={`admin-trophy-${num}`} />
          </div>
          <div className="admin-confirm__side">
            <p className="admin-form__who">{tr.admin.trophy.to(u.who)}</p>
            <p>{tr.admin.trophy.confirm}</p>
            <div className="admin-form__buttons">
              <RoughButton seed="admin-trophy-back" onClick={() => setStep('number')}>
                {tr.admin.cancel}
              </RoughButton>
              <RoughButton seed="admin-trophy-send" highlight onClick={() => void send()} data-testid="admin-trophy-send">
                {tr.admin.trophy.send}
              </RoughButton>
            </div>
          </div>
        </div>
      )}
      {step === 'done' && (
        <p className="admin-done blue-pen" data-testid="admin-done">
          {tr.admin.trophy.sent}
        </p>
      )}
      {u.note && (
        <p className="admin-note red-pen" data-testid="admin-note">
          {u.note}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- アカウント停止

const PERIODS = [7, 30, 90, 0] as const;

function SuspendPanel({ initialId }: { initialId: string }) {
  const tr = useT();
  const u = useUserLookup(initialId);
  const [step, setStep] = useState<'id' | 'period' | 'confirm' | 'done'>('id');
  const [days, setDays] = useState<(typeof PERIODS)[number]>(7);
  const [reason, setReason] = useState('');
  const [doneUntil, setDoneUntil] = useState(0);
  const send = async () => {
    u.setNote(tr.admin.working);
    const r = await adminCall<{ until: number }>('/admin/suspend', { userId: u.user!.id, days, reason });
    if (!r.ok) return u.setNote(r.status === 401 ? tr.admin.expired : tr.admin.failed);
    u.setNote('');
    setDoneUntil(r.data.until);
    setStep('done');
  };
  return (
    <div className="admin-form">
      {step === 'id' && (
        <>
          <Field label={tr.admin.suspend.userId}>
            <input className="pen-input admin-field__input" value={u.idText} onChange={(e) => u.setIdText(e.target.value)} data-testid="admin-userid" />
          </Field>
          <RoughButton seed="admin-sus-id" className="admin-form__go" highlight onClick={() => void u.lookup().then((ok) => ok && setStep('period'))} data-testid="admin-next">
            {tr.admin.next}
          </RoughButton>
        </>
      )}
      {step === 'period' && (
        <>
          <p className="admin-form__who">{u.who}</p>
          {u.suspendedUntil !== null && <p className="admin-note red-pen">{tr.admin.suspend.already(untilText(tr, u.suspendedUntil))}</p>}
          <div className="admin-form__row">
            <span>{tr.admin.suspend.period}</span>
            {PERIODS.map((d) => (
              <RoughButton key={d} seed={`admin-days-${d}`} className="admin-choice" highlight={days === d} onClick={() => setDays(d)} data-testid={`admin-days-${d}`}>
                {tr.admin.suspend.days[d]}
              </RoughButton>
            ))}
          </div>
          <Field label={tr.admin.suspend.reason}>
            <input className="pen-input admin-field__input admin-field__input--wide" maxLength={40} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="admin-reason" />
          </Field>
          <RoughButton seed="admin-sus-next" className="admin-form__go" highlight onClick={() => setStep('confirm')} data-testid="admin-next">
            {tr.admin.next}
          </RoughButton>
        </>
      )}
      {step === 'confirm' && (
        <>
          <p className="admin-form__who">{tr.admin.suspend.confirm(u.who, tr.admin.suspend.days[days])}</p>
          <div className="admin-form__buttons">
            <RoughButton seed="admin-sus-back" onClick={() => setStep('period')}>
              {tr.admin.cancel}
            </RoughButton>
            <RoughButton seed="admin-sus-send" highlight stroke="var(--pen-red)" onClick={() => void send()} data-testid="admin-suspend-send">
              {tr.admin.yes}
            </RoughButton>
          </div>
        </>
      )}
      {step === 'done' && (
        <p className="admin-done blue-pen" data-testid="admin-done">
          {tr.admin.suspend.done(untilText(tr, doneUntil))}
        </p>
      )}
      {u.note && (
        <p className="admin-note red-pen" data-testid="admin-note">
          {u.note}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 停止解除

function UnsuspendPanel({ initialId }: { initialId: string }) {
  const tr = useT();
  const u = useUserLookup(initialId);
  const [step, setStep] = useState<'id' | 'confirm' | 'done'>('id');
  const send = async () => {
    u.setNote(tr.admin.working);
    const r = await adminCall('/admin/unsuspend', { userId: u.user!.id });
    if (!r.ok) return u.setNote(r.status === 401 ? tr.admin.expired : tr.admin.failed);
    u.setNote('');
    setStep('done');
  };
  return (
    <div className="admin-form">
      {step === 'id' && (
        <>
          <Field label={tr.admin.unsuspend.userId}>
            <input className="pen-input admin-field__input" value={u.idText} onChange={(e) => u.setIdText(e.target.value)} data-testid="admin-userid" />
          </Field>
          <RoughButton seed="admin-unsus-id" className="admin-form__go" highlight onClick={() => void u.lookup().then((ok) => ok && setStep('confirm'))} data-testid="admin-next">
            {tr.admin.next}
          </RoughButton>
        </>
      )}
      {step === 'confirm' && (
        <>
          <p className="admin-form__who">{u.suspendedUntil === null ? tr.admin.unsuspend.notSuspended : tr.admin.suspend.already(untilText(tr, u.suspendedUntil))}</p>
          <p className="admin-form__who">{tr.admin.unsuspend.confirm(u.who)}</p>
          <div className="admin-form__buttons">
            <RoughButton seed="admin-unsus-back" onClick={() => setStep('id')}>
              {tr.admin.cancel}
            </RoughButton>
            <RoughButton seed="admin-unsus-send" highlight onClick={() => void send()} data-testid="admin-unsuspend-send">
              {tr.admin.yes}
            </RoughButton>
          </div>
        </>
      )}
      {step === 'done' && (
        <p className="admin-done blue-pen" data-testid="admin-done">
          {tr.admin.unsuspend.done}
        </p>
      )}
      {u.note && (
        <p className="admin-note red-pen" data-testid="admin-note">
          {u.note}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 検索

type Row = { id: string; name: string; rate: number; wins: number; losses: number; last_seen: number; trophies: number; suspended_until: number | null };
type Tri = 'any' | 'yes' | 'no';

function SearchPanel({ onTrophy, onSuspend }: { onTrophy: (id: string) => void; onSuspend: (id: string) => void }) {
  const tr = useT();
  const S = tr.admin.search;
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [rateMin, setRateMin] = useState('');
  const [rateMax, setRateMax] = useState('');
  const [seenFrom, setSeenFrom] = useState('');
  const [seenTo, setSeenTo] = useState('');
  const [trophy, setTrophy] = useState<Tri>('any');
  const [suspended, setSuspended] = useState<Tri>('any');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [note, setNote] = useState('');
  const num = (s: string) => (s.trim() === '' ? undefined : Number(s));
  const day = (s: string, end: boolean) => (s ? new Date(`${s}T${end ? '23:59:59' : '00:00:00'}`).getTime() : undefined);
  const run = async (pg: number) => {
    setNote(tr.admin.working);
    const r = await adminCall<{ rows: Row[]; hasNext: boolean }>('/admin/search', {
      name,
      id,
      rateMin: num(rateMin),
      rateMax: num(rateMax),
      seenFrom: day(seenFrom, false),
      seenTo: day(seenTo, true),
      trophy,
      suspended,
      page: pg,
    });
    if (!r.ok) return setNote(r.status === 401 ? tr.admin.expired : tr.admin.failed);
    setNote('');
    setPage(pg);
    setRows(r.data.rows);
    setHasNext(r.data.hasNext);
  };
  const tri = (v: Tri, set: (t: Tri) => void, key: string) => (
    <span className="admin-tri">
      {(['any', 'yes', 'no'] as const).map((t) => (
        <RoughButton key={t} seed={`admin-${key}-${t}`} className="admin-choice admin-choice--small" highlight={v === t} onClick={() => set(t)} data-testid={`admin-${key}-${t}`}>
          {S[t]}
        </RoughButton>
      ))}
    </span>
  );
  const dateOf = (ms: number) => {
    if (!ms) return S.dash;
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };
  return (
    <div className="admin-search">
      <div className="admin-search__form">
        <Field label={S.name}>
          <input className="pen-input admin-field__input admin-field__input--short" value={name} onChange={(e) => setName(e.target.value)} data-testid="admin-search-name" />
        </Field>
        <Field label={S.id}>
          <input className="pen-input admin-field__input admin-field__input--short" value={id} onChange={(e) => setId(e.target.value)} data-testid="admin-search-id" />
        </Field>
        <span className="admin-field">
          <span>{S.rate}</span>
          <input className="pen-input admin-field__num" inputMode="numeric" value={rateMin} onChange={(e) => setRateMin(e.target.value.replace(/[^0-9]/g, ''))} />
          <span>{S.from}</span>
          <input className="pen-input admin-field__num" inputMode="numeric" value={rateMax} onChange={(e) => setRateMax(e.target.value.replace(/[^0-9]/g, ''))} />
          <span>{S.to}</span>
        </span>
        <span className="admin-field">
          <span>{S.seen}</span>
          <input className="pen-input admin-field__date" type="date" value={seenFrom} onChange={(e) => setSeenFrom(e.target.value)} />
          <span>{S.from}</span>
          <input className="pen-input admin-field__date" type="date" value={seenTo} onChange={(e) => setSeenTo(e.target.value)} />
          <span>{S.to}</span>
        </span>
        <span className="admin-field">
          <span>{S.trophy}</span>
          {tri(trophy, setTrophy, 'trophy')}
          <span>{S.suspended}</span>
          {tri(suspended, setSuspended, 'suspended')}
        </span>
        <RoughButton seed="admin-search-go" className="admin-search__go" highlight onClick={() => void run(0)} data-testid="admin-search-go">
          {S.go}
        </RoughButton>
      </div>
      <p className="admin-search__note pencil">{S.note}</p>
      {note && <p className="admin-note red-pen">{note}</p>}
      {rows && (
        <div className="admin-table" data-testid="admin-search-rows">
          <div className="admin-table__head pencil">
            <span>{S.colId}</span>
            <span>{S.colName}</span>
            <span>{S.colRate}</span>
            <span>{S.colRecord}</span>
            <span>{S.colSeen}</span>
            <span>{S.colTrophy}</span>
            <span>{S.colSuspended}</span>
            <span />
          </div>
          {rows.length === 0 && <p className="admin-note pencil">{S.none}</p>}
          {rows.map((r) => (
            <div key={r.id} className="admin-table__row" data-testid="admin-search-row">
              <span className="num">{formatUserId(r.id)}</span>
              <span>{r.name || S.dash}</span>
              <span className="num">{r.rate}</span>
              <span className="num">{S.record(r.wins, r.losses)}</span>
              <span className="num">{dateOf(r.last_seen)}</span>
              <span className="num">{r.trophies}</span>
              <span className={r.suspended_until !== null ? 'red-pen' : ''}>{r.suspended_until !== null ? untilText(tr, r.suspended_until) : S.dash}</span>
              <span className="admin-table__actions">
                <CopyButton text={r.id} label={S.copy} done={S.copied} />
                <RoughButton seed={`admin-row-t-${r.id}`} className="admin-row-btn" onClick={() => onTrophy(r.id)} data-testid="admin-row-trophy">
                  {S.sendTrophy}
                </RoughButton>
                <RoughButton seed={`admin-row-s-${r.id}`} className="admin-row-btn" stroke="var(--pen-red)" onClick={() => onSuspend(r.id)} data-testid="admin-row-suspend">
                  {S.suspend}
                </RoughButton>
              </span>
            </div>
          ))}
          <div className="admin-table__pages">
            <RoughButton seed="admin-prev" className="admin-row-btn" disabled={page === 0} onClick={() => void run(page - 1)}>
              {S.prev}
            </RoughButton>
            <span className="num">{S.page(page + 1)}</span>
            <RoughButton seed="admin-next-page" className="admin-row-btn" disabled={!hasNext} onClick={() => void run(page + 1)}>
              {S.nextPage}
            </RoughButton>
          </div>
        </div>
      )}
    </div>
  );
}

function CopyButton({ text, label, done }: { text: string; label: string; done: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);
  return (
    <RoughButton seed={`copy-${text}`} className="admin-row-btn" onClick={() => void copyText(text).then(setCopied)} data-testid="admin-row-copy">
      {copied ? done : label}
    </RoughButton>
  );
}

// ---------------------------------------------------------------- かんりログ

type LogRow = { id: number; at: number; action: string; target: string; detail: string };

/** かんりログの「なかみ」を文にする（サーバーには JSON で残っている） */
function logDetail(tr: Dict, r: LogRow): string {
  const L = tr.admin.log;
  let d: Record<string, unknown> = {};
  try {
    const v = r.detail ? (JSON.parse(r.detail) as unknown) : {};
    if (v && typeof v === 'object') d = v as Record<string, unknown>;
  } catch {
    return '';
  }
  const sep = tr.admin.codeSep;
  const date = (ms: unknown) => {
    const t = new Date(Number(ms));
    return tr.admin.date(t.getFullYear(), t.getMonth() + 1, t.getDate());
  };
  switch (r.action) {
    case 'trophy':
      return typeof d.number === 'number' ? L.number(d.number) : '';
    case 'suspend': {
      const parts = [tr.admin.suspend.days[Number(d.days)] ?? ''];
      if (typeof d.reason === 'string' && d.reason) parts.push(L.reason(d.reason));
      return parts.filter(Boolean).join(sep);
    }
    case 'search': {
      const S = tr.admin.search;
      const yn = (v: unknown) => (v === 'yes' ? S.yes : S.no);
      const parts: string[] = [];
      if (d.name) parts.push(L.cond(S.name, String(d.name)));
      if (d.id) parts.push(L.cond(S.id, String(d.id)));
      if (d.rateMin !== undefined || d.rateMax !== undefined) parts.push(L.cond(S.rate, `${d.rateMin ?? ''}${S.from} ${d.rateMax ?? ''}${S.to}`));
      if (d.seenFrom !== undefined || d.seenTo !== undefined) parts.push(L.cond(S.seen, `${d.seenFrom !== undefined ? date(d.seenFrom) : ''}${S.from} ${d.seenTo !== undefined ? date(d.seenTo) : ''}${S.to}`));
      if (d.trophy === 'yes' || d.trophy === 'no') parts.push(L.cond(S.trophy, yn(d.trophy)));
      if (d.suspended === 'yes' || d.suspended === 'no') parts.push(L.cond(S.suspended, yn(d.suspended)));
      return parts.join(sep);
    }
  }
  return '';
}

/** ランキング（v2.7）：「ランキングを いま こうしん」（予定の時刻を待たずに、まとめ処理を動かす） */
function RankingPanel() {
  const tr = useT();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  // レート対戦が始まった・つながらなかった件数（v2.7）
  type Starts = { started: number; failed: number; started24h: number; failed24h: number };
  const [starts, setStarts] = useState<Starts | null>(null);
  const [startsFailed, setStartsFailed] = useState(false);
  useEffect(() => {
    void adminCall<{ lobby?: { starts?: Starts } }>('/admin/stats', {}).then((r) => {
      if (r.ok && r.data.lobby?.starts) setStarts(r.data.lobby.starts);
      else setStartsFailed(true);
    });
  }, []);
  const run = async () => {
    setBusy(true);
    setNote(tr.admin.working);
    const r = await adminCall<{ ok?: boolean; error?: string; counted?: number }>('/admin/run-batch', {});
    setBusy(false);
    if (!r.ok) return setNote(r.status === 409 ? tr.admin.rankingBusy : r.status === 401 ? tr.admin.expired : tr.admin.failed);
    if (r.data.error === 'busy') return setNote(tr.admin.rankingBusy);
    const d = new Date();
    setNote(tr.admin.rankingDone(r.data.counted ?? 0, `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`));
  };
  return (
    <div className="admin-form">
      <RoughButton seed="admin-ranking-now" className="admin-form__go" highlight disabled={busy} onClick={() => void run()} data-testid="admin-ranking-now">
        {tr.admin.rankingNow}
      </RoughButton>
      {note && <p className="admin-note blue-pen" data-testid="admin-ranking-note">{note}</p>}
      <p className="admin-note" data-testid="admin-starts">
        {starts ? tr.admin.starts(starts.started24h, starts.failed24h, starts.started, starts.failed) : startsFailed ? tr.admin.failed : tr.admin.working}
      </p>
    </div>
  );
}

function LogPanel() {
  const tr = useT();
  const L = tr.admin.log;
  const [rows, setRows] = useState<LogRow[] | null>(null);
  const [page, setPage] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [note, setNote] = useState('');
  const load = async (pg: number) => {
    const r = await adminCall<{ rows: LogRow[]; hasNext: boolean }>('/admin/log', { page: pg });
    if (!r.ok) return setNote(r.status === 401 ? tr.admin.expired : tr.admin.failed);
    setNote('');
    setRows(r.data.rows);
    setPage(pg);
    setHasNext(r.data.hasNext);
  };
  useEffect(() => {
    void load(0);
  }, []);
  const at = (ms: number) => {
    const d = new Date(ms);
    return tr.admin.time(d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes());
  };
  return (
    <div className="admin-log" data-testid="admin-log">
      {note && <p className="admin-note red-pen">{note}</p>}
      {rows && rows.length === 0 && <p className="admin-note pencil">{L.none}</p>}
      {rows && rows.length > 0 && (
        <div className="admin-table admin-table--log">
          <div className="admin-table__head pencil">
            <span>{L.colAt}</span>
            <span>{L.colAction}</span>
            <span>{L.colTarget}</span>
            <span>{L.colDetail}</span>
          </div>
          {rows.map((r) => (
            <div key={r.id} className="admin-table__row" data-testid="admin-log-row">
              <span className="num">{at(r.at)}</span>
              <span>{L.actions[r.action] ?? r.action}</span>
              <span className="num">{/^[1-9][0-9]{14}$/.test(r.target) ? formatUserId(r.target) : r.target}</span>
              <span className="admin-table__detail">{logDetail(tr, r)}</span>
            </div>
          ))}
          <div className="admin-table__pages">
            <RoughButton seed="admin-log-prev" className="admin-row-btn" disabled={page === 0} onClick={() => void load(page - 1)}>
              {tr.admin.search.prev}
            </RoughButton>
            <span className="num">{tr.admin.search.page(page + 1)}</span>
            <RoughButton seed="admin-log-next" className="admin-row-btn" disabled={!hasNext} onClick={() => void load(page + 1)}>
              {tr.admin.search.nextPage}
            </RoughButton>
          </div>
        </div>
      )}
    </div>
  );
}
