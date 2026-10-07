import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  Modal,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DataApi, Food, Meal, SearchHit } from '../types';
import { BarcodeScanModal } from './BarcodeScanModal';

type Props = {
  visible: boolean;
  meal: Meal;
  api: DataApi;
  startWithScan?: boolean;
  onClose: () => void;
  onPick: (food: Food, grams: number, opts?: { keepOpen?: boolean }) => void | Promise<void>;
};

export function SearchSheet({ visible, meal, api, startWithScan, onClose, onPick }: Props) {
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [ean, setEan] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const [cName, setCName] = useState('');
  const [cKcal, setCKcal] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const [loopScan, setLoopScan] = useState(false);
  const [pending, setPending] = useState<Food | null>(null);
  const [grams, setGrams] = useState('100');
  const [unitMode, setUnitMode] = useState<'serving' | 'grams'>('grams');
  const [cServing, setCServing] = useState('');
  const gramsRef = useRef<TextInput>(null);
  const searchRef = useRef<TextInput>(null);

  function resetAll() {
    setQ('');
    setHits([]);
    setEan('');
    setCustomOpen(false);
    setCName('');
    setCKcal('');
    setScanOpen(false);
    setLoopScan(false);
    setPending(null);
    setGrams('100');
    setUnitMode('grams');
    setCServing('');
  }

  useEffect(() => {
    if (!visible) {
      resetAll();
      return;
    }
    if (startWithScan) {
      setLoopScan(true);
      setScanOpen(true);
      return;
    }
    const t = setTimeout(() => searchRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, [visible, startWithScan]);

  useEffect(() => {
    if (pending) {
      const t = setTimeout(() => gramsRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [pending]);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      if (!q.trim()) {
        setHits([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const res = await api.search(q);
      if (!cancelled) {
        setHits(res);
        setLoading(false);
      }
    }, 50);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, api]);

  function openPending(food: Food) {
    setPending(food);
    if (food.servingGrams && food.servingGrams > 0) {
      setUnitMode('serving');
      setGrams('1');
    } else {
      setUnitMode('grams');
      setGrams('100');
    }
  }

  function exitAll() {
    resetAll();
    onClose();
  }

  function exitScanOnly() {
    setScanOpen(false);
    setPending(null);
    setCustomOpen(false);
    if (loopScan || startWithScan) {
      exitAll();
    } else {
      setLoopScan(false);
    }
  }

  async function lookupCode(code: string, fromScan: boolean) {
    const cleaned = code.trim();
    if (!cleaned) return;
    setEan(cleaned);
    setLoading(true);
    setScanOpen(false);
    if (fromScan) setLoopScan(true);
    const food = await api.lookupEan(cleaned);
    setLoading(false);
    if (food) {
      openPending(food);
    } else {
      setCustomOpen(true);
    }
  }

  async function doEan() {
    await lookupCode(ean, false);
  }

  async function confirmGrams() {
    if (!pending) return;
    const qty = Number(grams.replace(',', '.'));
    if (!(qty > 0)) return;
    const g =
      unitMode === 'serving' && pending.servingGrams
        ? qty * pending.servingGrams
        : qty;
    if (!(g > 0)) return;
    const keep = loopScan;
    await onPick(pending, g, { keepOpen: keep });
    setPending(null);
    setGrams('100');
    setUnitMode('grams');
    if (keep) {
      setScanOpen(true);
    } else {
      exitAll();
    }
  }

  function skipPending() {
    setPending(null);
    setGrams('100');
    if (loopScan) setScanOpen(true);
  }

  async function saveCustom() {
    const kcal = Number(cKcal.replace(',', '.'));
    if (!cName.trim() || !(kcal > 0)) return;
    const sg = Number(cServing.replace(',', '.'));
    const food = await api.saveCustom({
      name: cName.trim(),
      kcal100: kcal,
      protein100: 0,
      fat100: 0,
      carbs100: 0,
      ean: ean.trim() || undefined,
      servingGrams: sg > 0 ? sg : undefined,
      servingLabel: sg > 0 ? '1 adag' : undefined,
    });
    setCustomOpen(false);
    setCName('');
    setCKcal('');
    setCServing('');
    openPending(food);
  }

  function cancelCustom() {
    setCustomOpen(false);
    setCName('');
    setCKcal('');
    if (loopScan) setScanOpen(true);
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={exitAll}>
      <View style={[styles.wrap, { paddingTop: insets.top }]}>
        <View style={styles.head}>
          <Text style={styles.title}>
            {pending
              ? unitMode === 'serving'
                ? 'Adag'
                : 'Gramm'
              : customOpen
                ? 'Ismeretlen'
                : `Keresés · ${meal}`}
          </Text>
          <Pressable onPress={exitAll} hitSlop={12}>
            <Text style={styles.close}>Bezár</Text>
          </Pressable>
        </View>

        {pending ? (
          <KeyboardAvoidingView
            style={styles.confirm}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={24}
          >
            <Text style={styles.confirmName}>{pending.name}</Text>
            <Text style={styles.confirmMeta}>
              {pending.kcal100} kcal/100g
              {pending.servingGrams
                ? ` · ${pending.servingLabel || '1 adag'} = ${pending.servingGrams}g`
                : ''}
              {pending.brand ? ` · ${pending.brand}` : ''}
            </Text>
            {pending.servingGrams ? (
              <View style={styles.modeRow}>
                <Pressable
                  style={[styles.modeBtn, unitMode === 'serving' && styles.modeOn]}
                  onPress={() => {
                    setUnitMode('serving');
                    setGrams('1');
                  }}
                >
                  <Text style={[styles.modeText, unitMode === 'serving' && styles.modeTextOn]}>
                    Adag
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.modeBtn, unitMode === 'grams' && styles.modeOn]}
                  onPress={() => {
                    setUnitMode('grams');
                    setGrams(String(pending.servingGrams));
                  }}
                >
                  <Text style={[styles.modeText, unitMode === 'grams' && styles.modeTextOn]}>
                    Gramm
                  </Text>
                </Pressable>
              </View>
            ) : null}
            <TextInput
              ref={gramsRef}
              style={styles.input}
              value={grams}
              onChangeText={setGrams}
              keyboardType="decimal-pad"
              selectTextOnFocus
              returnKeyType="done"
              onSubmitEditing={confirmGrams}
              autoFocus
            />
            <Text style={styles.unitHint}>
              {unitMode === 'serving'
                ? pending.servingLabel || 'adag'
                : 'gramm'}
            </Text>
            {(() => {
              const qty = Number(String(grams).replace(',', '.'));
              const g =
                unitMode === 'serving' && pending.servingGrams
                  ? qty * pending.servingGrams
                  : qty;
              const ok = Number.isFinite(g) && g > 0;
              const k = ok ? g / 100 : 0;
              const kcal = Math.round(pending.kcal100 * k);
              const p = Math.round(pending.protein100 * k * 10) / 10;
              const z = Math.round(pending.fat100 * k * 10) / 10;
              const sz = Math.round(pending.carbs100 * k * 10) / 10;
              return (
                <View style={styles.liveBox}>
                  <Text style={styles.liveKcal}>{ok ? kcal : '—'} kcal</Text>
                  <Text style={styles.liveMacros}>
                    Fehérje {ok ? p : '—'}g · Zsír {ok ? z : '—'}g · Szénhidrát {ok ? sz : '—'}g
                  </Text>
                  {unitMode === 'serving' && ok ? (
                    <Text style={styles.liveSub}>{Math.round(g)} g</Text>
                  ) : null}
                </View>
              );
            })()}
            <Pressable style={styles.primary} onPress={confirmGrams}>
              <Text style={styles.primaryText}>Mentés{loopScan ? ' → újra scan' : ''}</Text>
            </Pressable>
            <Pressable style={styles.ghost} onPress={skipPending}>
              <Text style={styles.ghostText}>
                {loopScan ? 'Kihagy → kamera' : 'Mégsem'}
              </Text>
            </Pressable>
          </KeyboardAvoidingView>
        ) : customOpen ? (
          <View style={styles.custom}>
            <Text style={styles.customTitle}>Ismeretlen EAN — kézi kcal/100g</Text>
            <TextInput
              style={styles.input}
              placeholder="Név"
              placeholderTextColor="#5a6a7a"
              value={cName}
              onChangeText={setCName}
            />
            <TextInput
              style={styles.input}
              placeholder="kcal / 100g"
              placeholderTextColor="#5a6a7a"
              value={cKcal}
              onChangeText={setCKcal}
              keyboardType="decimal-pad"
            />
            <TextInput
              style={styles.input}
              placeholder="1 adag = ? g (opcionális)"
              placeholderTextColor="#5a6a7a"
              value={cServing}
              onChangeText={setCServing}
              keyboardType="decimal-pad"
            />
            <Pressable style={styles.primary} onPress={saveCustom}>
              <Text style={styles.primaryText}>Tovább → gramm</Text>
            </Pressable>
            <Pressable style={styles.ghost} onPress={cancelCustom}>
              <Text style={styles.ghostText}>{loopScan ? 'Mégsem → kamera' : 'Mégsem'}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <TextInput
              ref={searchRef}
              style={styles.input}
              placeholder="Étel neve…"
              placeholderTextColor="#5a6a7a"
              value={q}
              onChangeText={setQ}
              autoFocus={!startWithScan}
              returnKeyType="search"
            />
            <View style={styles.eanRow}>
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                placeholder="EAN / vonalkód"
                placeholderTextColor="#5a6a7a"
                value={ean}
                onChangeText={setEan}
                keyboardType="number-pad"
              />
              <Pressable style={styles.eanBtn} onPress={doEan}>
                <Text style={styles.eanBtnText}>OFF</Text>
              </Pressable>
              <Pressable
                style={styles.scanBtn}
                onPress={() => {
                  setLoopScan(true);
                  setScanOpen(true);
                }}
              >
                <Text style={styles.eanBtnText}>Scan</Text>
              </Pressable>
            </View>
            {loading && <ActivityIndicator color="#3d9cf0" style={{ marginVertical: 8 }} />}
            <FlatList
              data={hits}
              keyExtractor={(i) => i.id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable
                  style={styles.hit}
                  onPress={() => {
                    setLoopScan(false);
                    openPending(item);
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.hitName}>{item.name}</Text>
                    <Text style={styles.hitMeta}>
                      {item.kcal100} kcal/100g · {item.source}
                      {item.brand ? ` · ${item.brand}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.plus}>+</Text>
                </Pressable>
              )}
              ListEmptyComponent={
                q.trim() && !loading ? (
                  <Text style={styles.empty}>Nincs találat — próbálj EAN-t / Scan-t.</Text>
                ) : null
              }
            />
          </>
        )}
      </View>

      <BarcodeScanModal
        visible={scanOpen}
        onClose={exitScanOnly}
        onCode={(code) => lookupCode(code, true)}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0f1419', paddingHorizontal: 16 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { color: '#e8eef4', fontSize: 20, fontWeight: '700' },
  close: { color: '#3d9cf0', fontSize: 16, fontWeight: '600' },
  input: {
    backgroundColor: '#1a222c',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#e8eef4',
    fontSize: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#2a3542',
  },
  eanRow: { flexDirection: 'row', gap: 8, marginBottom: 10, alignItems: 'center' },
  eanBtn: {
    backgroundColor: '#243040',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  scanBtn: {
    backgroundColor: '#3d9cf0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  eanBtnText: { color: '#e8eef4', fontWeight: '700' },
  hit: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1e2833',
  },
  hitName: { color: '#e8eef4', fontSize: 16 },
  hitMeta: { color: '#8b9aab', fontSize: 12, marginTop: 2 },
  plus: { color: '#3ecf8e', fontSize: 24, fontWeight: '600', paddingLeft: 8 },
  empty: { color: '#8b9aab', textAlign: 'center', marginTop: 24 },
  custom: { backgroundColor: '#1a222c', borderRadius: 12, padding: 12, marginBottom: 12 },
  customTitle: { color: '#f0b429', marginBottom: 8, fontWeight: '600' },
  confirm: { paddingTop: 8 },
  confirmName: { color: '#e8eef4', fontSize: 22, fontWeight: '700', marginBottom: 4 },
  confirmMeta: { color: '#8b9aab', marginBottom: 16 },
  unitHint: { color: '#8b9aab', marginTop: -6, marginBottom: 12 },
  liveBox: {
    backgroundColor: '#16202a',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#2a3542',
    alignItems: 'center',
  },
  liveKcal: { color: '#3ecf8e', fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  liveMacros: { color: '#8b9aab', fontSize: 14, marginTop: 4, fontWeight: '600' },
  liveSub: { color: '#5a6a7a', fontSize: 12, marginTop: 4 },
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  modeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#1a222c',
    borderWidth: 1,
    borderColor: '#2a3542',
  },
  modeOn: { backgroundColor: '#243040', borderColor: '#3d9cf0' },
  modeText: { color: '#8b9aab', fontWeight: '700' },
  modeTextOn: { color: '#e8eef4' },
  primary: {
    backgroundColor: '#3d9cf0',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryText: { color: '#061018', fontWeight: '700', fontSize: 16 },
  ghost: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a3542',
  },
  ghostText: { color: '#8b9aab', fontWeight: '600' },
});
