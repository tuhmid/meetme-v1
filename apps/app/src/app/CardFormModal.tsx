// Card entry — TEST MODE. A real card form (number / expiry / CVC / zip) with live
// formatting + Luhn validation, but only the last 4 ever leaves the device. This is the
// exact seam a real Stripe Elements / SetupIntent swaps into; no money moves here.
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { Button } from '../ui';
import { cardExpiryValid, cardFormValid, cardLast4, detectCardBrand, formatCardExpiry, formatCardNumber, inputStyle, luhnValid } from './dealLogic';

export interface CardFormModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (last4: string) => void; // parent calls the API with just the last 4
  busy?: boolean;
}

export function CardFormModal({ visible, onClose, onSubmit, busy }: CardFormModalProps) {
  const theme = useTheme();
  const [number, setNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [zip, setZip] = useState('');

  const { brand, cvcLen } = detectCardBrand(number);
  const valid = cardFormValid(number, expiry, cvc, zip);
  // per-field error only once the user has typed enough to judge it (don't yell early)
  const numErr = number.replace(/\D/g, '').length >= 13 && !luhnValid(number);
  const expErr = expiry.length === 5 && !cardExpiryValid(expiry);

  const labelStyle = { color: theme.colors.textDim, fontSize: 12, fontWeight: '700' as const, marginBottom: 5, marginTop: 8 };
  const errStyle = { color: theme.colors.danger, fontSize: 12, marginTop: 4, marginBottom: 2 };

  const submit = () => {
    if (!valid || busy) return;
    onSubmit(cardLast4(number));
    setNumber(''); setExpiry(''); setCvc(''); setZip('');
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <SafeAreaView style={{ backgroundColor: theme.colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                <Text style={{ flex: 1, fontSize: 20, fontWeight: '800', color: theme.colors.text }}>Add a card</Text>
                <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={24} color={theme.colors.textMuted} /></Pressable>
              </View>
              <Text style={{ color: theme.colors.textDim, fontSize: 13, marginBottom: 16 }}>
                A refundable hold backs each meetup — only captured if you don't show. Test mode: no real charge.
              </Text>

              <Text style={labelStyle}>Card number</Text>
              <View style={{ justifyContent: 'center' }}>
                <TextInput
                  value={number}
                  onChangeText={(t) => setNumber(formatCardNumber(t))}
                  placeholder="1234 5678 9012 3456"
                  placeholderTextColor={theme.colors.textMuted}
                  keyboardType="number-pad"
                  style={[inputStyle(theme), numErr && { borderColor: theme.colors.danger }]}
                />
                {!!number && <Text style={{ position: 'absolute', right: 14, color: theme.colors.textDim, fontWeight: '700', fontSize: 12 }}>{brand}</Text>}
              </View>
              {numErr && <Text style={errStyle}>Check the card number.</Text>}

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={labelStyle}>Expiry</Text>
                  <TextInput value={expiry} onChangeText={(t) => setExpiry(formatCardExpiry(t))} placeholder="MM/YY" placeholderTextColor={theme.colors.textMuted} keyboardType="number-pad" maxLength={5} style={[inputStyle(theme), expErr && { borderColor: theme.colors.danger }]} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={labelStyle}>CVC</Text>
                  <TextInput value={cvc} onChangeText={(t) => setCvc(t.replace(/\D/g, '').slice(0, cvcLen))} placeholder={cvcLen === 4 ? '1234' : '123'} placeholderTextColor={theme.colors.textMuted} keyboardType="number-pad" maxLength={cvcLen} secureTextEntry style={inputStyle(theme)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={labelStyle}>Zip</Text>
                  <TextInput value={zip} onChangeText={(t) => setZip(t.replace(/\D/g, '').slice(0, 5))} placeholder="10001" placeholderTextColor={theme.colors.textMuted} keyboardType="number-pad" maxLength={5} style={inputStyle(theme)} />
                </View>
              </View>
              {expErr && <Text style={errStyle}>That expiry date has passed.</Text>}

              <Button label="Add card" iconName="lock-closed" disabled={!valid} loading={busy} onPress={submit} style={{ marginTop: 16 }} />
              <Text style={{ color: theme.colors.textMuted, fontSize: 11, textAlign: 'center', marginTop: 10 }}>
                Only the last 4 digits are stored. No real payment is set up in test mode.
              </Text>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

export default CardFormModal;
