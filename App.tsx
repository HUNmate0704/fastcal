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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomBar } from './src/components/BottomBar';
import { EntryRow } from './src/components/EntryRow';
import { QuickAdd } from './src/components/QuickAdd';
import { SearchSheet } from './src/components/SearchSheet';
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

  const reload = useCallback(async () => {
    if (!api) return;
    const [ents, y, fq, rc] = await Promise.all([
      api.getEntries(date),
      api.yesterdaySameMeal(date, meal),
      api.frequentFoods(6),
      api.recentFoods(8),
    ]);
    setEntries(ents);
    setYesterday(y);
    setFrequent(fq);
    setRecent(rc);
  }, [api, date, meal]);

  useEffect(() => {
    reload();
  }, [reload]);

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

  async function addFood(food: Food, grams: number, opts?: { keepOpen?: boolean }) {
    if (!api) return;
    const created = await api.addEntry({ date, meal, food, grams });
    await reload();
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
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    setDate(`${y}-${m}-${day}`);
  }

  async function copyYday() {
    if (!api) return;
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    await api.copyDay(d.toISOString().slice(0, 10), date);
    await reload();
  }

  const byMeal = useMemo(() => {
    const m: Record<Meal, DiaryEntry[]> = {
      reggeli: [],
      ebed: [],
      vacsora: [],
      snack: [],
    };
    for (const e of entries) m[e.meal].push(e);
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
            <Text style={styles.title}>Fastcal</Text>
            <Text style={styles.date}>{dayLabel(date)}</Text>
          </View>
          <Pressable onPress={() => shiftDay(1)} hitSlop={12}>
            <Text style={styles.nav}>›</Text>
          </Pressable>
        </View>
        <BottomBar totals={totals} placement="top" />

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

        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 16 }}>
          {MEALS.map((m) => (
            <View
              key={m}
              style={[styles.section, meal === m && styles.sectionOn]}
            >
              <Text style={[styles.sectionTitle, meal === m && styles.sectionTitleOn]}>
                {MEAL_LABEL[m]}
                {meal === m ? ' · aktív' : ''}
              </Text>
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
            </View>
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
            <Pressable style={styles.ghost} onPress={copyYday}>
              <Text style={styles.ghostText}>Tegnapi nap másolása</Text>
            </Pressable>
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
  title: { color: '#e8eef4', fontSize: 18, fontWeight: '700' },
  date: { color: '#8b9aab', fontSize: 13, marginTop: 2 },
  nav: { color: '#3d9cf0', fontSize: 32, fontWeight: '300', paddingHorizontal: 8 },
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
  section: { marginBottom: 14, padding: 8, borderRadius: 12 },
  sectionOn: {
    backgroundColor: '#16202a',
    borderWidth: 1,
    borderColor: '#3d9cf0',
  },
  sectionTitle: {
    color: '#8b9aab',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  sectionTitleOn: { color: '#3d9cf0' },
  empty: { color: '#5a6a7a', fontSize: 13, paddingVertical: 8 },
});
