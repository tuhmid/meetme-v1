// Full-screen QR scanner for the handoff. expo-camera is a native module (needs a
// dev build — not Expo Go), so it's imported ONLY here: the seller's manual 6-digit
// entry is always the fallback if the camera is unavailable.
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { Button } from './Button';

export interface QrScannerProps {
  visible: boolean;
  onClose: () => void;
  onScan: (code: string) => void; // receives the parsed release code
}

// The buyer's QR encodes `MEETME:<code>` so a stray QR can't be mistaken for a release.
const parse = (raw: string): string | null => {
  const m = /^MEETME:(\d{4,8})$/.exec(raw.trim());
  return m ? m[1] : null;
};

export function QrScanner({ visible, onClose, onScan }: QrScannerProps) {
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [handled, setHandled] = useState(false);

  const onBarcode = ({ data }: { data: string }) => {
    if (handled) return;
    const code = parse(data);
    if (!code) return; // not a MeetMe release QR — keep scanning
    setHandled(true);
    onScan(code);
  };

  const granted = permission?.granted;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} onShow={() => setHandled(false)}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {granted && (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handled ? undefined : onBarcode}
          />
        )}

        {granted ? (
          /* scanning: the live camera IS the content — keep chrome minimal, title up, escape down */
          <View style={{ flex: 1, justifyContent: 'space-between', alignItems: 'center', paddingTop: 76, paddingBottom: 52, paddingHorizontal: 24 }}>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 18, textAlign: 'center' }}>
              Scan the buyer's release QR
            </Text>
            <Pressable
              onPress={onClose}
              style={{ backgroundColor: 'rgba(255,255,255,0.16)', paddingHorizontal: 26, paddingVertical: 12, borderRadius: 24 }}
            >
              <Text style={{ color: '#fff', fontWeight: '600', textAlign: 'center' }}>Enter the code manually instead</Text>
            </Pressable>
          </View>
        ) : (
          /* no camera yet: one cohesive, vertically-centered prompt — no stranded voids */
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 30 }}>
            <View style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', marginBottom: 22 }}>
              <Ionicons name="qr-code-outline" size={36} color="#fff" />
            </View>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 20, textAlign: 'center', marginBottom: 10 }}>
              Scan the buyer's release QR
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.7)', textAlign: 'center', fontSize: 15, lineHeight: 21, marginBottom: 26 }}>
              Allow camera access to scan it — or just enter the 6-digit code by hand.
            </Text>
            <View style={{ alignSelf: 'stretch' }}>
              <Button label="Allow camera" onPress={requestPermission} />
              <Pressable onPress={onClose} style={{ paddingVertical: 14, alignItems: 'center', marginTop: 4 }}>
                <Text style={{ color: 'rgba(255,255,255,0.8)', fontWeight: '600' }}>Enter the code manually instead</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

export default QrScanner;
