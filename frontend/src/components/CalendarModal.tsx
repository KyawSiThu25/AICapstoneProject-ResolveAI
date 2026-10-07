import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Calendar as CalendarIcon, X, RefreshCw, ChevronLeft, ChevronRight,
  User, Scissors, Clock, Mail, Plus, Trash2, Pencil, Check
} from 'lucide-react';

import type {
  CalendarBooking, BookingStatus, ServiceItem, StaffItem, ScheduleSettings
} from '../types';

const BACKEND_API_URL = 'http://localhost:8000/api';

const HOUR_PX = 64;
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; // Monday = 0, matching the backend
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DURATION_OPTIONS = [15, 20, 30, 40, 45, 60, 75, 90, 120];

const STATUS_STYLES: Record<BookingStatus, string> = {
  confirmed: 'bg-sky-50 text-sky-950 border-sky-400',
  completed: 'bg-emerald-50 text-emerald-950 border-emerald-500',
  no_show: 'bg-amber-50 text-amber-950 border-amber-500',
  cancelled: 'bg-neutral-100 text-neutral-500 border-neutral-300',
};
const STATUS_LABELS: Record<BookingStatus, string> = {
  confirmed: 'Booked',
  completed: 'Completed',
  no_show: 'No-show',
  cancelled: 'Cancelled',
};

// --- Date helpers (calendar dates are plain YYYY-MM-DD strings, as stored by the backend) ---
const pad = (n: number) => String(n).padStart(2, '0');
const toIsoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
};
const weekdayIndex = (d: Date) => (d.getDay() + 6) % 7;
const toMinutes = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
};
const toHm = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
const formatRange = (start: Date, end: Date) => {
  if (toIsoDate(start) === toIsoDate(end)) {
    return `${DAY_LABELS[weekdayIndex(start)]} ${start.getDate()} ${MONTHS[start.getMonth()]} ${start.getFullYear()}`;
  }
  return `${start.getDate()} ${MONTHS[start.getMonth()]} – ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`;
};

