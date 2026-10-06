import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  visible: boolean;
  kcalGoal: number;
  onClose: () => void;
  onSave: (kcal: number) => void | Promise<void>;
};

export function SettingsSheet({ visible, kcalGoal, onClose, onSave }: Props) {
  const insets = useSafeAreaInsets();
  const [val, setVal] = useState(String(kcalGoal));

  useEffect(() => {
    if (visible) setVal(String(kcalGoal));
  }, [visible, kcalGoal]);

  async function save() {
    const n = Math.round(Number(String(val).replace(',', '.')));
    if (!(n >= 800 && n <= 8000)) return;
    await onSave(n);
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[styles.wrap, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.head}>
          <Text style={styles.title}>Beállítások</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>Bezár</Text>
          </Pressable>
        </View>
        <Text style={styles.label}>Napi kalória cél</Text>
        <TextInput
          style={styles.input}
          value={val}
          onChangeText={setVal}
          keyboardType="number-pad"
          selectTextOnFocus
          autoFocus
        />
        <Text style={styles.hint}>800–8000 kcal</Text>
        <Pressable style={styles.primary} onPress={save}>
          <Text style={styles.primaryText}>Mentés</Text>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0f1419', paddingHorizontal: 16 },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: { color: '#e8eef4', fontSize: 20, fontWeight: '700' },
  close: { color: '#3d9cf0', fontSize: 16, fontWeight: '600' },
  label: { color: '#8b9aab', fontWeight: '600', marginBottom: 8 },
  input: {
    backgroundColor: '#1a222c',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: '#e8eef4',
    fontSize: 22,
    fontWeight: '700',
    borderWidth: 1,
    borderColor: '#2a3542',
    marginBottom: 8,
  },
  hint: { color: '#5a6a7a', marginBottom: 20 },
  primary: {
    backgroundColor: '#3d9cf0',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryText: { color: '#061018', fontWeight: '700', fontSize: 16 },
});
