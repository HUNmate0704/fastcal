import React, { useMemo, useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const WEEKDAYS = ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V'];
const MONTHS = [
  'Január',
  'Február',
  'Március',
  'Április',
  'Május',
  'Június',
  'Július',
  'Augusztus',
  'Szeptember',
  'Október',
  'November',
  'December',
];

function isoFromParts(y: number, m0: number, day: number): string {
  const m = String(m0 + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseIso(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m0: m - 1, d };
}

type Props = {
  visible: boolean;
  selected: string;
  today: string;
  /** ISO dates that have at least one diary entry */
  logged: Set<string>;
  /** optional kcal per day for tooltip-style badge */
  dayKcal?: Record<string, number>;
  onClose: () => void;
  onPick: (iso: string) => void;
};

export function CalendarSheet({
  visible,
  selected,
  today,
  logged,
  dayKcal,
  onClose,
  onPick,
}: Props) {
  const insets = useSafeAreaInsets();
  const sel = parseIso(selected);
  const [year, setYear] = useState(sel.y);
  const [month0, setMonth0] = useState(sel.m0);

  React.useEffect(() => {
    if (visible) {
      const p = parseIso(selected);
      setYear(p.y);
      setMonth0(p.m0);
    }
  }, [visible, selected]);

  const cells = useMemo(() => {
    const first = new Date(year, month0, 1);
    // Monday-first: getDay Sun=0 → shift
    let start = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month0 + 1, 0).getDate();
    const out: Array<{ iso: string | null; day: number | null }> = [];
    for (let i = 0; i < start; i++) out.push({ iso: null, day: null });
    for (let d = 1; d <= daysInMonth; d++) {
      out.push({ iso: isoFromParts(year, month0, d), day: d });
    }
    while (out.length % 7 !== 0) out.push({ iso: null, day: null });
    return out;
  }, [year, month0]);

  function shiftMonth(delta: number) {
    const d = new Date(year, month0 + delta, 1);
    setYear(d.getFullYear());
    setMonth0(d.getMonth());
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View
        style={[
          styles.wrap,
          { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 },
        ]}
      >
        <View style={styles.head}>
          <Text style={styles.title}>Naptár</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>Bezár</Text>
          </Pressable>
        </View>

        <View style={styles.monthRow}>
          <Pressable onPress={() => shiftMonth(-1)} hitSlop={12}>
            <Text style={styles.nav}>‹</Text>
          </Pressable>
          <Text style={styles.month}>
            {MONTHS[month0]} {year}
          </Text>
          <Pressable onPress={() => shiftMonth(1)} hitSlop={12}>
            <Text style={styles.nav}>›</Text>
          </Pressable>
        </View>

        <View style={styles.weekHead}>
          {WEEKDAYS.map((w) => (
            <Text key={w} style={styles.weekLabel}>
              {w}
            </Text>
          ))}
        </View>

        <View style={styles.grid}>
          {cells.map((c, i) => {
            if (!c.iso) {
              return <View key={`e-${i}`} style={styles.cell} />;
            }
            const isSel = c.iso === selected;
            const isToday = c.iso === today;
            const has = logged.has(c.iso);
            const kcal = dayKcal?.[c.iso];
            return (
              <Pressable
                key={c.iso}
                style={[
                  styles.cell,
                  isSel && styles.cellSel,
                  isToday && !isSel && styles.cellToday,
                ]}
                onPress={() => {
                  onPick(c.iso!);
                  onClose();
                }}
              >
                <Text
                  style={[
                    styles.dayNum,
                    isSel && styles.dayNumSel,
                    isToday && !isSel && styles.dayNumToday,
                  ]}
                >
                  {c.day}
                </Text>
                {has ? (
                  <View style={[styles.dot, isSel && styles.dotSel]} />
                ) : (
                  <View style={styles.dotSpacer} />
                )}
                {kcal != null && kcal > 0 ? (
                  <Text style={[styles.kcalTiny, isSel && styles.kcalTinySel]} numberOfLines={1}>
                    {kcal}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>

        <Pressable
          style={styles.todayBtn}
          onPress={() => {
            onPick(today);
            onClose();
          }}
        >
          <Text style={styles.todayBtnText}>Ugrás mára</Text>
        </Pressable>

        <Text style={styles.legend}>• = van bejegyzés</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0f1419', paddingHorizontal: 16 },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: { color: '#e8eef4', fontSize: 20, fontWeight: '700' },
  close: { color: '#3d9cf0', fontSize: 16, fontWeight: '600' },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  month: { color: '#e8eef4', fontSize: 17, fontWeight: '700' },
  nav: { color: '#3d9cf0', fontSize: 32, fontWeight: '300', paddingHorizontal: 8 },
  weekHead: { flexDirection: 'row', marginBottom: 6 },
  weekLabel: {
    flex: 1,
    textAlign: 'center',
    color: '#5a6a7a',
    fontSize: 12,
    fontWeight: '600',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: `${100 / 7}%` as unknown as number,
    aspectRatio: 0.85,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    paddingVertical: 4,
  },
  cellSel: { backgroundColor: '#3d9cf0' },
  cellToday: { borderWidth: 1, borderColor: '#3d9cf0' },
  dayNum: { color: '#e8eef4', fontSize: 15, fontWeight: '600' },
  dayNumSel: { color: '#061018', fontWeight: '800' },
  dayNumToday: { color: '#3d9cf0' },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#3ecf8e',
    marginTop: 3,
  },
  dotSel: { backgroundColor: '#061018' },
  dotSpacer: { height: 5, marginTop: 3 },
  kcalTiny: { color: '#5a6a7a', fontSize: 9, marginTop: 1 },
  kcalTinySel: { color: '#061018' },
  todayBtn: {
    marginTop: 20,
    backgroundColor: '#1a222c',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a3542',
  },
  todayBtnText: { color: '#3d9cf0', fontWeight: '700', fontSize: 15 },
  legend: { color: '#5a6a7a', fontSize: 12, marginTop: 12, textAlign: 'center' },
});
