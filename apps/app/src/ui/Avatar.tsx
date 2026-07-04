import { Text, View } from 'react-native';
import { useTheme } from '../theme';

export interface AvatarProps {
  name: string;
  color?: string;
  size?: number;
}

/** Deterministic hash so a given name always lands on the same palette slot. */
function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}

/** A filled circle with the name's initial. Color defaults to a stable pick. */
export function Avatar({ name, color, size = 32 }: AvatarProps) {
  const theme = useTheme();
  const { colors } = theme;
  const palette = [colors.buyer, colors.seller, colors.primary, colors.info, colors.warning, colors.success];
  const bg = color ?? palette[hashName(name) % palette.length];
  const initial = (name.trim()[0] ?? '?').toUpperCase();

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: colors.surface,
      }}
    >
      <Text style={{ color: '#ffffff', fontSize: Math.round(size * 0.42), fontWeight: '700' }}>{initial}</Text>
    </View>
  );
}

export interface AvatarPairProps {
  a: string;
  b: string;
  aColor?: string;
  bColor?: string;
  size?: number;
}

/** Two overlapping avatars — defaults to buyer color + seller color. */
export function AvatarPair({ a, b, aColor, bColor, size = 30 }: AvatarPairProps) {
  const theme = useTheme();
  const { colors } = theme;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Avatar name={a} color={aColor ?? colors.buyer} size={size} />
      <View style={{ marginLeft: -8 }}>
        <Avatar name={b} color={bColor ?? colors.seller} size={size} />
      </View>
    </View>
  );
}

export default Avatar;
