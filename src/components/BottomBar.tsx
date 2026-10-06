import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { DayTotals } from '../types';

const GOAL = 2200;

export function BottomBar({
  totals,
  bottomInset = 0,
  placement = 'bottom',
}: {
  totals: DayTotals;
  bottomInset?: number;
  placement?: 'top' | 'bottom';
}) {
  const pct = Math.min(100, Math.round((totals.kcal / GOAL) * 100));
  const pad =
    placement === 'top'
      ? { paddingTop: 6, paddingBottom: 10 }
      : { paddingBottom: 10 + bottomInset };
  return (
    <View
      style={[
        styles.wrap,
        placement === 'top' ? styles.wrapTop : null,
        pad,
      ]}
    >
      <View style={styles.row}>
        <Text style={styles.kcal}>{totals.kcal}</Text>
        <Text style={styles.kcalUnit}> / {GOAL} kcal</Text>
      </View>
      <View style={styles.barBg}>
        <View style={[styles.barFill, { width: `${pct}%` as unknown as number }]} />
      </View>
      <View style={styles.macros}>
        <Macro label="Fehérje" value={totals.protein} unit="g" />
        <Macro label="Zsír" value={totals.fat} unit="g" />
        <Macro label="Szénhidrát" value={totals.carbs} unit="g" />
      </View>
    </View>
  );
}

function Macro({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <Text style={styles.macro}>
      <Text style={styles.macroLabel}>{label} </Text>
      {Math.round(value)}
      {unit}
    </Text>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2a3542',
    backgroundColor: '#121820',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 0,
  },
  wrapTop: {
    borderTopWidth: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a3542',
  },
  row: { flexDirection: 'row', alignItems: 'baseline' },
  kcal: { color: '#e8eef4', fontSize: 24, fontWeight: '700', letterSpacing: -0.5 },
  kcalUnit: { color: '#8b9aab', fontSize: 14, marginLeft: 4 },
  barBg: {
    height: 4,
    backgroundColor: '#243040',
    borderRadius: 2,
    marginTop: 8,
    overflow: 'hidden',
  },
  barFill: { height: 4, backgroundColor: '#3ecf8e', borderRadius: 2 },
  macros: { flexDirection: 'row', gap: 16, marginTop: 10 },
  macro: { color: '#e8eef4', fontSize: 14 },
  macroLabel: { color: '#8b9aab', fontWeight: '600' },
});
