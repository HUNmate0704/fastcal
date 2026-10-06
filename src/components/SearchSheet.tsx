import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  Modal,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import type { DataApi, Food, Meal, SearchHit } from '../types';
import { BarcodeScanModal } from './BarcodeScanModal';

type Props = {
  visible: boolean;
  meal: Meal;
  api: DataApi;
  onClose: () => void;
  onPick: (food: Food, grams: number) => void;
};

export function SearchSheet({ visible, meal, api, onClose, onPick }: Props) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [ean, setEan] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const [cName, setCName] = useState('');
  const [cKcal, setCKcal] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const [scanAgain, setScanAgain] = useState(false);

  useEffect(() => {
    if (!visible) {
      setQ('');
      setHits([]);
      setEan('');
      setCustomOpen(false);
      setScanOpen(false);
      setScanAgain(false);
    }
  }, [visible]);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      if (!q.trim()) {
        setHits([]);
        return;
      }
      setLoading(true);
      const res = await api.search(q);
      if (!cancelled) {
        setHits(res);
        setLoading(false);
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, api]);

  async function lookupCode(code: string, fromScan: boolean) {
    const cleaned = code.trim();
    if (!cleaned) return;
    setEan(cleaned);
    setLoading(true);
    setScanOpen(false);
    const food = await api.lookupEan(cleaned);
    setLoading(false);
    if (food) {
      onPick(food, 100);
      if (fromScan) setScanAgain(true);
    } else {
      setCustomOpen(true);
      setScanAgain(fromScan);
    }
  }

  async function doEan() {
    await lookupCode(ean, false);
  }

  async function saveCustom() {
    const kcal = Number(cKcal.replace(',', '.'));
    if (!cName.trim() || !(kcal > 0)) return;
    const food = await api.saveCustom({
      name: cName.trim(),
      kcal100: kcal,
      protein100: 0,
      fat100: 0,
      carbs100: 0,
      ean: ean.trim() || undefined,
    });
    onPick(food, 100);
    if (scanAgain) {
      setCustomOpen(false);
      setCName('');
      setCKcal('');
      setScanOpen(true);
      setScanAgain(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <View style={styles.head}>
          <Text style={styles.title}>Keresés · {meal}</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>Kész</Text>
          </Pressable>
        </View>
        <TextInput
          style={styles.input}
          placeholder="Étel neve…"
          placeholderTextColor="#5a6a7a"
          value={q}
          onChangeText={setQ}
          autoFocus
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
          <Pressable style={styles.scanBtn} onPress={() => setScanOpen(true)}>
            <Text style={styles.eanBtnText}>Scan</Text>
          </Pressable>
        </View>
        {scanAgain && !scanOpen && (
          <Pressable style={styles.again} onPress={() => setScanOpen(true)}>
            <Text style={styles.againText}>↗ Újra scannelés</Text>
          </Pressable>
        )}
        {loading && <ActivityIndicator color="#3d9cf0" style={{ marginVertical: 8 }} />}
        {customOpen && (
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
            <Pressable style={styles.primary} onPress={saveCustom}>
              <Text style={styles.primaryText}>Mentés + hozzáadás</Text>
            </Pressable>
          </View>
        )}
        <FlatList
          data={hits}
          keyExtractor={(i) => i.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Pressable style={styles.hit} onPress={() => onPick(item, 100)}>
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
      </View>

      <BarcodeScanModal
        visible={scanOpen}
        onClose={() => setScanOpen(false)}
        onCode={(code) => lookupCode(code, true)}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0f1419', paddingTop: 48, paddingHorizontal: 16 },
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
  again: { marginBottom: 10, alignSelf: 'flex-start' },
  againText: { color: '#3ecf8e', fontWeight: '600' },
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
  primary: {
    backgroundColor: '#3d9cf0',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryText: { color: '#061018', fontWeight: '700', fontSize: 16 },
});
