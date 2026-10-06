import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import type { DiaryEntry, Food, Meal } from '../types';

type Props = {
  meal: Meal;
  yesterday: DiaryEntry[];
  frequent: Array<Food & { defaultGrams: number }>;
  recent: Food[];
  onYesterday: () => void;
  onFood: (food: Food, grams: number) => void;
};

const MEAL_LABEL: Record<Meal, string> = {
  reggeli: 'Reggeli',
  ebed: 'Ebéd',
  vacsora: 'Vacsora',
  snack: 'Snack',
};

export function QuickAdd({
  meal,
  yesterday,
  frequent,
  recent,
  onYesterday,
  onFood,
}: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Gyors · {MEAL_LABEL[meal]}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {yesterday.length > 0 && (
          <Chip
            label={`Tegnap ugyanez (${yesterday.length})`}
            accent
            onPress={onYesterday}
          />
        )}
        {frequent.map((f) => (
          <Chip
            key={'fq-' + f.id}
            label={`${f.name} ${f.defaultGrams}g`}
            onPress={() => onFood(f, f.defaultGrams)}
          />
        ))}
        {recent.map((f) => (
          <Chip
            key={'rc-' + f.id}
            label={f.name}
            onPress={() => onFood(f, 100)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function Chip({
  label,
  onPress,
  accent,
}: {
  label: string;
  onPress: () => void;
  accent?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, accent && styles.chipAccent]}
    >
      <Text style={[styles.chipText, accent && styles.chipTextAccent]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 8 },
  title: { color: '#8b9aab', fontSize: 12, fontWeight: '600', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 },
  chips: { gap: 8, paddingLeft: 0, paddingRight: 20 },
  chip: {
    backgroundColor: '#1a222c',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#2a3542',
    maxWidth: 220,
  },
  chipAccent: { backgroundColor: '#1a3a2a', borderColor: '#3ecf8e' },
  chipText: { color: '#e8eef4', fontSize: 14 },
  chipTextAccent: { color: '#3ecf8e', fontWeight: '600' },
});
