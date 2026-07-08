// Phone-OTP sign-in plus the one-device demo entry point.
import { KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Button } from '../../ui';
import { useApp } from '../AppContext';
import { formatPhone, inputStyle } from '../dealLogic';
import { IS_LOCAL_SUPABASE } from '../../supabase';

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
      <Text style={{ color: theme.colors.textDim, marginTop: 12, marginBottom: 22 }}>Sign in with your phone</Text>
      <TextInput value={name} onChangeText={setName} placeholder="Your name (optional)" autoComplete="name" textContentType="name" style={inputStyle(theme)} />
      <TextInput value={phone} onChangeText={(t) => setPhone(formatPhone(t))} placeholder="555-123-4567" keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" maxLength={12} style={inputStyle(theme)} />
      {!otpSent ? (
        <Button label="Send code" onPress={sendCode} loading={busy} disabled={busy || phone.length < 12} style={{ marginTop: 4 }} />
      ) : (
        <>
          <TextInput value={otp} onChangeText={setOtp} placeholder="Enter 6-digit code" keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} style={inputStyle(theme)} />
          <Button label="Verify & continue" onPress={verifyCode} loading={busy} disabled={busy || otp.length < 6} style={{ marginTop: 4 }} />
          {IS_LOCAL_SUPABASE && <Text style={{ color: theme.colors.textMuted, textAlign: 'center', fontSize: 12, marginTop: 8 }}>Dev: the test code is <Text style={{ fontWeight: '700', color: theme.colors.textDim }}>123456</Text>.</Text>}
          <Pressable onPress={() => setOtpSent(false)} disabled={busy}><Text style={{ color: theme.colors.primary, textAlign: 'center', marginTop: 12 }}>Use a different number</Text></Pressable>
        </>
      )}
      <Text style={{ color: theme.colors.textMuted, textAlign: 'center', marginVertical: 18 }}>— or —</Text>
      <Button variant="secondary" label="Try the demo" onPress={startDemo} loading={busy} disabled={busy} />
      <Text style={{ color: theme.colors.textMuted, textAlign: 'center', fontSize: 12, marginTop: 6 }}>Play both sides — Maya & Sam on one device.</Text>
      {!!err && <Text style={{ color: theme.colors.danger, marginTop: 12 }}>{err}</Text>}

      {IS_LOCAL_SUPABASE && !otpSent && (
        <View style={{ marginTop: 22, padding: 12, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.colors.border }}>
          <Text style={{ color: theme.colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>Dev · local testing</Text>
          <Text style={{ color: theme.colors.textDim, fontSize: 12, marginBottom: 8 }}>Real-login test numbers — no Twilio. Tap to fill, then the code is 123456.</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {['555-123-0001', '555-123-0002', '555-123-0003', '555-123-0004'].map((n) => (
              <Pressable key={n} onPress={() => setPhone(n)} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: theme.colors.surfaceAlt }}>
                <Text style={{ color: theme.colors.primary, fontWeight: '600', fontSize: 13 }}>{n}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
    </ScrollView>
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
