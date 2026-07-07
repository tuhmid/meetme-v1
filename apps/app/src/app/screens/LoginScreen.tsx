// Phone-OTP sign-in plus the one-device demo entry point.
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemeToggle, useTheme } from '../../theme';
import { Button } from '../../ui';
import { useApp } from '../AppContext';
import { formatPhone, inputStyle } from '../dealLogic';

export default function LoginScreen() {
  const theme = useTheme();
  const { name, setName, phone, setPhone, otp, setOtp, otpSent, setOtpSent, sendCode, verifyCode, startDemo, busy, err } = useApp();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <Text style={{ fontSize: 30, fontWeight: '800', color: theme.colors.primary }}>MeetMe</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
        <Ionicons name="shield-checkmark" size={14} color={theme.colors.primary} />
        <Text style={{ color: theme.colors.textDim, marginLeft: 6, fontSize: 13 }}>Escrow-protected in-person deals</Text>
      </View>
      <View style={{ marginTop: 10, marginBottom: 6 }}><ThemeToggle /></View>
      <Text style={{ color: theme.colors.textDim, marginBottom: 22 }}>Sign in with your phone</Text>
      <TextInput value={name} onChangeText={setName} placeholder="Your name" style={inputStyle(theme)} />
      <TextInput value={phone} onChangeText={(t) => setPhone(formatPhone(t))} placeholder="555-123-4567" keyboardType="phone-pad" maxLength={12} style={inputStyle(theme)} />
      {!otpSent ? (
        <Button label="Send code" onPress={sendCode} style={{ marginTop: 4 }} />
      ) : (
        <>
          <TextInput value={otp} onChangeText={setOtp} placeholder="6-digit code (local: 123456)" keyboardType="number-pad" style={inputStyle(theme)} />
          <Button label="Verify & continue" onPress={verifyCode} style={{ marginTop: 4 }} />
          <Pressable onPress={() => setOtpSent(false)}><Text style={{ color: theme.colors.primary, textAlign: 'center', marginTop: 12 }}>Use a different number</Text></Pressable>
        </>
      )}
      <Text style={{ color: theme.colors.textMuted, textAlign: 'center', marginVertical: 18 }}>— or —</Text>
      <Button variant="secondary" label="Try the demo" onPress={startDemo} />
      <Text style={{ color: theme.colors.textMuted, textAlign: 'center', fontSize: 12, marginTop: 6 }}>Play both sides — Maya & Sam on one device.</Text>
      {busy && <ActivityIndicator style={{ marginTop: 16 }} />}
      {!!err && <Text style={{ color: theme.colors.danger, marginTop: 12 }}>{err}</Text>}
    </ScrollView>
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
