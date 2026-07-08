// Full-screen QR scanner for the handoff. expo-camera is a native module (needs a
// dev build — not Expo Go), so it's imported ONLY here: the seller's manual 6-digit
// entry is always the fallback if the camera is unavailable.
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
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

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} onShow={() => setHandled(false)}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {!permission ? null : !permission.granted ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <Text style={{ color: '#fff', textAlign: 'center', marginBottom: 16, fontSize: 16 }}>
              Camera access is needed to scan the buyer's release QR.
            </Text>
            <Button label="Allow camera" onPress={requestPermission} />
          </View>
        ) : (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handled ? undefined : onBarcode}
          />
        )}
        <View style={{ position: 'absolute', top: 64, left: 0, right: 0, alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 17 }}>Scan the buyer's release QR</Text>
        </View>
        <Pressable
          onPress={onClose}
          style={{ position: 'absolute', bottom: 48, alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.16)', paddingHorizontal: 26, paddingVertical: 12, borderRadius: 24 }}
        >
          <Text style={{ color: '#fff', fontWeight: '600' }}>Enter the code manually instead</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

export default QrScanner;
