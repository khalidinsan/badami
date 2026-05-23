import { useState, useRef, useEffect } from 'react';
import { Bell, CheckCheck, Trash2, Calendar, AlertTriangle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNotifications } from '@/hooks/useNotifications';
import { ScrollArea } from '@/components/ui/scroll-area';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

const NOTIF_ICONS: Record<string, typeof Bell> = {
  reminder: Clock,
  overdue: AlertTriangle,
  daily_summary: Calendar,
};

export function NotificationBell() {
  const { unreadCount, notifications, markAsRead, markAllAsRead, clearAll } = useNotifications();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  useEffect(() => {
    if (open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen(!open)}
        className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted/40 hover:text-foreground mr-1.5"
      >
        <Bell className="h-3.5 w-3.5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[100]" onClick={() => setOpen(false)} />
          <div
            className="fixed z-[101] w-[300px] rounded-xl border border-border bg-popover shadow-xl"
            style={{ top: pos.top, right: pos.right }}
          >
            <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
              <span className="text-xs font-semibold">Notifications</span>
              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <button onClick={markAllAsRead} className="rounded p-1 text-muted-foreground/60 hover:text-primary" title="Mark all read">
                    <CheckCheck className="h-3 w-3" />
                  </button>
                )}
                {notifications.length > 0 && (
                  <button onClick={() => { clearAll(); setOpen(false); }} className="rounded p-1 text-muted-foreground/60 hover:text-destructive" title="Clear all">
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
            <ScrollArea className="max-h-[320px]">
              {notifications.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground/50">No notifications</p>
              ) : (
                <div className="p-1">
                  {notifications.map((n) => {
                    const Icon = NOTIF_ICONS[n.type] || Bell;
                    return (
                      <div
                        key={n.id}
                        onClick={() => { if (!n.read) markAsRead(n.id); }}
                        className={cn(
                          'flex cursor-pointer gap-2.5 rounded-lg px-2.5 py-2 transition-colors hover:bg-muted/60',
                          !n.read && 'bg-primary/5',
                        )}
                      >
                        <div className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full', !n.read ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
                          <Icon className="h-3 w-3" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={cn('text-xs', !n.read && 'font-medium')}>{n.title}</p>
                          {n.body && <p className="truncate text-[11px] text-muted-foreground/70">{n.body}</p>}
                          <p className="mt-0.5 text-[10px] text-muted-foreground/50">{dayjs(n.created_at).fromNow()}</p>
                        </div>
                        {!n.read && <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </div>
        </>
      )}
    </>
  );
}
