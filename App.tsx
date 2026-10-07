import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Share,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomBar } from './src/components/BottomBar';
import { CalendarSheet } from './src/components/CalendarSheet';
import { EntryRow } from './src/components/EntryRow';
import { QuickAdd } from './src/components/QuickAdd';
import { SearchSheet } from './src/components/SearchSheet';
import { SettingsSheet } from './src/components/SettingsSheet';
import { createSqliteApi, today as todayStr } from './src/data/sqliteStore';
import type { DataApi, DiaryEntry, Food, Meal } from './src/types';

const MEALS: Meal[] = ['reggeli', 'ebed', 'vacsora', 'snack'];
const MEAL_LABEL: Record<Meal, string> = {
  reggeli: 'Reggeli',
  ebed: 'Ebéd',
  vacsora: 'Vacsora',
  snack: 'Snack',
};

function dayLabel(iso: string): string {
  const t = new Date(todayStr() + 'T12:00:00');
  const d = new Date(iso + 'T12:00:00');
  const diff = Math.round((d.getTime() - t.getTime()) / 86400000);
  const rel =
    diff === 0
      ? 'Ma'
      : diff === -1
        ? 'Tegnap'
        : diff === -2
          ? 'Tegnapelőtt'
          : diff === 1
            ? 'Holnap'
            : diff === 2
              ? 'Holnapután'
              : null;
  return rel ? `${rel} · ${iso}` : iso;
}

