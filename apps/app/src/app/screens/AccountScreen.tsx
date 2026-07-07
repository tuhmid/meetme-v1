// Account tab — stub for now; gets built out next phase.
import { SafeAreaView, ScrollView, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ThemeToggle, useTheme } from '../../theme';
import { Badge, Button, Card, SectionLabel } from '../../ui';
import { useApp } from '../AppContext';

const PLACEHOLDERS = ['ID verification', 'Blocked users', 'Legal'];

export default function AccountScreen() {
  const theme = useTheme();
  const { session, demo, viewAs, logout } = useApp();

  const identityName = session
    ? session.name
    : demo
      ? (viewAs === 'buyer' ? demo.buyer.name : demo.seller.name)
      : '—';
  const identityNote = session
    ? 'Signed in with phone'
    : 'Demo mode — playing both sides on this device';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <StatusBar style="dark" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 6, paddingBottom: 34 }}>
        <SectionLabel style={{ marginTop: 6 }}>Account</SectionLabel>
        <Card>
          <Text style={{ fontWeight: '700', fontSize: 16, color: theme.colors.text }}>{identityName}</Text>
          <Text style={{ color: theme.colors.textDim, marginTop: 3, fontSize: 13 }}>{identityNote}</Text>
        </Card>

        <View style={{ marginTop: 14, alignItems: 'flex-start' }}><ThemeToggle /></View>

        <Card padded={false} style={{ marginTop: 14, overflow: 'hidden' }}>
          {PLACEHOLDERS.map((label, i) => (
            <View
              key={label}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: 14,
                paddingVertical: 14,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: theme.colors.border,
                opacity: 0.55,
              }}
            >
              <Text style={{ color: theme.colors.text }}>{label}</Text>
              <Badge label="soon" tone="neutral" />
            </View>
          ))}
        </Card>

        <Button variant="dangerGhost" label={demo ? 'Exit demo' : 'Log out'} onPress={logout} style={{ marginTop: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
