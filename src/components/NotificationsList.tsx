'use client';
import { useCallback, useEffect, useState } from 'react';
import { when } from './crm-labels';

type N = { id: string; kind: string; title: string | null; body: string | null; link: string | null; read_at: string | null; created_at: string };

/** التنبيهات الداخلية للمستخدم (لا إرسال خارجي). فتح التنبيه يعلّمه مقروءًا. */
export function NotificationsList() {
  const [d, setD] = useState<{ items: N[]; unread: number } | null>(null); const [only, setOnly] = useState(false);
  const load = useCallback(async () => {
    const r = await fetch(`/api/notifications?limit=100${only ? '&unread=1' : ''}`).then((x) => x.json()).catch(() => ({}));
    setD(r.ok ? r : { items: [], unread: 0 });
  }, [only]);
  useEffect(() => { void load(); }, [load]);
  const post = (url: string) => fetch(url, { method: 'POST' }).then((x) => x.json()).catch(() => ({}));
  async function open(n: N) {
    if (!n.read_at) await post(`/api/notifications/${n.id}/read`);
    if (n.link) window.location.href = n.link; else void load();
  }
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="seg"><label><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} />غير المقروءة فقط</label></div>
        <button type="button" className="btn line sm" style={{ color: 'var(--ink)', borderColor: '#8FA3C0' }} disabled={!d?.unread} onClick={async () => { await post('/api/notifications/read-all'); await load(); }}>تعليم الكل كمقروء ({d?.unread ?? 0})</button>
      </div>
      {!d && <p className="muted">جارٍ التحميل…</p>}
      {d && !d.items.length && <p className="muted">لا تنبيهات.</p>}
      <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 8 }}>
        {d?.items.map((n) => (
          <li key={n.id} className="card" style={{ borderInlineStart: n.read_at ? undefined : '4px solid var(--navy2)' }}>
            <button type="button" onClick={() => open(n)} style={{ all: 'unset', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4, minHeight: 44 }}>
              <strong style={{ fontWeight: n.read_at ? 500 : 700 }}>{n.title ?? n.kind}</strong>
              {n.body && <span className="muted" style={{ fontSize: 14 }}>{n.body}</span>}
              <span className="muted" style={{ fontSize: 13 }}>{when(n.created_at)}{!n.read_at && ' · جديد'}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