function shiftIso(iso: string, delta: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function weekAround(center: string): string[] {
  // Mon–Sun containing center
  const d = new Date(center + 'T12:00:00');
  const dow = (d.getDay() + 6) % 7; // Mon=0
  const mon = new Date(d);
  mon.setDate(d.getDate() - dow);
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const x = new Date(mon);
    x.setDate(mon.getDate() + i);
    const y = x.getFullYear();
    const m = String(x.getMonth() + 1).padStart(2, '0');
    const day = String(x.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

const WEEK_SHORT = ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V'];

export default function App() {
  const insets = useSafeAreaInsets();
  const [api, setApi] = useState<DataApi | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [date, setDate] = useState(todayStr());
  const [meal, setMeal] = useState<Meal>('ebed');
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [yesterday, setYesterday] = useState<DiaryEntry[]>([]);
  const [frequent, setFrequent] = useState<Array<Food & { defaultGrams: number }>>([]);
  const [recent, setRecent] = useState<Food[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [scanDirect, setScanDirect] = useState(false);
  const [focusEntryId, setFocusEntryId] = useState<string | null>(null);
  const [kcalGoal, setKcalGoal] = useState(2200);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [loggedDates, setLoggedDates] = useState<Set<string>>(new Set());
  const [dayKcalMap, setDayKcalMap] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    createSqliteApi()
      .then((a) => {
        if (!cancelled) setApi(a);
      })
      .catch((e) => {
        if (!cancelled) setBootError(String(e?.message || e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reloadChips = useCallback(async () => {
    if (!api) return;
    const [y, fq, rc] = await Promise.all([
      api.yesterdaySameMeal(date, meal),
      api.frequentFoods(6),
      api.recentFoods(8),
    ]);
    setYesterday(y);
    setFrequent(fq);
    setRecent(rc);
  }, [api, date, meal]);

  const reload = useCallback(async () => {
    if (!api) return;
    const ents = await api.getEntries(date);
    setEntries(ents);
    void reloadChips();
  }, [api, date, reloadChips]);

  useEffect(() => {
    if (!api) return;
    void (async () => {
      const ents = await api.getEntries(date);
      setEntries(ents);
      await reloadChips();
    })();
  }, [api, date, meal, reloadChips]);

  useEffect(() => {
    if (!api) return;
    api.getKcalGoal().then(setKcalGoal).catch(() => setKcalGoal(2200));
  }, [api]);

  // Load calendar dots for ~3 months around selected date
  useEffect(() => {
    if (!api) return;
    const from = shiftIso(date, -90);
    const to = shiftIso(date, 45);
    Promise.all([api.getLoggedDates(from, to), api.getDayKcalMap(from, to)])
      .then(([dates, map]) => {
        setLoggedDates(new Set(dates));
        setDayKcalMap(map);
      })
      .catch(() => {
        /* ignore */
      });
  }, [api, date]);

  const totals = useMemo(() => {
    return entries.reduce(
      (a, e) => ({
        kcal: a.kcal + e.kcal,
        protein: a.protein + e.protein,
        fat: a.fat + e.fat,
        carbs: a.carbs + e.carbs,
      }),
      { kcal: 0, protein: 0, fat: 0, carbs: 0 }
    );
  }, [entries]);

  const mealTotals = useMemo(() => {
    const m: Record<Meal, number> = { reggeli: 0, ebed: 0, vacsora: 0, snack: 0 };
    for (const e of entries) m[e.meal] += e.kcal;
    return m;
  }, [entries]);

  const weekDays = useMemo(() => weekAround(date), [date]);
  const isToday = date === todayStr();

  async function addFood(food: Food, grams: number, opts?: { keepOpen?: boolean }) {
    if (!api) return;
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const created = await api.addEntry({ date, meal, food, grams });
    // Optimistic: list updates immediately; chips refresh in background
    setEntries((prev) => [...prev, created]);
    void reloadChips();
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      console.log(`[ux] addFood ${Math.round(ms)}ms · ${food.name}`);
    }
    if (opts?.keepOpen) {
      setScanDirect(true);
      return;
    }
    setSearchOpen(false);
    setScanDirect(false);
    setFocusEntryId(created.id);
  }

  async function addYesterday() {
    if (!api) return;
    for (const e of yesterday) {
      const food: Food = {
        id: e.foodId,
        name: e.name,
        kcal100: e.grams ? (e.kcal / e.grams) * 100 : 0,
        protein100: e.grams ? (e.protein / e.grams) * 100 : 0,
        fat100: e.grams ? (e.fat / e.grams) * 100 : 0,
        carbs100: e.grams ? (e.carbs / e.grams) * 100 : 0,
        source: 'history',
      };
      await api.addEntry({ date, meal, food, grams: e.grams });
    }
    await reload();
  }

  function shiftDay(delta: number) {
    setDate(shiftIso(date, delta));
  }

  async function copyYday() {
    if (!api) return;
    await api.copyDay(shiftIso(date, -1), date);
    await reload();
  }

  async function shareDay() {
    const lines = [
      `Fastcal · ${dayLabel(date)}`,
      `${totals.kcal} / ${kcalGoal} kcal`,
      `F ${Math.round(totals.protein)}g · Z ${Math.round(totals.fat)}g · Sz ${Math.round(totals.carbs)}g`,
      '',
    ];
    for (const m of MEALS) {
      const list = entries.filter((e) => e.meal === m);
      if (list.length === 0) continue;
      lines.push(`${MEAL_LABEL[m]} (${mealTotals[m]} kcal)`);
      for (const e of list) {
        lines.push(`  · ${e.name} ${e.grams}g — ${e.kcal} kcal`);
      }
      lines.push('');
    }
    try {
      await Share.share({ message: lines.join('\n').trim() });
    } catch {
      Alert.alert('Nem sikerült megosztani');
    }
  }

  const byMeal = useMemo(() => {
    const m: Record<Meal, DiaryEntry[]> = {
      reggeli: [],
      ebed: [],
      vacsora: [],
      snack: [],
    };
    for (const e of entries) m[e.meal].push(e);
    for (const key of MEALS) {
      m[key] = [...m[key]].sort((a, b) => a.createdAt - b.createdAt);
    }
    return m;
  }, [entries]);

  const topPad = { paddingTop: Math.max(insets.top, StatusBar.currentHeight ?? 0) };
  if (bootError) {
    return (
      <View style={[styles.safe, topPad]}>
        <Text style={styles.bootErr}>SQLite hiba: {bootError}</Text>
      </View>
    );
  }

  if (!api) {
    return (
      <View style={[styles.safe, styles.center, topPad]}>
        <ActivityIndicator color="#3d9cf0" size="large" />
        <Text style={styles.boot}>Adatbázis…</Text>
      </View>
    );
  }

  return (
    <View style={[styles.safe, topPad]}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}
      >
        {/* TOP: info */}
        <View style={styles.head}>
          <Pressable onPress={() => shiftDay(-1)} hitSlop={12}>
            <Text style={styles.nav}>‹</Text>
          </Pressable>
          <View style={{ alignItems: 'center' }}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>Fastcal</Text>
              <Pressable onPress={() => setSettingsOpen(true)} hitSlop={14} style={styles.gearBtn}>
                <Text style={styles.gear}>⚙</Text>
              </Pressable>
              <Pressable onPress={shareDay} hitSlop={10} style={styles.gearBtn}>
                <Text style={styles.share}>↗</Text>
              </Pressable>
            </View>
            <Pressable onPress={() => setCalendarOpen(true)} hitSlop={8}>
              <Text style={styles.date}>{dayLabel(date)} ▾</Text>
            </Pressable>
          </View>
          <Pressable onPress={() => shiftDay(1)} hitSlop={12}>
            <Text style={styles.nav}>›</Text>
          </Pressable>
        </View>

        {/* Week strip */}
        <View style={styles.weekStrip}>
          {weekDays.map((iso, i) => {
            const on = iso === date;
            const has = loggedDates.has(iso);
            const isT = iso === todayStr();
            return (
              <Pressable
                key={iso}
                onPress={() => setDate(iso)}
                style={[styles.weekCell, on && styles.weekCellOn]}
              >
                <Text style={[styles.weekDow, on && styles.weekDowOn]}>{WEEK_SHORT[i]}</Text>
                <Text style={[styles.weekDay, on && styles.weekDayOn, isT && !on && styles.weekToday]}>
                  {Number(iso.slice(8))}
                </Text>
                {has ? <View style={[styles.weekDot, on && styles.weekDotOn]} /> : <View style={styles.weekDotSp} />}
              </Pressable>
            );
          })}
        </View>

        {!isToday ? (
          <Pressable style={styles.jumpToday} onPress={() => setDate(todayStr())}>
            <Text style={styles.jumpTodayText}>← Ma</Text>
          </Pressable>
        ) : null}

        <BottomBar totals={totals} goal={kcalGoal} placement="top" onGoalPress={() => setSettingsOpen(true)} />

        {/* MID: meal tabs + diary */}
        <View style={styles.mealTabsWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.mealTabsScroll}
            contentContainerStyle={styles.mealTabs}
          >
            {MEALS.map((m) => (
              <Pressable
                key={m}
                onPress={() => setMeal(m)}
                style={[styles.tab, meal === m && styles.tabOn]}
              >
                <Text style={[styles.tabText, meal === m && styles.tabTextOn]}>
                  {MEAL_LABEL[m]}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          {MEALS.map((m) => (
            <Pressable
              key={m}
              onPress={() => setMeal(m)}
              style={[styles.card, meal === m && styles.cardOn]}
            >
              <View style={styles.cardHead}>
                <Text style={[styles.cardTitle, meal === m && styles.cardTitleOn]}>
                  {MEAL_LABEL[m]}
                </Text>
                <View style={styles.cardRight}>
                  {mealTotals[m] > 0 ? (
                    <Text style={[styles.cardKcal, meal === m && styles.cardKcalOn]}>
                      {mealTotals[m]} kcal
                    </Text>
                  ) : null}
                  {meal === m ? (
                    <Text style={styles.cardBadge}>aktív</Text>
                  ) : (
                    <Text style={styles.cardHint}>koppints</Text>
                  )}
                </View>
              </View>
              {byMeal[m].length === 0 ? (
                <Text style={styles.empty}>Üres</Text>
              ) : (
                byMeal[m].map((e) => (
                  <EntryRow
                    key={e.id}
                    entry={e}
                    autoFocusGrams={focusEntryId === e.id}
                    onAutoFocusDone={() => setFocusEntryId(null)}
                    onGrams={async (id, g) => {
                      const updated = await api.updateGrams(id, g);
                      setEntries((prev) => prev.map((x) => (x.id === id ? updated : x)));
                    }}
                    onRemove={async (id) => {
                      await api.removeEntry(id);
                      await reload();
                    }}
                  />
                ))
              )}
            </Pressable>
          ))}
        </ScrollView>

        {/* BOTTOM: thumb-zone actions */}
        <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <QuickAdd
            meal={meal}
            yesterday={yesterday}
            frequent={frequent}
            recent={recent}
            onYesterday={addYesterday}
            onFood={addFood}
          />
          <View style={styles.actions}>
            <View style={styles.actionRow}>
              <Pressable
                style={[styles.primary, styles.actionHalf]}
                onPress={() => {
                  setScanDirect(false);
                  setSearchOpen(true);
                }}
              >
                <Text style={styles.primaryText}>+ Keresés</Text>
              </Pressable>
              <Pressable
                style={[styles.scanBtn, styles.actionHalf]}
                onPress={() => {
                  setScanDirect(true);
                  setSearchOpen(true);
                }}
              >
                <Text style={styles.primaryText}>Scan</Text>
              </Pressable>
            </View>
            <View style={styles.actionRow}>
              <Pressable style={[styles.ghost, styles.actionHalf]} onPress={copyYday}>
                <Text style={styles.ghostText}>Tegnap másol</Text>
              </Pressable>
              <Pressable
                style={[styles.goalDock, styles.actionHalf]}
                onPress={() => setSettingsOpen(true)}
              >
                <Text style={styles.goalDockText}>Cél · {kcalGoal}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>

      <SearchSheet
        visible={searchOpen}
        meal={meal}
        api={api}
        startWithScan={scanDirect}
        onClose={() => {
          setSearchOpen(false);
          setScanDirect(false);
        }}
        onPick={addFood}
      />
      <SettingsSheet
        visible={settingsOpen}
        kcalGoal={kcalGoal}
        onClose={() => setSettingsOpen(false)}
        onSave={async (n) => {
          await api.setKcalGoal(n);
          setKcalGoal(n);
        }}
      />
      <CalendarSheet
        visible={calendarOpen}
        selected={date}
        today={todayStr()}
        logged={loggedDates}
        dayKcal={dayKcalMap}
        onClose={() => setCalendarOpen(false)}
        onPick={setDate}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f1419' },
  center: { alignItems: 'center', justifyContent: 'center' },
  boot: { color: '#8b9aab', marginTop: 12 },
  bootErr: { color: '#f07178', padding: 24 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: '#e8eef4', fontSize: 18, fontWeight: '700' },
  gearBtn: { padding: 8, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  gear: { color: '#8b9aab', fontSize: 22 },
  share: { color: '#8b9aab', fontSize: 22, fontWeight: '700' },
  date: { color: '#8b9aab', fontSize: 13, marginTop: 2 },
  nav: { color: '#3d9cf0', fontSize: 32, fontWeight: '300', paddingHorizontal: 8 },
  weekStrip: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingBottom: 6,
    gap: 2,
  },
  weekCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: 10,
  },
  weekCellOn: { backgroundColor: '#1a2a3a' },
  weekDow: { color: '#5a6a7a', fontSize: 10, fontWeight: '600' },
  weekDowOn: { color: '#3d9cf0' },
  weekDay: { color: '#e8eef4', fontSize: 15, fontWeight: '700', marginTop: 2 },
  weekDayOn: { color: '#3d9cf0' },
  weekToday: { color: '#3ecf8e' },
  weekDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3ecf8e',
    marginTop: 3,
  },
  weekDotOn: { backgroundColor: '#3d9cf0' },
  weekDotSp: { height: 4, marginTop: 3 },
  jumpToday: {
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 4,
  },
  jumpTodayText: { color: '#3d9cf0', fontSize: 13, fontWeight: '600' },
  mealTabsWrap: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a3542',
  },
  mealTabsScroll: { flexGrow: 0 },
  mealTabs: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingRight: 20,
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1,
  },
  tab: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#1a222c',
    alignItems: 'center',
    minWidth: 88,
  },
  tabOn: {
    backgroundColor: '#3d9cf0',
    borderWidth: 0,
  },
  tabText: { color: '#8b9aab', fontSize: 13, fontWeight: '600' },
  tabTextOn: { color: '#061018', fontWeight: '800' },
  body: { flex: 1, paddingHorizontal: 16 },
  bodyContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingTop: 12,
    paddingBottom: 8,
  },
  dock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2a3542',
    backgroundColor: '#121820',
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 4,
  },
  actions: { gap: 8 },
  actionRow: { flexDirection: 'row', gap: 8 },
  actionHalf: { flex: 1 },
  primary: {
    backgroundColor: '#3d9cf0',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  scanBtn: {
    backgroundColor: '#2a9d6a',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryText: { color: '#061018', fontWeight: '700', fontSize: 16 },
  ghost: {
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a3542',
  },
  ghostText: { color: '#8b9aab', fontWeight: '600' },
  goalDock: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#1a2a3a',
    borderWidth: 1,
    borderColor: '#3d9cf0',
    minHeight: 48,
    justifyContent: 'center',
  },
  goalDockText: { color: '#3d9cf0', fontWeight: '800', fontSize: 15 },
  card: {
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: '#151c24',
    borderWidth: 1,
    borderColor: '#243040',
    minHeight: 72,
  },
  cardOn: {
    backgroundColor: '#1a2a3a',
    borderColor: '#3d9cf0',
    borderWidth: 2,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    minHeight: 28,
  },
  cardRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: {
    color: '#8b9aab',
    fontSize: 15,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  cardTitleOn: { color: '#3d9cf0' },
  cardKcal: { color: '#5a6a7a', fontSize: 12, fontWeight: '600' },
  cardKcalOn: { color: '#8b9aab' },
  cardBadge: {
    color: '#061018',
    backgroundColor: '#3d9cf0',
    overflow: 'hidden',
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  cardHint: { color: '#5a6a7a', fontSize: 12 },
  empty: { color: '#5a6a7a', fontSize: 13, paddingVertical: 8 },
});
