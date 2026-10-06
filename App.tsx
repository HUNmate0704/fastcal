import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
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

export default function App() {
  const [api, setApi] = useState<DataApi | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [date, setDate] = useState(todayStr());
  const [meal, setMeal] = useState<Meal>('ebed');
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [yesterday, setYesterday] = useState<DiaryEntry[]>([]);
  const [frequent, setFrequent] = useState<Array<Food & { defaultGrams: number }>>([]);
  const [recent, setRecent] = useState<Food[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);

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

  async function addFood(food: Food, grams: number) {
    if (!api) return;
    await api.addEntry({ date, meal, food, grams });
    setSearchOpen(false);
    await reload();
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
    setDate(d.toISOString().slice(0, 10));
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

  if (bootError) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.bootErr}>SQLite hiba: {bootError}</Text>
      </SafeAreaView>
    );
  }

  if (!api) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <ActivityIndicator color="#3d9cf0" size="large" />
        <Text style={styles.boot}>Adatbázis…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <View style={styles.head}>
        <Pressable onPress={() => shiftDay(-1)} hitSlop={12}>
          <Text style={styles.nav}>‹</Text>
        </Pressable>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.title}>Fastcal</Text>
          <Text style={styles.date}>{date}</Text>
        </View>
        <Pressable onPress={() => shiftDay(1)} hitSlop={12}>
          <Text style={styles.nav}>›</Text>
        </Pressable>
      </View>

      <View style={styles.mealTabs}>
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
      </View>

      <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 24 }}>
        <QuickAdd
          meal={meal}
          yesterday={yesterday}
          frequent={frequent}
          recent={recent}
          onYesterday={addYesterday}
          onFood={addFood}
        />

        <View style={styles.actions}>
          <Pressable style={styles.primary} onPress={() => setSearchOpen(true)}>
            <Text style={styles.primaryText}>+ Keresés / EAN</Text>
          </Pressable>
          <Pressable style={styles.ghost} onPress={copyYday}>
            <Text style={styles.ghostText}>Tegnapi nap másolása</Text>
          </Pressable>
        </View>

        {MEALS.map((m) => (
          <View key={m} style={styles.section}>
            <Text style={styles.sectionTitle}>{MEAL_LABEL[m]}</Text>
            {byMeal[m].length === 0 ? (
              <Text style={styles.empty}>Üres</Text>
            ) : (
              byMeal[m].map((e) => (
                <EntryRow
                  key={e.id}
                  entry={e}
                  onGrams={async (id, g) => {
                    await api.updateGrams(id, g);
                    await reload();
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

      <BottomBar totals={totals} />

      <SearchSheet
        visible={searchOpen}
        meal={meal}
        api={api}
        onClose={() => setSearchOpen(false)}
        onPick={addFood}
      />
    </SafeAreaView>
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
  mealTabs: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    gap: 6,
    marginBottom: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#1a222c',
    alignItems: 'center',
  },
  tabOn: { backgroundColor: '#243040', borderWidth: 1, borderColor: '#3d9cf0' },
  tabText: { color: '#8b9aab', fontSize: 12, fontWeight: '600' },
  tabTextOn: { color: '#e8eef4' },
  body: { flex: 1, paddingHorizontal: 16 },
  actions: { gap: 8, marginBottom: 16 },
  primary: {
    backgroundColor: '#3d9cf0',
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
  section: { marginBottom: 16 },
  sectionTitle: {
    color: '#8b9aab',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  empty: { color: '#5a6a7a', fontSize: 13, paddingVertical: 8 },
});