const errorMessage = async (res: Response) => {
  try {
    const data = await res.json();
    return typeof data?.detail === 'string' ? data.detail : 'Something went wrong. Try again.';
  } catch {
    return 'Something went wrong. Try again.';
  }
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = 'schedule' | 'services' | 'staff' | 'settings';

export const CalendarModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [tab, setTab] = useState<Tab>('schedule');
  const [settings, setSettings] = useState<ScheduleSettings | null>(null);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [staff, setStaff] = useState<StaffItem[]>([]);

  const loadCatalog = useCallback(async () => {
    try {
      const [settingsRes, servicesRes, staffRes] = await Promise.all([
        fetch(`${BACKEND_API_URL}/schedule/settings`),
        fetch(`${BACKEND_API_URL}/services`),
        fetch(`${BACKEND_API_URL}/staff`),
      ]);
      setSettings(await settingsRes.json());
      setServices(await servicesRes.json());
      setStaff(await staffRes.json());
    } catch (err) {
      console.error('[Calendar] Error loading catalog:', err);
    }
  }, []);

  useEffect(() => {
    if (isOpen) loadCatalog();
  }, [isOpen, loadCatalog]);

  if (!isOpen) return null;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'schedule', label: 'Schedule' },
    { id: 'services', label: `Services (${services.length})` },
    { id: 'staff', label: `Staff (${staff.length})` },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4 font-serif">
      <div className="bg-white border-4 border-black w-full max-w-7xl h-[94vh] flex flex-col overflow-hidden text-black">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3 border-b-2 border-black flex items-center justify-between bg-neutral-50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-black text-white flex items-center justify-center">
              <CalendarIcon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-display font-bold uppercase text-base tracking-tight text-black">Calendar</h3>
              <p className="font-mono text-[11px] text-neutral-500 uppercase tracking-wider">
                Appointments booked by the AI and your team
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="border border-black p-1 text-black hover:bg-black hover:text-white transition-none cursor-pointer"
            aria-label="Close calendar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-4 sm:px-6 border-b-2 border-black flex gap-1 overflow-x-auto shrink-0">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-2.5 font-mono text-xs uppercase tracking-wider border-b-4 -mb-0.5 whitespace-nowrap cursor-pointer transition-none ${
                tab === t.id ? 'border-black text-black font-bold' : 'border-transparent text-neutral-500 hover:text-black'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 flex flex-col">
          {!settings ? (
            <div className="flex-1 flex items-center justify-center font-mono text-xs uppercase text-neutral-500">
              Loading calendar…
            </div>
          ) : tab === 'schedule' ? (
            <ScheduleView settings={settings} staff={staff} services={services} />
          ) : tab === 'services' ? (
            <ServicesTab services={services} onChanged={loadCatalog} />
          ) : tab === 'staff' ? (
            <StaffTab staff={staff} services={services} onChanged={loadCatalog} />
          ) : (
            <SettingsTab settings={settings} onSaved={setSettings} />
          )}
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// SCHEDULE
// =============================================================================

interface Column {
  key: string;
  title: string;
  subtitle?: string;
  date: string;
  isToday: boolean;
  isClosed: boolean;
  closedLabel?: string;
  bookings: CalendarBooking[];
  onTitleClick?: () => void;
}

const ScheduleView: React.FC<{ settings: ScheduleSettings; staff: StaffItem[]; services: ServiceItem[] }> = ({
  settings, staff
}) => {
  const [view, setView] = useState<'week' | 'day'>('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const [bookings, setBookings] = useState<CalendarBooking[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<CalendarBooking | null>(null);
  const [now, setNow] = useState(() => new Date());

  const days = useMemo(
    () => (view === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(anchor, i)) : [anchor]),
    [view, anchor]
  );
  const rangeStart = toIsoDate(days[0]);
  const rangeEnd = toIsoDate(days[days.length - 1]);
  const todayIso = toIsoDate(now);

  const fetchBookings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_API_URL}/calendar/bookings?start=${rangeStart}&end=${rangeEnd}`);
      const data: CalendarBooking[] = await res.json();
      setBookings(data);
      setSelected(prev => (prev ? data.find(b => b.id === prev.id) ?? null : null));
    } catch (err) {
      console.error('[Calendar] Error fetching bookings:', err);
    } finally {
      setLoading(false);
    }
  }, [rangeStart, rangeEnd]);

  useEffect(() => {
    fetchBookings();
  }, [fetchBookings]);

  // Keep the "now" line moving and pick up AI bookings without a manual refresh
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
      fetchBookings();
    }, 60000);
    return () => window.clearInterval(timer);
  }, [fetchBookings]);

  const openMin = toMinutes(settings.open_time);
  const closeMin = toMinutes(settings.close_time);
  const firstHour = Math.floor(openMin / 60);
  const lastHour = Math.ceil(closeMin / 60);
  const gridHeight = (lastHour - firstHour) * HOUR_PX;
  const hours = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i);

  const activeStaff = staff.filter(s => s.is_active);
  const bookedCount = bookings.filter(b => b.status === 'confirmed' || b.status === 'completed').length;

  const columns: Column[] = useMemo(() => {
    if (view === 'week') {
      return days.map(d => {
        const iso = toIsoDate(d);
        const closed = !settings.working_days.includes(weekdayIndex(d));
        return {
          key: iso,
          title: `${DAY_LABELS[weekdayIndex(d)]} ${d.getDate()}`,
          date: iso,
          isToday: iso === todayIso,
          isClosed: closed,
          closedLabel: 'Closed',
          bookings: bookings.filter(b => b.booking_date === iso),
          onTitleClick: () => {
            setAnchor(d);
            setView('day');
          },
        };
      });
    }

    // Day view: one column per team member, so you can see each barber's day side by side
    const d = days[0];
    const iso = toIsoDate(d);
    const dayBookings = bookings.filter(b => b.booking_date === iso);
    const shopClosed = !settings.working_days.includes(weekdayIndex(d));
    if (activeStaff.length === 0) {
      return [{
        key: iso, title: formatRange(d, d), date: iso, isToday: iso === todayIso,
        isClosed: shopClosed, closedLabel: 'Closed', bookings: dayBookings,
      }];
    }
    const staffIds = new Set(activeStaff.map(s => s.id));
    const cols: Column[] = activeStaff.map(s => ({
      key: `staff-${s.id}`,
      title: s.name,
      subtitle: s.role || undefined,
      date: iso,
      isToday: iso === todayIso,
      isClosed: shopClosed || !s.working_days.includes(weekdayIndex(d)),
      closedLabel: shopClosed ? 'Closed' : 'Day off',
      bookings: dayBookings.filter(b => b.staff_id === s.id),
    }));
    const unassigned = dayBookings.filter(b => !b.staff_id || !staffIds.has(b.staff_id));
    if (unassigned.length > 0) {
      cols.push({
        key: 'unassigned', title: 'Unassigned', date: iso, isToday: iso === todayIso,
        isClosed: false, bookings: unassigned,
      });
    }
    return cols;
  }, [view, days, bookings, settings.working_days, activeStaff, todayIso]);

  const step = view === 'week' ? 7 : 1;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const showNowLine = nowMin >= firstHour * 60 && nowMin <= lastHour * 60;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Toolbar */}
      <div className="px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-300 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setAnchor(a => addDays(a, -step))}
            className="border border-black p-1.5 hover:bg-black hover:text-white transition-none cursor-pointer"
            aria-label={view === 'week' ? 'Previous week' : 'Previous day'}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setAnchor(new Date())}
            className="border border-black px-3 py-1 font-mono text-xs uppercase hover:bg-black hover:text-white transition-none cursor-pointer"
          >
            Today
          </button>
          <button
            onClick={() => setAnchor(a => addDays(a, step))}
            className="border border-black p-1.5 hover:bg-black hover:text-white transition-none cursor-pointer"
            aria-label={view === 'week' ? 'Next week' : 'Next day'}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <span className="font-display font-bold text-base sm:text-lg ml-1">{formatRange(days[0], days[days.length - 1])}</span>
          <span className="font-mono text-xs text-neutral-500">{bookedCount} booked</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchBookings}
            className="border border-black p-1.5 hover:bg-black hover:text-white transition-none cursor-pointer"
            aria-label="Refresh bookings"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <div className="flex border border-black font-mono text-xs uppercase">
            {(['day', 'week'] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1 cursor-pointer transition-none ${view === v ? 'bg-black text-white font-bold' : 'hover:bg-neutral-100'}`}
              >
                {v === 'day' ? (activeStaff.length ? 'Day · by staff' : 'Day') : 'Week'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* Grid */}
        <div className="flex-1 min-w-0 overflow-auto">
          <div style={{ minWidth: 64 + columns.length * 150 }}>
            {/* Column headers */}
            <div className="flex sticky top-0 z-20 bg-white border-b-2 border-black">
              <div className="w-16 shrink-0 border-r border-neutral-300 font-mono text-[10px] text-neutral-400 flex items-end justify-end p-1">UTC</div>
              {columns.map(col => (
                <button
                  key={col.key}
                  type="button"
                  onClick={col.onTitleClick}
                  disabled={!col.onTitleClick}
                  className={`flex-1 min-w-[150px] px-2 py-2 text-center border-r border-neutral-300 last:border-r-0 ${
                    col.isToday && view === 'week' ? 'bg-black text-white' : col.isClosed ? 'bg-neutral-100 text-neutral-500' : 'bg-white'
                  } ${col.onTitleClick ? 'cursor-pointer hover:underline' : 'cursor-default'}`}
                  title={col.onTitleClick ? 'Open this day by staff member' : undefined}
                >
                  <div className="font-display font-bold text-sm truncate">{col.title}</div>
                  {(col.subtitle || col.isClosed) && (
                    <div className={`font-mono text-[10px] uppercase truncate ${col.isToday && view === 'week' ? 'text-neutral-300' : 'text-neutral-500'}`}>
                      {col.isClosed ? col.closedLabel : col.subtitle}
                    </div>
                  )}
                </button>
              ))}
            </div>

            {/* Body */}
            <div className="flex relative" style={{ height: gridHeight }}>
              {/* Hour labels */}
              <div className="w-16 shrink-0 border-r border-neutral-300 relative">
                {hours.map(h => (
                  <div
                    key={h}
                    className="absolute right-2 font-mono text-[11px] text-neutral-500 -translate-y-1/2"
                    style={{ top: (h - firstHour) * HOUR_PX }}
                  >
                    {h > firstHour ? toHm(h * 60) : ''}
                  </div>
                ))}
              </div>

              {columns.map(col => (
                <DayColumn
                  key={col.key}
                  column={col}
                  firstHour={firstHour}
                  hours={hours}
                  openMin={openMin}
                  closeMin={closeMin}
                  lastHour={lastHour}
                  selectedId={selected?.id}
                  onSelect={setSelected}
                  nowTop={col.date === todayIso && showNowLine ? ((nowMin - firstHour * 60) / 60) * HOUR_PX : null}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Booking details */}
        {selected && (
          <BookingDetails
            booking={selected}
            onClose={() => setSelected(null)}
            onChanged={fetchBookings}
          />
        )}
      </div>

      {/* Legend */}
      <div className="px-4 sm:px-6 py-2 border-t border-neutral-300 flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase text-neutral-600 shrink-0">
        {(Object.keys(STATUS_LABELS) as BookingStatus[]).map(s => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`w-3 h-3 border-l-4 ${STATUS_STYLES[s]}`} />
            {STATUS_LABELS[s]}
          </span>
        ))}
        <span className="ml-auto normal-case font-serif text-[11px] text-neutral-500">
          {view === 'week' ? 'Click a day heading to see it by staff member.' : 'Click a booking to update its status.'}
        </span>
      </div>
    </div>
  );
};

