import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { colors, spacing } from '@/src/design-system/tokens';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleReset = async () => {
    if (!email) {
      setError('Please enter your email');
      return;
    }
    setIsLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    setIsLoading(false);
    setSent(true);
  };

  if (sent) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.ink, padding: spacing.lg, justifyContent: 'center', alignItems: 'center' }}>
        <View
          style={{
            width: 80,
            height: 80,
            borderRadius: 40,
            backgroundColor: '#8B5CF6',
            justifyContent: 'center',
            alignItems: 'center',
            marginBottom: spacing.lg,
          }}
        >
          <Text style={{ fontSize: 32 }}>✉️</Text>
        </View>
        <Text style={{ color: colors.bone, fontSize: 22, fontWeight: '700', textAlign: 'center' }}>Check your email</Text>
        <Text style={{ color: colors.fog, fontSize: 14, textAlign: 'center', marginTop: spacing.sm, paddingHorizontal: spacing.lg }}>
          We&apos;ve sent a password reset link to {email}
        </Text>
        <Pressable
          onPress={() => router.push('/auth/login')}
          style={{
            backgroundColor: '#8B5CF6',
            paddingVertical: spacing.md,
            paddingHorizontal: spacing.xl,
            borderRadius: 24,
            marginTop: spacing.xl,
          }}
        >
          <Text style={{ color: colors.bone, fontWeight: '700', fontSize: 16 }}>Back to Sign In</Text>
        </Pressable>
        <Pressable onPress={() => setSent(false)} style={{ marginTop: spacing.lg }}>
          <Text style={{ color: colors.fog, fontSize: 14 }}>
            Didn&apos;t receive? <Text style={{ color: '#8B5CF6', fontWeight: '600' }}>Resend</Text>
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink, padding: spacing.lg }}>
      <Pressable onPress={() => router.back()} style={{ marginTop: spacing.lg }}>
        <Text style={{ color: colors.bone, fontSize: 24 }}>‹</Text>
      </Pressable>

      <View style={{ marginTop: spacing.xl }}>
        <Text style={{ color: colors.bone, fontSize: 28, fontWeight: '700' }}>Forgot password?</Text>
        <Text style={{ color: colors.fog, fontSize: 15, marginTop: spacing.sm }}>Enter your email and we&apos;ll send you a reset link</Text>
      </View>

      <View style={{ marginTop: spacing.xl }}>
        <Text style={{ color: colors.bone, fontSize: 14, fontWeight: '600', marginBottom: spacing.sm }}>Email</Text>
        <View style={{ backgroundColor: colors.graphite, borderRadius: 8, paddingHorizontal: spacing.md }}>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@email.com"
            placeholderTextColor={colors.fog}
            keyboardType="email-address"
            autoCapitalize="none"
            style={{ color: colors.bone, fontSize: 15, paddingVertical: spacing.md }}
          />
        </View>
        {error ? <Text style={{ color: colors.signal, fontSize: 13, marginTop: spacing.md }}>{error}</Text> : null}
      </View>

      <Pressable
        onPress={handleReset}
        disabled={isLoading}
        style={{
          backgroundColor: '#8B5CF6',
          paddingVertical: spacing.md,
          borderRadius: 24,
          alignItems: 'center',
          marginTop: spacing.xl,
          opacity: isLoading ? 0.7 : 1,
        }}
      >
        {isLoading ? <ActivityIndicator color={colors.bone} /> : <Text style={{ color: colors.bone, fontWeight: '700', fontSize: 16 }}>Send Reset Link</Text>}
      </Pressable>

      <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: spacing.xl }}>
        <Text style={{ color: colors.fog, fontSize: 14 }}>Remember your password? </Text>
        <Pressable onPress={() => router.push('/auth/login')}>
          <Text style={{ color: '#8B5CF6', fontSize: 14, fontWeight: '600' }}>Sign In</Text>
        </Pressable>
      </View>
    </View>
  );
}
