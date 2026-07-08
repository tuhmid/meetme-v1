// Full-screen in-deal chat. Lives off the deal screen (opened from a "Chat" entry) so
// the deal screen stays focused, and a real screen handles the keyboard + auto-scroll
// far better than an inline block ever did.
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { inputStyle } from './dealLogic';
import type { ChatMessage } from '../api';

export interface ChatModalProps {
  visible: boolean;
  onClose: () => void;
  title: string; // the other person's name
  messages: ChatMessage[];
  myId: string;
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  onAttach: () => void;
  pendingImageUri?: string | null; // an image mid-upload — shown optimistically
}

export function ChatModal({ visible, onClose, title, messages, myId, input, setInput, onSend, onAttach, pendingImageUri }: ChatModalProps) {
  const theme = useTheme();
  const listRef = useRef<ScrollView>(null);
  const toEnd = () => listRef.current?.scrollToEnd({ animated: true });

  // jump to the newest message when the thread grows, an upload starts, or the screen opens
  useEffect(() => { if (visible) setTimeout(toEnd, 60); }, [visible, messages.length, pendingImageUri]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
          <Pressable onPress={onClose} hitSlop={10} style={{ padding: 4 }}>
            <Ionicons name="chevron-down" size={24} color={theme.colors.text} />
          </Pressable>
          <Text style={{ flex: 1, textAlign: 'center', fontWeight: '700', fontSize: 16, color: theme.colors.text }}>{title}</Text>
          <View style={{ width: 32 }} />
        </View>

        <ScrollView ref={listRef} style={{ flex: 1 }} contentContainerStyle={{ padding: 14 }} keyboardDismissMode="interactive" onContentSizeChange={toEnd}>
          {messages.length === 0 ? (
            <Text style={{ color: theme.colors.textMuted, textAlign: 'center', marginTop: 24 }}>No messages yet — say hi and coordinate your meetup.</Text>
          ) : (
            messages.map((m, i) => {
              const mine = m.senderId === myId;
              const hasImage = !!m.imageUrl;
              // Stable key so a poll refresh doesn't remount (and re-animate) existing bubbles —
              // only genuinely new messages spring in.
              return (
                <Animated.View
                  key={`${m.createdAt}-${m.senderId}-${i}`}
                  entering={FadeInDown.springify().damping(16).stiffness(190).mass(0.6)}
                  style={{ alignSelf: mine ? 'flex-end' : 'flex-start', backgroundColor: mine ? theme.colors.primary : theme.colors.surfaceAlt, borderRadius: theme.radius.md, padding: hasImage ? 4 : 0, paddingHorizontal: hasImage ? 4 : 12, paddingVertical: hasImage ? 4 : 8, marginVertical: 3, maxWidth: '80%' }}
                >
                  {hasImage && <Image source={{ uri: m.imageUrl! }} style={{ width: 220, height: 220, borderRadius: theme.radius.sm }} resizeMode="cover" />}
                  {m.body ? <Text style={{ color: mine ? theme.colors.onPrimary : theme.colors.text, paddingHorizontal: hasImage ? 8 : 0, paddingTop: hasImage ? 6 : 0, paddingBottom: hasImage ? 4 : 0 }}>{m.body}</Text> : null}
                </Animated.View>
              );
            })
          )}

          {/* optimistic upload bubble: the picked photo appears instantly with a spinner */}
          {pendingImageUri && (
            <Animated.View entering={FadeIn.duration(160)} style={{ alignSelf: 'flex-end', backgroundColor: theme.colors.primary, borderRadius: theme.radius.md, padding: 4, marginVertical: 3, maxWidth: '80%' }}>
              <Image source={{ uri: pendingImageUri }} style={{ width: 220, height: 220, borderRadius: theme.radius.sm, opacity: 0.55 }} resizeMode="cover" />
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator color="#fff" />
              </View>
            </Animated.View>
          )}
        </ScrollView>

        {/* composer */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
          <Pressable onPress={onAttach} hitSlop={8} style={{ paddingHorizontal: 6 }}>
            <Ionicons name="image-outline" size={26} color={theme.colors.primary} />
          </Pressable>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Message…"
            placeholderTextColor={theme.colors.textMuted}
            style={[inputStyle(theme), { flex: 1, marginBottom: 0, marginHorizontal: 8 }]}
            onSubmitEditing={onSend}
            returnKeyType="send"
            blurOnSubmit={false}
          />
          <Pressable onPress={onSend} style={{ backgroundColor: theme.colors.primary, borderRadius: theme.radius.md, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }} hitSlop={4}>
            <Ionicons name="send" size={18} color={theme.colors.onPrimary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
    </Modal>
  );
}

export default ChatModal;
