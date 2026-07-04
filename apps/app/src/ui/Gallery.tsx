import { SafeAreaView, ScrollView, Text, View } from 'react-native';
import { useTheme, ThemeToggle } from '../theme';
import { Button } from './Button';
import { Badge, StatusPill } from './Badge';
import { Avatar, AvatarPair } from './Avatar';
import { Card, SectionLabel } from './Card';
import { TrustBanner } from './TrustBanner';
import { Stepper } from './Stepper';
import { PresenceCard } from './Presence';
import { DealCard } from './DealCard';
import { MeetupField } from './MeetupField';
import { DealHistoryRow } from './DealRow';
import { Callout } from './Callout';
import { WalletSplit } from './WalletSplit';
import { Accordion } from './Accordion';
import { RatingStars } from './Rating';

/** A titled section wrapper used throughout the gallery. */
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  const { spacing } = useTheme();
  return (
    <View style={{ marginBottom: spacing.xl, gap: spacing.md }}>
      <SectionLabel>{label}</SectionLabel>
      {children}
    </View>
  );
}

/**
 * Renders every component in the kit with realistic sample data, so the whole
 * library can be mounted and screenshotted at once (in either theme).
 */
export function UIGallery() {
  const theme = useTheme();
  const { colors, spacing, type } = theme;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl * 2, gap: spacing.sm }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md }}>
        <Text style={{ color: colors.text, fontSize: type.size.xxl, fontWeight: type.weight.bold, letterSpacing: -0.4 }}>
          MeetMe UI
        </Text>
        <ThemeToggle />
      </View>

      <Group label="Buttons">
        <Button label="Confirm handoff & release funds" iconName="checkmark" onPress={() => {}} />
        <Button label="Not yet — keep in escrow" variant="secondary" onPress={() => {}} />
        <Button label="Release $240 now" variant="success" iconName="lock-open" onPress={() => {}} />
        <Button label="Cancel deal" variant="danger" onPress={() => {}} />
        <Button label="Feel unsafe? Leave safely" variant="dangerGhost" onPress={() => {}} />
        <Button label="Funding…" loading onPress={() => {}} />
        <Button label="Unavailable" disabled onPress={() => {}} />
      </Group>

      <Group label="Badges & status pills">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <Badge label="ID verified" tone="primary" iconName="checkmark" />
          <Badge label="Escrow funded" tone="success" iconName="checkmark" />
          <Badge label="Meet in a safe spot" tone="warning" iconName="shield-half" />
          <Badge label="Payment funded" tone="info" iconName="card" />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <StatusPill state="RELEASED" />
          <StatusPill state="FUNDED" />
          <StatusPill state="DISPUTED" />
          <StatusPill state="REFUNDED" />
          <StatusPill state="EXPIRED_NO_SHOW" />
          <StatusPill state="DISPUTE_RESOLVED" />
        </View>
      </Group>

      <Group label="Avatars">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Avatar name="Jordan" />
          <Avatar name="Priya" />
          <Avatar name="Mara" size={40} />
          <AvatarPair a="You" b="Jordan" />
        </View>
      </Group>

      <Group label="Deal summary">
        <DealCard
          item="Sony WH-1000XM5"
          amountCents={24000}
          metaLine="Sat · 2:30 PM · Bryant Park"
          people={{ a: 'You', b: 'Jordan', label: 'You & Jordan' }}
          rating={4.9}
        />
      </Group>

      <Group label="Trust / escrow banner">
        <TrustBanner amountCents={24000} />
        <TrustBanner amountCents={24000} released />
      </Group>

      <Group label="Progress">
        <Card>
          <Stepper steps={['Agree', 'Fund', 'Commit', 'Meet', 'Done']} current={3} />
        </Card>
      </Group>

      <Group label="Live presence">
        <PresenceCard
          live
          showRoute
          you={{ label: 'You (buyer)', status: 'arrived · 2 min ago', color: colors.buyer }}
          them={{ label: 'Jordan (seller)', status: '180 ft away', color: colors.seller }}
        />
      </Group>

      <Group label="Meetup location">
        <MeetupField selected="Bryant Park reading room" onPressSelected={() => {}} onSearch={() => {}} />
        <MeetupField selected="Corner of 5th & Main" custom onPressSelected={() => {}} onSearch={() => {}} />
      </Group>

      <Group label="Deal history">
        <Card padded={false}>
          <DealHistoryRow iconName="headset" title="AirPods Pro" subtitle="Feb 14 · with Priya" amountCents={18000} state="RELEASED" onPress={() => {}} />
          <DealHistoryRow iconName="game-controller" title="Nintendo Switch" subtitle="Today · with Jordan" amountCents={21000} state="FUNDED" onPress={() => {}} />
          <DealHistoryRow iconName="bicycle" title="Road bike" subtitle="Jan 30 · under review" amountCents={34000} state="DISPUTED" onPress={() => {}} />
          <DealHistoryRow iconName="phone-portrait" title="iPhone 13" subtitle="Jun 11 · with Mara" amountCents={18000} state="REFUNDED" onPress={() => {}} showDivider={false} />
        </Card>
      </Group>

      <Group label="Callout">
        <Callout
          tone="primary"
          kicker="Your turn"
          title="On your way to Bryant Park"
          body="Head to the reading room entrance. Jordan is 180 ft away and arriving now."
        />
      </Group>

      <Group label="Wallet">
        <WalletSplit walletCents={5200} escrowCents={24000} />
      </Group>

      <Group label="Deal details">
        <Accordion title="Deal details" defaultOpen>
          <Text style={{ color: colors.textDim, fontSize: type.size.sm, lineHeight: type.size.sm * 1.5 }}>
            Sony WH-1000XM5 · Midnight · very good condition. Funds are held in escrow and release only when both parties
            confirm the handoff in person.
          </Text>
        </Accordion>
        <Accordion title="Safety & disputes">
          <Text style={{ color: colors.textDim, fontSize: type.size.sm }}>
            Meet in a public, camera-covered spot. If anything feels off, use "Leave safely" and open a dispute.
          </Text>
        </Accordion>
      </Group>

      <Group label="Rating">
        <View style={{ gap: spacing.sm }}>
          <RatingStars value={4.5} />
          <RatingStars value={3} size={28} onPick={() => {}} />
        </View>
      </Group>
    </ScrollView>
    </SafeAreaView>
  );
}

export default UIGallery;
