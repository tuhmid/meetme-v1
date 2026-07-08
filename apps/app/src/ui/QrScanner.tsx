// Full-screen QR scanner for the handoff. expo-camera is a native module (needs a
// dev build — not Expo Go), so it's imported ONLY here: the seller's manual 6-digit
// entry is always the fallback if the camera is unavailable.
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
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

        {/* centered column overlay: title on top, action on the bottom, spaced evenly */}
        <View style={{ flex: 1, justifyContent: 'space-between', alignItems: 'center', paddingTop: 76, paddingBottom: 52, paddingHorizontal: 24 }}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 18, textAlign: 'center' }}>
            Scan the buyer's release QR
          </Text>

          {!granted && permission && (
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: '#fff', textAlign: 'center', marginBottom: 16, fontSize: 15 }}>
                Camera access is needed to scan the QR — or just enter the 6-digit code instead.
              </Text>
              <Button label="Allow camera" onPress={requestPermission} />
            </View>
          )}

          <Pressable
            onPress={onClose}
            style={{ backgroundColor: 'rgba(255,255,255,0.16)', paddingHorizontal: 26, paddingVertical: 12, borderRadius: 24 }}
          >
            <Text style={{ color: '#fff', fontWeight: '600', textAlign: 'center' }}>Enter the code manually instead</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export default QrScanner;