const DayColumn: React.FC<{
  column: Column;
  firstHour: number;
  lastHour: number;
  hours: number[];
  openMin: number;
  closeMin: number;
  selectedId?: number;
  onSelect: (b: CalendarBooking) => void;
  nowTop: number | null;
}> = ({ column, firstHour, lastHour, hours, openMin, closeMin, selectedId, onSelect, nowTop }) => {
  const minutesToPx = (m: number) => ((m - firstHour * 60) / 60) * HOUR_PX;

  // Bookings that overlap in time (e.g. two barbers at 10:00 in week view) sit side by side in lanes
  const placed = useMemo(() => {
    const sorted = [...column.bookings].sort((a, b) => toMinutes(a.booking_time) - toMinutes(b.booking_time));
    const laneEnds: number[] = [];
    const items = sorted.map(b => {
      const start = toMinutes(b.booking_time);
      const end = start + (b.duration_minutes || 30);
      let lane = laneEnds.findIndex(e => e <= start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(end);
      } else {
        laneEnds[lane] = end;
      }
      return { booking: b, start, end, lane };
    });
    return { items, laneCount: Math.max(1, laneEnds.length) };
  }, [column.bookings]);

  return (
    <div className={`flex-1 min-w-[150px] relative border-r border-neutral-200 last:border-r-0 ${column.isClosed ? 'bg-neutral-100' : 'bg-white'}`}>
      {/* Outside opening hours */}
      {!column.isClosed && openMin > firstHour * 60 && (
        <div className="absolute inset-x-0 top-0 bg-neutral-100" style={{ height: minutesToPx(openMin) }} />
      )}
      {!column.isClosed && closeMin < lastHour * 60 && (
        <div className="absolute inset-x-0 bottom-0 bg-neutral-100" style={{ top: minutesToPx(closeMin) }} />
      )}

      {/* Hour lines */}
      {hours.map(h => (
        <div key={h} className="absolute inset-x-0 border-t border-neutral-200" style={{ top: (h - firstHour) * HOUR_PX }} />
      ))}
      {hours.map(h => (
        <div key={`half-${h}`} className="absolute inset-x-0 border-t border-dashed border-neutral-100" style={{ top: (h - firstHour) * HOUR_PX + HOUR_PX / 2 }} />
      ))}

      {/* Now line */}
      {nowTop !== null && (
        <div className="absolute inset-x-0 z-10 pointer-events-none" style={{ top: nowTop }}>
          <div className="border-t-2 border-red-600 relative">
            <span className="absolute -left-1 -top-[5px] w-2 h-2 bg-red-600" />
          </div>
        </div>
      )}

      {/* Bookings */}
      {placed.items.map(({ booking, start, end, lane }) => {
        const top = minutesToPx(start);
        const height = Math.max(((end - start) / 60) * HOUR_PX - 2, 24);
        const width = 100 / placed.laneCount;
        const compact = height < 52;
        const isSelected = booking.id === selectedId;
        return (
          <button
            key={booking.id}
            type="button"
            onClick={() => onSelect(booking)}
            className={`absolute z-10 text-left border border-l-4 px-1.5 py-1 overflow-hidden cursor-pointer transition-none ${STATUS_STYLES[booking.status] || STATUS_STYLES.confirmed} ${
              isSelected ? 'outline-2 outline-black outline-offset-1' : 'hover:brightness-95'
            }`}
            style={{ top: top + 1, height, left: `calc(${lane * width}% + 2px)`, width: `calc(${width}% - 4px)` }}
            title={`${booking.booking_time}–${toHm(end)} · ${booking.service_type}${booking.staff_name ? ` · ${booking.staff_name}` : ''} · ${booking.visitor_name}`}
          >
            <div className={`font-mono text-[10px] font-bold leading-tight ${booking.status === 'cancelled' ? 'line-through' : ''}`}>
              {booking.booking_time}–{toHm(end)}{compact ? ` · ${booking.service_type}` : ''}
            </div>
            {!compact && (
              <>
                <div className="font-display font-bold text-xs leading-tight truncate flex items-center gap-1 mt-0.5">
                  <Scissors className="w-3 h-3 shrink-0" />
                  <span className="truncate">{booking.service_type}</span>
                </div>
                {booking.staff_name && (
                  <div className="font-serif text-[11px] leading-tight truncate flex items-center gap-1">
                    <User className="w-3 h-3 shrink-0" />
                    <span className="truncate">{booking.staff_name}</span>
                  </div>
                )}
                <div className="font-serif text-[11px] leading-tight truncate opacity-75">{booking.visitor_name}</div>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
};

const BookingDetails: React.FC<{ booking: CalendarBooking; onClose: () => void; onChanged: () => void }> = ({
  booking, onClose, onChanged
}) => {
  const [saving, setSaving] = useState<BookingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const end = toMinutes(booking.booking_time) + (booking.duration_minutes || 30);

  const setStatus = async (status: BookingStatus) => {
    setSaving(status);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_API_URL}/calendar/bookings/${booking.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        setError(await errorMessage(res));
      } else {
        onChanged();
      }
    } catch {
      setError('Could not reach the server. Check that the backend is running.');
    } finally {
      setSaving(null);
    }
  };

  const actions: { status: BookingStatus; label: string }[] = [
    { status: 'completed', label: 'Mark completed' },
    { status: 'no_show', label: 'Mark no-show' },
    { status: 'cancelled', label: 'Cancel booking' },
    { status: 'confirmed', label: 'Restore as booked' },
  ];

  return (
    <aside className="w-72 shrink-0 border-l-2 border-black bg-white flex flex-col overflow-y-auto">
      <div className="px-4 py-3 border-b border-neutral-300 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase font-bold">Booking #{booking.id}</span>
        <button onClick={onClose} className="border border-black p-0.5 hover:bg-black hover:text-white transition-none cursor-pointer" aria-label="Close details">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="p-4 space-y-3 text-sm">
        <span className={`inline-block border border-l-4 px-2 py-0.5 font-mono text-[10px] uppercase font-bold ${STATUS_STYLES[booking.status]}`}>
          {STATUS_LABELS[booking.status] || booking.status}
        </span>
        <div>
          <div className="font-mono text-[10px] uppercase text-neutral-500">Service</div>
          <div className="font-display font-bold flex items-center gap-1.5"><Scissors className="w-3.5 h-3.5" />{booking.service_type}</div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase text-neutral-500">With</div>
          <div className="flex items-center gap-1.5"><User className="w-3.5 h-3.5" />{booking.staff_name || 'Not assigned'}</div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase text-neutral-500">When (UTC)</div>
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            {booking.booking_date} · {booking.booking_time}–{toHm(end)} ({booking.duration_minutes} min)
          </div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase text-neutral-500">Customer</div>
          <div className="font-bold">{booking.visitor_name}</div>
          {booking.email_or_phone && (
            <div className="flex items-center gap-1.5 text-xs text-neutral-700"><Mail className="w-3 h-3" />{booking.email_or_phone}</div>
          )}
          <div className="font-mono text-[10px] text-neutral-400 truncate">Chat #{booking.conversation_id}</div>
        </div>
      </div>
      <div className="p-4 pt-0 space-y-2">
        {actions.filter(a => a.status !== booking.status).map(a => (
          <button
            key={a.status}
            onClick={() => setStatus(a.status)}
            disabled={saving !== null}
            className={`w-full border-2 py-1.5 font-mono text-xs uppercase font-bold transition-none cursor-pointer disabled:opacity-50 ${
              a.status === 'cancelled' ? 'border-black bg-white hover:bg-black hover:text-white' : 'border-black bg-black text-white hover:bg-white hover:text-black'
            }`}
          >
            {saving === a.status ? 'Saving…' : a.label}
          </button>
        ))}
        {error && <p className="font-mono text-[11px] text-red-700">{error}</p>}
      </div>
    </aside>
  );
};

// =============================================================================
// SERVICES
// =============================================================================

const emptyService = { name: '', duration_minutes: 30, price: '' };

const ServicesTab: React.FC<{ services: ServiceItem[]; onChanged: () => void }> = ({ services, onChanged }) => {
  const [form, setForm] = useState(emptyService);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setError(null);
    const existing = services.find(s => s.id === editingId);
    const body = {
      name: form.name.trim(),
      duration_minutes: Number(form.duration_minutes),
      price: form.price === '' ? null : Number(form.price),
      is_active: existing ? existing.is_active : true,
    };
    const res = await fetch(`${BACKEND_API_URL}/services${editingId ? `/${editingId}` : ''}`, {
      method: editingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setError(await errorMessage(res));
      return;
    }
    setForm(emptyService);
    setEditingId(null);
    onChanged();
  };

  const update = async (s: ServiceItem, changes: Partial<ServiceItem>) => {
    await fetch(`${BACKEND_API_URL}/services/${s.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...s, ...changes }),
    });
    onChanged();
  };

  const remove = async (s: ServiceItem) => {
    await fetch(`${BACKEND_API_URL}/services/${s.id}`, { method: 'DELETE' });
    if (editingId === s.id) {
      setEditingId(null);
      setForm(emptyService);
    }
    onChanged();
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
      <form onSubmit={save} className="border-2 border-black bg-neutral-50 p-4 grid grid-cols-1 sm:grid-cols-[1fr_140px_120px_auto] gap-3 items-end">
        <label className="block">
          <span className="font-mono text-[10px] uppercase font-bold">Service name</span>
          <input
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Skin Fade"
            className="w-full border-2 border-black bg-white px-3 py-1.5 text-sm focus:outline-none"
            required
          />
        </label>
        <label className="block">
          <span className="font-mono text-[10px] uppercase font-bold">Duration</span>
          <select
            value={form.duration_minutes}
            onChange={e => setForm({ ...form, duration_minutes: Number(e.target.value) })}
            className="w-full border-2 border-black bg-white px-2 py-1.5 font-mono text-xs focus:outline-none"
          >
            {DURATION_OPTIONS.map(m => <option key={m} value={m}>{m} min</option>)}
          </select>
        </label>
        <label className="block">
          <span className="font-mono text-[10px] uppercase font-bold">Price ($)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.price}
            onChange={e => setForm({ ...form, price: e.target.value })}
            placeholder="Optional"
            className="w-full border-2 border-black bg-white px-3 py-1.5 text-sm focus:outline-none"
          />
        </label>
        <div className="flex gap-2">
          <button type="submit" className="border-2 border-black bg-black text-white hover:bg-white hover:text-black px-4 py-1.5 font-mono text-xs uppercase font-bold flex items-center gap-1.5 transition-none cursor-pointer">
            {editingId ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            {editingId ? 'Save' : 'Add service'}
          </button>
          {editingId && (
            <button type="button" onClick={() => { setEditingId(null); setForm(emptyService); }} className="border-2 border-black px-3 py-1.5 font-mono text-xs uppercase cursor-pointer">
              Cancel
            </button>
          )}
        </div>
        {error && <p className="sm:col-span-4 font-mono text-[11px] text-red-700">{error}</p>}
      </form>

      {services.length === 0 ? (
        <EmptyState
          title="No services yet"
          body="Add the services customers can book. The AI uses each service's duration to find free times and tells customers the price."
        />
      ) : (
        <div className="overflow-x-auto border-2 border-black">
          <table className="w-full text-sm">
            <thead className="bg-neutral-100 font-mono text-[10px] uppercase text-left">
              <tr>
                <th className="px-3 py-2">Service</th>
                <th className="px-3 py-2">Duration</th>
                <th className="px-3 py-2">Price</th>
                <th className="px-3 py-2">Bookable</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {services.map(s => (
                <tr key={s.id} className={`border-t border-neutral-300 ${s.is_active ? '' : 'text-neutral-400'}`}>
                  <td className="px-3 py-2 font-display font-bold">{s.name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{s.duration_minutes} min</td>
                  <td className="px-3 py-2 font-mono text-xs">{s.price != null ? `$${s.price}` : '—'}</td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => update(s, { is_active: !s.is_active })}
                      className={`border px-2 py-0.5 font-mono text-[10px] uppercase cursor-pointer ${s.is_active ? 'border-black bg-black text-white' : 'border-neutral-400 text-neutral-500'}`}
                    >
                      {s.is_active ? 'On' : 'Off'}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1.5">
                      <button
                        onClick={() => { setEditingId(s.id); setForm({ name: s.name, duration_minutes: s.duration_minutes, price: s.price != null ? String(s.price) : '' }); }}
                        className="border border-black p-1 hover:bg-black hover:text-white transition-none cursor-pointer"
                        aria-label={`Edit ${s.name}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => remove(s)}
                        className="border border-black p-1 hover:bg-black hover:text-white transition-none cursor-pointer"
                        aria-label={`Delete ${s.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// =============================================================================
// STAFF
// =============================================================================

const StaffTab: React.FC<{ staff: StaffItem[]; services: ServiceItem[]; onChanged: () => void }> = ({
  staff, services, onChanged
}) => {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = async (member: StaffItem) => {
    const res = await fetch(`${BACKEND_API_URL}/staff/${member.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(member),
    });
    if (!res.ok) setError(await errorMessage(res));
    onChanged();
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    const res = await fetch(`${BACKEND_API_URL}/staff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), role: role.trim() || null, service_ids: [], working_days: [0, 1, 2, 3, 4], is_active: true }),
    });
    if (!res.ok) {
      setError(await errorMessage(res));
      return;
    }
    setName('');
    setRole('');
    onChanged();
  };

  const remove = async (member: StaffItem) => {
    await fetch(`${BACKEND_API_URL}/staff/${member.id}`, { method: 'DELETE' });
    onChanged();
  };

  const toggle = (list: number[], value: number) =>
    list.includes(value) ? list.filter(v => v !== value) : [...list, value].sort((a, b) => a - b);

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
      <form onSubmit={add} className="border-2 border-black bg-neutral-50 p-4 grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
        <label className="block">
          <span className="font-mono text-[10px] uppercase font-bold">Name</span>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Dani Okafor" required
            className="w-full border-2 border-black bg-white px-3 py-1.5 text-sm focus:outline-none" />
        </label>
        <label className="block">
          <span className="font-mono text-[10px] uppercase font-bold">Role</span>
          <input value={role} onChange={e => setRole(e.target.value)} placeholder="e.g. Fade specialist (optional)"
            className="w-full border-2 border-black bg-white px-3 py-1.5 text-sm focus:outline-none" />
        </label>
        <button type="submit" className="border-2 border-black bg-black text-white hover:bg-white hover:text-black px-4 py-1.5 font-mono text-xs uppercase font-bold flex items-center gap-1.5 transition-none cursor-pointer">
          <Plus className="w-3.5 h-3.5" /> Add team member
        </button>
        {error && <p className="sm:col-span-3 font-mono text-[11px] text-red-700">{error}</p>}
      </form>

      {staff.length === 0 ? (
        <EmptyState
          title="No team members yet"
          body="Add the people customers book with. Each booking is assigned to someone who offers that service and works that day, and their name shows on the schedule."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {staff.map(m => (
            <div key={m.id} className={`border-2 p-4 space-y-3 ${m.is_active ? 'border-black' : 'border-neutral-300 text-neutral-500'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-display font-bold text-base truncate">{m.name}</div>
                  <div className="font-mono text-[11px] text-neutral-500 truncate">{m.role || 'No role set'}</div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button
                    onClick={() => save({ ...m, is_active: !m.is_active })}
                    className={`border px-2 py-0.5 font-mono text-[10px] uppercase cursor-pointer ${m.is_active ? 'border-black bg-black text-white' : 'border-neutral-400'}`}
                    title={m.is_active ? 'Taking bookings. Click to pause.' : 'Not taking bookings. Click to resume.'}
                  >
                    {m.is_active ? 'Taking bookings' : 'Paused'}
                  </button>
                  <button onClick={() => remove(m)} className="border border-black p-1 hover:bg-black hover:text-white transition-none cursor-pointer" aria-label={`Remove ${m.name}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div>
                <div className="font-mono text-[10px] uppercase font-bold mb-1">Works on</div>
                <div className="flex flex-wrap gap-1">
                  {DAY_LABELS.map((label, idx) => (
                    <button
                      key={label}
                      onClick={() => save({ ...m, working_days: toggle(m.working_days, idx) })}
                      className={`w-11 border py-0.5 font-mono text-[10px] uppercase cursor-pointer transition-none ${
                        m.working_days.includes(idx) ? 'border-black bg-black text-white' : 'border-neutral-300 text-neutral-500 hover:border-black'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="font-mono text-[10px] uppercase font-bold mb-1">
                  Services {m.service_ids.length === 0 && <span className="font-normal text-neutral-500 normal-case">(none selected = offers every service)</span>}
                </div>
                {services.length === 0 ? (
                  <p className="font-serif text-xs text-neutral-500">Add services in the Services tab to choose who does what.</p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {services.map(s => {
                      const on = m.service_ids.length === 0 || m.service_ids.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          onClick={() => {
                            // From "every service", the first click narrows to all-but-this one
                            const base = m.service_ids.length === 0 ? services.map(x => x.id) : m.service_ids;
                            save({ ...m, service_ids: toggle(base, s.id) });
                          }}
                          className={`border px-2 py-0.5 font-serif text-xs cursor-pointer transition-none ${
                            on ? 'border-black bg-white text-black' : 'border-neutral-300 text-neutral-400 line-through hover:border-black'
                          }`}
                        >
                          {s.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// =============================================================================
// SETTINGS
// =============================================================================

const SettingsTab: React.FC<{ settings: ScheduleSettings; onSaved: (s: ScheduleSettings) => void }> = ({ settings, onSaved }) => {
  const [form, setForm] = useState(settings);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => setForm(settings), [settings]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(null);
    const res = await fetch(`${BACKEND_API_URL}/schedule/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      setStatus({ ok: false, text: await errorMessage(res) });
      return;
    }
    onSaved(await res.json());
    setStatus({ ok: true, text: 'Saved. The AI uses these hours from the next message.' });
  };

  const field = 'w-full border-2 border-black bg-white px-3 py-1.5 font-mono text-sm focus:outline-none';

  return (
    <form onSubmit={save} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 max-w-3xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="font-mono text-[10px] uppercase font-bold">Opens at (UTC)</span>
          <input type="time" value={form.open_time} onChange={e => setForm({ ...form, open_time: e.target.value })} className={field} required />
        </label>
        <label className="block">
          <span className="font-mono text-[10px] uppercase font-bold">Closes at (UTC)</span>
          <input type="time" value={form.close_time} onChange={e => setForm({ ...form, close_time: e.target.value })} className={field} required />
        </label>
      </div>

      <div>
        <span className="font-mono text-[10px] uppercase font-bold">Days customers can book</span>
        <div className="flex flex-wrap gap-1 mt-1">
          {DAY_LABELS.map((label, idx) => {
            const on = form.working_days.includes(idx);
            return (
              <button
                key={label}
                type="button"
                onClick={() => setForm({
                  ...form,
                  working_days: on ? form.working_days.filter(d => d !== idx) : [...form.working_days, idx].sort((a, b) => a - b),
                })}
                className={`w-14 border-2 py-1 font-mono text-xs uppercase cursor-pointer transition-none ${on ? 'border-black bg-black text-white' : 'border-neutral-300 text-neutral-500 hover:border-black'}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="font-mono text-[10px] uppercase font-bold">Start times every</span>
          <select value={form.slot_step_minutes} onChange={e => setForm({ ...form, slot_step_minutes: Number(e.target.value) })} className={field}>
            {[10, 15, 20, 30, 60].map(m => <option key={m} value={m}>{m} minutes</option>)}
          </select>
        </label>
        <label className="block">
          <span className="font-mono text-[10px] uppercase font-bold">Length when no service is chosen</span>
          <select value={form.default_duration_minutes} onChange={e => setForm({ ...form, default_duration_minutes: Number(e.target.value) })} className={field}>
            {DURATION_OPTIONS.map(m => <option key={m} value={m}>{m} minutes</option>)}
          </select>
        </label>
        <label className="block">
          <span className="font-mono text-[10px] uppercase font-bold">Minimum notice (hours)</span>
          <input type="number" min="0" max="168" value={form.min_notice_minutes / 60}
            onChange={e => setForm({ ...form, min_notice_minutes: Math.round(Number(e.target.value) * 60) })} className={field} />
        </label>
        <label className="block">
          <span className="font-mono text-[10px] uppercase font-bold">Book up to (days ahead)</span>
          <input type="number" min="1" max="365" value={form.max_days_ahead}
            onChange={e => setForm({ ...form, max_days_ahead: Number(e.target.value) })} className={field} />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" className="border-2 border-black bg-black text-white hover:bg-white hover:text-black px-6 py-2 font-mono text-xs uppercase font-bold transition-none cursor-pointer">
          Save settings
        </button>
        {status && <span className={`font-mono text-xs ${status.ok ? 'text-black' : 'text-red-700'}`}>{status.text}</span>}
      </div>
    </form>
  );
};

const EmptyState: React.FC<{ title: string; body: string }> = ({ title, body }) => (
  <div className="border-2 border-dashed border-neutral-400 p-8 text-center space-y-2">
    <h4 className="font-display font-bold uppercase">{title}</h4>
    <p className="font-serif text-sm text-neutral-600 max-w-md mx-auto">{body}</p>
  </div>
);
