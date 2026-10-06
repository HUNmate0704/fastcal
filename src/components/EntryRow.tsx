import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  type TextInput as TextInputType,
} from 'react-native';
import type { DiaryEntry } from '../types';

type Props = {
  entry: DiaryEntry;
  onGrams: (id: string, grams: number) => void;
  onRemove: (id: string) => void;
  /** After quick-add / search — open keyboard on this row */
  autoFocusGrams?: boolean;
  onAutoFocusDone?: () => void;
};

export function EntryRow({
  entry,
  onGrams,
  onRemove,
  autoFocusGrams,
  onAutoFocusDone,
}: Props) {
  const inputRef = useRef<TextInputType>(null);
  const [val, setVal] = useState(String(entry.grams));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setVal(String(entry.grams));
  }, [entry.grams, focused]);

  useEffect(() => {
    if (!autoFocusGrams) return;
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.setNativeProps?.({ selection: { start: 0, end: String(entry.grams).length } });
      onAutoFocusDone?.();
    }, 80);
    return () => clearTimeout(t);
  }, [autoFocusGrams, entry.grams, onAutoFocusDone]);

  function focusGrams() {
    inputRef.current?.focus();
  }

  const liveG = Number(String(val).replace(',', '.'));
  const liveOk = focused && Number.isFinite(liveG) && liveG > 0 && entry.grams > 0;
  const kg = liveOk ? liveG / entry.grams : 1;
  const showKcal = liveOk ? Math.round(entry.kcal * kg) : entry.kcal;
  const showP = liveOk ? Math.round(entry.protein * kg * 10) / 10 : entry.protein;
  const showZ = liveOk ? Math.round(entry.fat * kg * 10) / 10 : entry.fat;
  const showSz = liveOk ? Math.round(entry.carbs * kg * 10) / 10 : entry.carbs;

  function commit() {
    setFocused(false);
    const g = Number(val.replace(',', '.'));
    if (g > 0 && g < 5000) {
      if (g !== entry.grams) onGrams(entry.id, g);
    } else {
      setVal(String(entry.grams));
    }
  }

  return (
    <Pressable style={styles.row} onPress={focusGrams}>
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>
          {entry.name}
        </Text>
        <Text style={[styles.meta, liveOk && styles.metaLive]}>
          {showKcal} kcal · Feh. {showP} · Zsír {showZ} · Szénh. {showSz}
        </Text>
      </View>
      <TextInput
        ref={inputRef}
        style={[styles.input, focused && styles.inputOn]}
        value={val}
        onChangeText={setVal}
        keyboardType="decimal-pad"
        returnKeyType="done"
        onFocus={() => {
          setFocused(true);
          setVal(String(entry.grams));
        }}
        onBlur={commit}
        onSubmitEditing={commit}
        selectTextOnFocus
        // keep keyboard when parent re-renders macros
        blurOnSubmit
      />
      <Text style={styles.unit}>g</Text>
      <Pressable
        onPress={(e) => {
          e.stopPropagation?.();
          onRemove(entry.id);
        }}
        hitSlop={10}
        style={styles.x}
      >
        <Text style={styles.xText}>×</Text>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1e2833',
  },
  name: { color: '#e8eef4', fontSize: 16, fontWeight: '500' },
  meta: { color: '#8b9aab', fontSize: 12, marginTop: 2 },
  metaLive: { color: '#3ecf8e' },
  input: {
    width: 76,
    minHeight: 44,
    backgroundColor: '#1a222c',
    color: '#3d9cf0',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    textAlign: 'right',
    fontSize: 17,
    fontWeight: '600',
    borderWidth: 1,
    borderColor: '#2a3542',
  },
  inputOn: { borderColor: '#3d9cf0', backgroundColor: '#121820' },
  unit: { color: '#8b9aab', fontSize: 14, fontWeight: '600', width: 14 },
  x: { paddingHorizontal: 8, paddingVertical: 8, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  xText: { color: '#5a6a7a', fontSize: 26, lineHeight: 28 },
});
