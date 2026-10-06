import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';

type Props = {
  visible: boolean;
  onClose: () => void;
  onCode: (ean: string) => void;
};

export function BarcodeScanModal({ visible, onClose, onCode }: Props) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  useEffect(() => {
    if (!visible) {
      lock.current = false;
      setBusy(false);
      return;
    }
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [visible, permission, requestPermission]);

  function handleBarCode(result: BarcodeScanningResult) {
    if (!visible || lock.current || busy) return;
    const raw = (result.data || '').trim();
    const code = raw.replace(/\D/g, '');
    if (code.length < 8) return;
    lock.current = true;
    setBusy(true);
    onCode(code);
  }

  const web = Platform.OS === 'web';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.wrap, { paddingTop: insets.top }]}>
        <View style={styles.head}>
          <Text style={styles.title}>Vonalkód</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>Bezár</Text>
          </Pressable>
        </View>

        {web ? (
          <View style={styles.fallback}>
            <Text style={styles.fallbackText}>
              Weben nincs kamera-scan — írd be az EAN-t a keresőben, vagy nyisd Expo Go-ban telefonon.
            </Text>
          </View>
        ) : !permission ? (
          <ActivityIndicator color="#3d9cf0" style={{ marginTop: 40 }} />
        ) : !permission.granted ? (
          <View style={styles.fallback}>
            <Text style={styles.fallbackText}>Kamera engedély kell a scanneléshez.</Text>
            <Pressable style={styles.btn} onPress={requestPermission}>
              <Text style={styles.btnText}>Engedély kérése</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.camBox}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{
                barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128'],
              }}
              onBarcodeScanned={busy ? undefined : handleBarCode}
            />
            <View style={styles.frame} pointerEvents="none" />
            {busy && (
              <View style={styles.busy}>
                <ActivityIndicator color="#fff" />
                <Text style={styles.busyText}>Keresés OFF-ban…</Text>
              </View>
            )}
          </View>
        )}
        <Text style={styles.hint}>Tartsd a vonalkódot a keretbe — automatikusan beolvassa.</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0f1419' },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  title: { color: '#e8eef4', fontSize: 20, fontWeight: '700' },
  close: { color: '#3d9cf0', fontSize: 16, fontWeight: '600' },
  camBox: {
    flex: 1,
    marginHorizontal: 16,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000',
    minHeight: 320,
  },
  frame: {
    position: 'absolute',
    left: '10%',
    right: '10%',
    top: '30%',
    bottom: '30%',
    borderWidth: 2,
    borderColor: '#3d9cf0',
    borderRadius: 12,
  },
  busy: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  busyText: { color: '#fff', fontWeight: '600' },
  hint: { color: '#8b9aab', textAlign: 'center', padding: 16, fontSize: 13 },
  fallback: { flex: 1, padding: 24, justifyContent: 'center' },
  fallbackText: { color: '#e8eef4', fontSize: 16, marginBottom: 16, textAlign: 'center' },
  btn: {
    backgroundColor: '#3d9cf0',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnText: { color: '#061018', fontWeight: '700' },
});
