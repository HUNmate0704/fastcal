import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import type { DiaryEntry } from '../types';

type Props = {
  entry: DiaryEntry;
  onGrams: (id: string, grams: number) => void;
  onRemove: (id: string) => void;
};

export function EntryRow({ entry, onGrams, onRemove }: Props) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(entry.grams));

  function commit() {
    const g = Number(val.replace(',', '.'));
    if (g > 0 && g < 5000) onGrams(entry.id, g);
    else setVal(String(entry.grams));
    setEditing(false);
  }

  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>
          {entry.name}
        </Text>
        <Text style={styles.meta}>
          {entry.kcal} kcal · P {entry.protein} · Z {entry.fat} · Sz {entry.carbs}
        </Text>
      </View>
      {editing ? (
        <TextInput
          style={styles.input}
          value={val}
          onChangeText={setVal}
          keyboardType="decimal-pad"
          autoFocus
          onBlur={commit}
          onSubmitEditing={commit}
          selectTextOnFocus
        />
      ) : (
        <Pressable onPress={() => setEditing(true)} hitSlop={8}>
          <Text style={styles.grams}>{entry.grams} g</Text>
        </Pressable>
      )}
      <Pressable onPress={() => onRemove(entry.id)} hitSlop={10} style={styles.x}>
        <Text style={styles.xText}>×</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1e2833',
  },
  name: { color: '#e8eef4', fontSize: 16, fontWeight: '500' },
  meta: { color: '#8b9aab', fontSize: 12, marginTop: 2 },
  grams: {
    color: '#3d9cf0',
    fontSize: 16,
    fontWeight: '600',
    minWidth: 56,
    textAlign: 'right',
  },
  input: {
    width: 64,
    backgroundColor: '#1a222c',
    color: '#e8eef4',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    textAlign: 'right',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#3d9cf0',
  },
  x: { paddingHorizontal: 4 },
  xText: { color: '#5a6a7a', fontSize: 22, lineHeight: 24 },
});
