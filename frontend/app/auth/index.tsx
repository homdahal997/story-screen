import { View, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { colors, spacing } from '@/src/design-system/tokens';

export default function Welcome() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.ink, padding: spacing.lg }}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Image
          source={{ uri: 'https://picsum.photos/seed/welcome/200/200' }}
          style={{ width: 150, height: 150, borderRadius: 75, marginBottom: spacing.xl }}
        />
        <Text style={{ color: colors.bone, fontSize: 32, fontWeight: '700', textAlign: 'center' }}>Frame Studio</Text>
        <Text
          style={{ color: colors.fog, fontSize: 16, textAlign: 'center', marginTop: spacing.sm, paddingHorizontal: spacing.lg }}
        >
          Turn your ideas into AI-generated dramas and unlock earning opportunities
        </Text>
      </View>

      <View style={{ marginBottom: spacing.xl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md }}>
          <Text style={{ fontSize: 20, marginRight: spacing.md }}>✨</Text>
          <Text style={{ color: colors.bone, fontSize: 14 }}>AI-powered story generation</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md }}>
          <Text style={{ fontSize: 20, marginRight: spacing.md }}>🎬</Text>
          <Text style={{ color: colors.bone, fontSize: 14 }}>Create multi-episode dramas</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ fontSize: 20, marginRight: spacing.md }}>💰</Text>
          <Text style={{ color: colors.bone, fontSize: 14 }}>Monetize your creations</Text>
        </View>
      </View>

      <Pressable
        onPress={() => router.push('/auth/signup')}
        style={{
          backgroundColor: '#8B5CF6',
          paddingVertical: spacing.md,
          borderRadius: 24,
          alignItems: 'center',
          marginBottom: spacing.md,
        }}
      >
        <Text style={{ color: colors.bone, fontWeight: '700', fontSize: 16 }}>Get Started</Text>
      </Pressable>

      <Pressable
        onPress={() => router.push('/auth/login')}
        style={{
          borderWidth: 1,
          borderColor: colors.fog,
          paddingVertical: spacing.md,
          borderRadius: 24,
          alignItems: 'center',
        }}
      >
        <Text style={{ color: colors.bone, fontWeight: '600', fontSize: 16 }}>I already have an account</Text>
      </Pressable>

      <Text style={{ color: colors.fog, fontSize: 11, textAlign: 'center', marginTop: spacing.lg }}>
        By continuing, you agree to our <Text style={{ color: colors.bone }}>Terms of Service</Text> and{' '}
        <Text style={{ color: colors.bone }}>Privacy Policy</Text>
      </Text>
    </View>
  );
}
