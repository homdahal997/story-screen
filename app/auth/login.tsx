import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing } from '@/src/design-system/tokens';

export default function Login() {
  const { login, isLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!email || !password) {
      setError('Please fill in all fields');
      return;
    }
    try {
      await login(email, password);
      router.replace('/(tabs)');
    } catch (e) {
      setError('Invalid email or password');
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.ink }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={{ flex: 1, padding: spacing.lg }}>
        <Pressable onPress={() => router.back()} style={{ marginTop: spacing.lg }}>
          <Text style={{ color: colors.bone, fontSize: 24 }}>‹</Text>
        </Pressable>

        <View style={{ marginTop: spacing.xl }}>
          <Text style={{ color: colors.bone, fontSize: 28, fontWeight: '700' }}>Welcome back</Text>
          <Text style={{ color: colors.fog, fontSize: 15, marginTop: spacing.sm }}>Sign in to continue creating</Text>
        </View>

        <View style={{ marginTop: spacing.xl }}>
          <Text style={{ color: colors.bone, fontSize: 14, fontWeight: '600', marginBottom: spacing.sm }}>Email</Text>
          <View style={{ backgroundColor: colors.graphite, borderRadius: 8, paddingHorizontal: spacing.md, marginBottom: spacing.lg }}>
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

          <Text style={{ color: colors.bone, fontSize: 14, fontWeight: '600', marginBottom: spacing.sm }}>Password</Text>
          <View
            style={{
              backgroundColor: colors.graphite,
              borderRadius: 8,
              paddingHorizontal: spacing.md,
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Enter password"
              placeholderTextColor={colors.fog}
              secureTextEntry={!showPassword}
              style={{ color: colors.bone, fontSize: 15, paddingVertical: spacing.md, flex: 1 }}
            />
            <Pressable onPress={() => setShowPassword(!showPassword)}>
              <Text style={{ color: colors.fog, fontSize: 14 }}>{showPassword ? '🙈' : '👁'}</Text>
            </Pressable>
          </View>

          <Pressable onPress={() => router.push('/auth/forgot-password')} style={{ alignSelf: 'flex-end', marginTop: spacing.sm }}>
            <Text style={{ color: '#8B5CF6', fontSize: 13, fontWeight: '600' }}>Forgot Password?</Text>
          </Pressable>

          {error ? <Text style={{ color: colors.signal, fontSize: 13, marginTop: spacing.md }}>{error}</Text> : null}
        </View>

        <Pressable
          onPress={handleLogin}
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
          {isLoading ? <ActivityIndicator color={colors.bone} /> : <Text style={{ color: colors.bone, fontWeight: '700', fontSize: 16 }}>Sign In</Text>}
        </Pressable>

        <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: spacing.xl }}>
          <View style={{ flex: 1, height: 1, backgroundColor: `${colors.fog}33` }} />
          <Text style={{ color: colors.fog, marginHorizontal: spacing.md, fontSize: 13 }}>or continue with</Text>
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
          <Text style={{ color: colors.fog, fontSize: 14 }}>Don&apos;t have an account? </Text>
          <Pressable onPress={() => router.push('/auth/signup')}>
            <Text style={{ color: '#8B5CF6', fontSize: 14, fontWeight: '600' }}>Sign Up</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
