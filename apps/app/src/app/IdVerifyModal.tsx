// ID verification — TEST MODE. A real capture flow (photograph your ID document) with a
// mocked review. The photo is captured, previewed, and DISCARDED on submit — a real KYC
// provider (Persona / Stripe Identity) would hold it, not us. Only the verified status
// persists (via /kyc/verify). No image is uploaded or stored anywhere.
import { useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, SafeAreaView, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { Button } from '../ui';

type Step = 'intro' | 'capture' | 'preview' | 'reviewing' | 'done';

export interface IdVerifyModalProps {
  visible: boolean;
  onClose: () => void;
  onVerify: () => Promise<void>; // parent calls api.verifyKyc; the modal owns the reviewing→done UI
}

export function IdVerifyModal({ visible, onClose, onVerify }: IdVerifyModalProps) {
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [step, setStep] = useState<Step>('intro');
  const [photo, setPhoto] = useState<string | null>(null);
  const camRef = useRef<CameraView>(null);

  const close = () => { setStep('intro'); setPhoto(null); onClose(); };

  const startCamera = async () => {
    if (!permission?.granted) {
      const r = await requestPermission();
      if (!r.granted) return; // stay on intro; they can use the library instead
    }
    setStep('capture');
  };
  const capture = async () => {
    try {
      const pic = await camRef.current?.takePictureAsync({ quality: 0.6 });
      if (pic?.uri) { setPhoto(pic.uri); setStep('preview'); }
    } catch { /* let them retry */ }
  };
  const pickFromLibrary = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
    if (!res.canceled && res.assets[0]?.uri) { setPhoto(res.assets[0].uri); setStep('preview'); }
  };
  const submit = async () => {
    setStep('reviewing');
    try {
      await Promise.all([onVerify(), new Promise((r) => setTimeout(r, 1600))]); // min "reviewing" beat
      setStep('done');
    } catch {
      setStep('preview'); // parent surfaces the error; allow a retry
    }
  };

  const primary = theme.colors.primary;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      {step === 'capture' ? (
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <CameraView ref={camRef} style={{ flex: 1 }} facing="back" />
          {/* framing guide + shutter overlay */}
          <SafeAreaView style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16, textAlign: 'center', marginTop: 20 }}>Fit your ID inside the frame</Text>
          </SafeAreaView>
          <View style={{ position: 'absolute', top: '28%', left: '8%', right: '8%', height: '32%', borderWidth: 2, borderColor: 'rgba(255,255,255,0.85)', borderRadius: 14 }} />
          <SafeAreaView style={{ position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', paddingBottom: 24 }}>
            <Pressable onPress={capture} style={{ width: 74, height: 74, borderRadius: 37, backgroundColor: '#fff', borderWidth: 5, borderColor: 'rgba(255,255,255,0.4)' }} />
            <Pressable onPress={() => setStep('intro')} style={{ marginTop: 16 }}><Text style={{ color: '#fff', fontWeight: '600' }}>Cancel</Text></Pressable>
          </SafeAreaView>
        </View>
      ) : (
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', padding: 16 }}>
            {step !== 'reviewing' && <Pressable onPress={close} hitSlop={10}><Ionicons name="close" size={26} color={theme.colors.textMuted} /></Pressable>}
          </View>
          <View style={{ flex: 1, paddingHorizontal: 28, justifyContent: 'center' }}>
            {step === 'intro' && (
              <View style={{ alignItems: 'center' }}>
                <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: theme.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center', marginBottom: 22 }}>
                  <Ionicons name="id-card-outline" size={42} color={primary} />
                </View>
                <Text style={{ fontSize: 22, fontWeight: '800', color: theme.colors.text, textAlign: 'center', marginBottom: 10 }}>Verify your identity</Text>
                <Text style={{ color: theme.colors.textDim, fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 28 }}>
                  Unlocks deals over $500. Take a clear photo of your government ID. We don't store the photo — it's used only to verify you.
                </Text>
                <View style={{ alignSelf: 'stretch' }}>
                  <Button label="Take a photo of your ID" iconName="camera" onPress={startCamera} />
                  <Pressable onPress={pickFromLibrary} style={{ paddingVertical: 14, alignItems: 'center', marginTop: 4 }}>
                    <Text style={{ color: primary, fontWeight: '600' }}>Choose from library</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {step === 'preview' && photo && (
              <View style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 20, fontWeight: '800', color: theme.colors.text, marginBottom: 16 }}>Looks good?</Text>
                <Image source={{ uri: photo }} style={{ width: '100%', height: 220, borderRadius: 14, marginBottom: 22 }} resizeMode="cover" />
                <View style={{ alignSelf: 'stretch' }}>
                  <Button label="Submit for verification" iconName="shield-checkmark" onPress={submit} />
                  <Pressable onPress={() => { setPhoto(null); setStep('intro'); }} style={{ paddingVertical: 14, alignItems: 'center', marginTop: 4 }}>
                    <Text style={{ color: primary, fontWeight: '600' }}>Retake</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {step === 'reviewing' && (
              <View style={{ alignItems: 'center' }}>
                <ActivityIndicator size="large" color={primary} />
                <Text style={{ fontSize: 18, fontWeight: '700', color: theme.colors.text, marginTop: 20 }}>Verifying your ID…</Text>
                <Text style={{ color: theme.colors.textDim, fontSize: 14, marginTop: 6 }}>This usually takes a moment.</Text>
              </View>
            )}

            {step === 'done' && (
              <View style={{ alignItems: 'center' }}>
                <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: theme.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center', marginBottom: 22 }}>
                  <Ionicons name="shield-checkmark" size={44} color={theme.colors.success} />
                </View>
                <Text style={{ fontSize: 22, fontWeight: '800', color: theme.colors.text, marginBottom: 8 }}>You're verified</Text>
                <Text style={{ color: theme.colors.textDim, fontSize: 15, textAlign: 'center', marginBottom: 28 }}>You can now set up deals over $500.</Text>
                <View style={{ alignSelf: 'stretch' }}><Button label="Done" onPress={close} /></View>
              </View>
            )}
          </View>
        </SafeAreaView>
      )}
    </Modal>
  );
}

export default IdVerifyModal;
