import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing } from '@/src/design-system/tokens';

export default function Signup() {
  const { signup, isLoading } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);

  const handleSignup = async () => {
    if (!name || !email || !password || !confirmPassword) {
      setError('Please fill in all fields');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (!agreeTerms) {
      setError('Please agree to the Terms of Service');
      return;
    }
    try {
      await signup(name, email, password);
      router.replace('/(tabs)');
    } catch (e) {
      setError((e as any)?.message || 'Signup failed. Please try again.');
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.ink }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }}>
        <Pressable onPress={() => router.back()} style={{ marginTop: spacing.lg }}>
          <Text style={{ color: colors.bone, fontSize: 24 }}>‹</Text>
        </Pressable>

        <View style={{ marginTop: spacing.xl }}>
          <Text style={{ color: colors.bone, fontSize: 28, fontWeight: '700' }}>Create account</Text>
          <Text style={{ color: colors.fog, fontSize: 15, marginTop: spacing.sm }}>Start your journey as a creator</Text>
        </View>

        <View style={{ marginTop: spacing.xl }}>
          <Text style={{ color: colors.bone, fontSize: 14, fontWeight: '600', marginBottom: spacing.sm }}>Full Name</Text>
          <View style={{ backgroundColor: colors.graphite, borderRadius: 8, paddingHorizontal: spacing.md, marginBottom: spacing.lg }}>
            <TextInput
              value={name}
              onChangeText={setName}
              testID="signup-name-input"
              placeholder="John Doe"
              placeholderTextColor={colors.fog}
              style={{ color: colors.bone, fontSize: 15, paddingVertical: spacing.md }}
            />
          </View>

          <Text style={{ color: colors.bone, fontSize: 14, fontWeight: '600', marginBottom: spacing.sm }}>Email</Text>
          <View style={{ backgroundColor: colors.graphite, borderRadius: 8, paddingHorizontal: spacing.md, marginBottom: spacing.lg }}>
            <TextInput
              value={email}
              onChangeText={setEmail}
              testID="signup-email-input"
              placeholder="you@email.com"
              placeholderTextColor={colors.fog}
              keyboardType="email-address"
              autoCapitalize="none"
              style={{ color: colors.bone, fontSize: 15, paddingVertical: spacing.md }}
            />
          </View>

          <Text style={{ color: colors.bone, fontSize: 14, fontWeight: '600', marginBottom: spacing.sm }}>Password</Text>
          <View
            style={{
              backgroundColor: colors.graphite,
              borderRadius: 8,
              paddingHorizontal: spacing.md,
              flexDirection: 'row',
              alignItems: 'center',
              marginBottom: spacing.lg,
            }}
          >
            <TextInput
              value={password}
              onChangeText={setPassword}
              testID="signup-password-input"
              placeholder="At least 8 characters"
              placeholderTextColor={colors.fog}
              secureTextEntry={!showPassword}
              style={{ color: colors.bone, fontSize: 15, paddingVertical: spacing.md, flex: 1 }}
            />
            <Pressable onPress={() => setShowPassword(!showPassword)}>
              <Text style={{ color: colors.fog, fontSize: 14 }}>{showPassword ? '🙈' : '👁'}</Text>
            </Pressable>
          </View>

          <Text style={{ color: colors.bone, fontSize: 14, fontWeight: '600', marginBottom: spacing.sm }}>Confirm Password</Text>
          <View style={{ backgroundColor: colors.graphite, borderRadius: 8, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center' }}>
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              testID="signup-confirm-input"
              placeholder="Confirm your password"
              placeholderTextColor={colors.fog}
              secureTextEntry={!showPassword}
              style={{ color: colors.bone, fontSize: 15, paddingVertical: spacing.md, flex: 1 }}
            />
          </View>

          <Pressable onPress={() => setAgreeTerms(!agreeTerms)} style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg }}>
            <View
              style={{
                width: 20,
                height: 20,
                borderRadius: 4,
                borderWidth: 1,
                borderColor: agreeTerms ? '#8B5CF6' : colors.fog,
                backgroundColor: agreeTerms ? '#8B5CF6' : 'transparent',
                justifyContent: 'center',
                alignItems: 'center',
                marginRight: spacing.sm,
              }}
            >
              {agreeTerms && <Text style={{ color: colors.bone, fontSize: 12 }}>✓</Text>}
            </View>
            <Text style={{ color: colors.fog, fontSize: 13, flex: 1 }}>
              I agree to the <Text style={{ color: colors.bone }}>Terms of Service</Text> and{' '}
              <Text style={{ color: colors.bone }}>Privacy Policy</Text>
            </Text>
          </Pressable>

          {error ? <Text style={{ color: colors.signal, fontSize: 13, marginTop: spacing.md }}>{error}</Text> : null}
        </View>

        <Pressable
          testID="signup-submit-button"
          onPress={handleSignup}
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
          {isLoading ? <ActivityIndicator color={colors.bone} /> : <Text style={{ color: colors.bone, fontWeight: '700', fontSize: 16 }}>Create Account</Text>}
        </Pressable>

        <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: spacing.xl }}>
          <View style={{ flex: 1, height: 1, backgroundColor: `${colors.fog}33` }} />
          <Text style={{ color: colors.fog, marginHorizontal: spacing.md, fontSize: 13 }}>or sign up with</Text>
          <View style={{ flex: 1, height: 1, backgroundColor: `${colors.fog}33` }} />
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.md }}>
          <Pressable
            style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: colors.graphite, justifyContent: 'center', alignItems: 'center' }}
          >
            <Text style={{ fontSize: 20 }}>🍎</Text>
          </Pressable>
          <Pressable
            style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: colors.graphite, justifyContent: 'center', alignItems: 'center' }}
          >
            <Text style={{ fontSize: 20 }}>G</Text>
          </Pressable>
          <Pressable
            style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: colors.graphite, justifyContent: 'center', alignItems: 'center' }}
          >
            <Text style={{ fontSize: 20 }}>📘</Text>
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: spacing.xl }}>
          <Text style={{ color: colors.fog, fontSize: 14 }}>Already have an account? </Text>
          <Pressable onPress={() => router.push('/auth/login')}>
            <Text style={{ color: '#8B5CF6', fontSize: 14, fontWeight: '600' }}>Sign In</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
